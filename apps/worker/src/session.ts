import { computeSessionStats, evaluateCard, generate75BallCard, type BingoCard, type BingoProgress } from "@cloverbingo/core";
import { and, asc, eq } from "drizzle-orm";

import type { Bindings } from "./bindings";
import { getDb } from "./db/client";
import { drawCommits, invites, participants, sessions } from "./db/schema";

type Role = "participant" | "display" | "admin" | "mod";
type DisplayScreen = "ten" | "one";

type ReelStatus = "idle" | "spinning" | "stopped";
type ReachIntensity = 0 | 1 | 2 | 3;
type ParticipantStatus = "active" | "disabled";

const ADMIN_INVITE_COOKIE = "cloverbingo_admin";
const MOD_INVITE_COOKIE = "cloverbingo_mod";

type SpotlightState = {
  version: number;
  ids: string[];
  updatedAt: number;
  updatedBy: string | null;
};

type PendingDrawState = {
  number: number;
  preparedAt: number;
  impact: {
    reachPlayers: number;
    bingoPlayers: number;
  };
  state: "prepared" | "spinning";
  reel: {
    ten: ReelStatus;
    one: ReelStatus;
  };
  stoppedDigits: {
    ten: number | null;
    one: number | null;
  };
};

type PlayerState = {
  id: string;
  status: ParticipantStatus;
  displayName: string;
  joinedAt: number;
  disabledAt: number | null;
  disabledReason: string | null;
  disabledBy: string | null;
  card: BingoCard;
  progress: BingoProgress;
};

type WsAttachment = {
  role: Role;
  playerId?: string;
  screen?: DisplayScreen;
};

type SpotlightPlayerSummary = {
  id: string;
  displayName: string;
  progress: BingoProgress;
};

type PrivilegedPlayerSnapshot = {
  id: string;
  status: ParticipantStatus;
  displayName: string;
  joinedAt: number;
  disabledAt: number | null;
  disabledReason: string | null;
  disabledBy: string | null;
  progress: BingoProgress;
  card: BingoCard;
};

type SnapshotShared = {
  stats: ReturnType<typeof computeSessionStats>;
  lastNumber: number | null;
  lastNumbers: number[];
  spotlightPlayers: SpotlightPlayerSummary[];
  getPrivilegedPlayers: () => PrivilegedPlayerSnapshot[];
};

function nowMs(): number {
  return Date.now();
}

function isoNow(): string {
  return new Date().toISOString();
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntInclusive(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function reachIntensityFromCount(reachCount: number): ReachIntensity {
  if (!Number.isFinite(reachCount)) return 0;
  if (reachCount <= 1) return 0;
  if (reachCount <= 4) return 1;
  if (reachCount <= 8) return 2;
  return 3;
}

function spinTimingForIntensity(intensity: ReachIntensity): { totalMaxMs: number; gapMinMs: number; gapMaxMs: number } {
  const totalMaxMs = [3000, 3600, 4200, 4800][intensity];
  const teaseDelayMin = [0, 150, 250, 450][intensity];
  const teaseDelayMax = [0, 250, 450, 650][intensity];
  const holdMin = [0, 120, 220, 380][intensity];
  const holdMax = [0, 220, 380, 520][intensity];
  const baseGapMin = 350;
  const baseGapMax = 700;
  return {
    totalMaxMs,
    gapMinMs: baseGapMin + teaseDelayMin + holdMin,
    gapMaxMs: baseGapMax + teaseDelayMax + holdMax,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, init);
}

function getCookieFromRequest(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key !== name) continue;
    const raw = trimmed.slice(eqIdx + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function clampDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 1) return null;
  if (trimmed.length > 24) return trimmed.slice(0, 24);
  return trimmed;
}

function clampDeviceId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 8) return null;
  if (trimmed.length > 64) return trimmed.slice(0, 64);
  return trimmed;
}

function clampSpotlightUpdatedBy(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 1) return null;
  if (trimmed.length > 32) return trimmed.slice(0, 32);
  return trimmed;
}

function clampDisabledReason(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 1) return null;
  if (trimmed.length > 64) return trimmed.slice(0, 64);
  return trimmed;
}

function sanitizeSpotlightIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === "string").slice(0, 6);
}

function defaultSpotlightState(t: number): SpotlightState {
  return { version: 0, ids: [], updatedAt: t, updatedBy: "system" };
}

function digitsOf(n: number): { ten: number; one: number } {
  const normalized = ((n % 100) + 100) % 100;
  return { ten: Math.floor(normalized / 10), one: normalized % 10 };
}

function computeImpact(players: Record<string, PlayerState>, hypotheticallyDrawn: number[], nextNumber: number) {
  let reachPlayers = 0;
  let bingoPlayers = 0;
  const nextDrawn = hypotheticallyDrawn.concat([nextNumber]);
  for (const player of Object.values(players)) {
    if (player.status !== "active") continue;
    const progress = evaluateCard(player.card, nextDrawn);
    if (progress.reachLines > 0) reachPlayers += 1;
    if (progress.isBingo) bingoPlayers += 1;
  }
  return { reachPlayers, bingoPlayers };
}

function parseJsonBody(input: string | ArrayBuffer): unknown | null {
  if (typeof input !== "string") return null;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function getAttachmentFromWebSocket(ws: WebSocket): WsAttachment | null {
  try {
    return (ws.deserializeAttachment?.() as WsAttachment | undefined) ?? null;
  } catch {
    return null;
  }
}

export class SessionDurableObject {
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private updatedAt = nowMs();

  private session:
    | null
    | {
        id: string;
        code: string;
        status: "active" | "ended";
        createdAt: string;
        endedAt: string | null;
      } = null;

  private players: Record<string, PlayerState> = {};
  private drawnNumbers: number[] = [];
  private pendingDraw: PendingDrawState | null = null;

  // volatile (do not persist)
  private devFxIntensityOverride: ReachIntensity | null = null;
  private spotlight: SpotlightState = defaultSpotlightState(nowMs());

  constructor(private readonly state: DurableObjectState, private readonly env: Bindings) {}

  private touch(): void {
    this.updatedAt = nowMs();
  }

  private getSessionIdFromRequest(request: Request): string | null {
    const header = request.headers.get("x-session-id");
    if (header && header.trim() !== "") return header.trim();
    const url = new URL(request.url);
    const qp = url.searchParams.get("sessionId");
    if (qp && qp.trim() !== "") return qp.trim();
    return null;
  }

  private async ensureLoaded(request: Request): Promise<Response | null> {
    if (this.loaded) return null;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const sessionId = this.getSessionIdFromRequest(request);
        if (!sessionId) return;

        const db = getDb(this.env);
        const sessionRows = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
        if (!sessionRows.length) return;
        const s = sessionRows[0];
        this.session = {
          id: s.id,
          code: s.code,
          status: s.status === "ended" ? "ended" : "active",
          createdAt: s.createdAt,
          endedAt: s.endedAt ?? null,
        };

        let loadedUpdatedAt = Date.parse(s.createdAt) || nowMs();
        if (s.endedAt) loadedUpdatedAt = Math.max(loadedUpdatedAt, Date.parse(s.endedAt) || 0);

        const commitRows = await db.select().from(drawCommits).where(eq(drawCommits.sessionId, sessionId)).orderBy(asc(drawCommits.seq));
        this.drawnNumbers = commitRows.map((r) => r.number);
        if (commitRows.length) loadedUpdatedAt = Math.max(loadedUpdatedAt, Date.parse(commitRows[commitRows.length - 1].committedAt) || 0);

        const participantRows = await db.select().from(participants).where(eq(participants.sessionId, sessionId));
        this.players = {};
        for (const row of participantRows) {
          let card: BingoCard | null = null;
          try {
            card = JSON.parse(row.cardJson) as BingoCard;
          } catch {
            card = null;
          }
          if (!card) continue;

          loadedUpdatedAt = Math.max(loadedUpdatedAt, Date.parse(row.createdAt) || 0);
          const status: ParticipantStatus = row.status === "disabled" ? "disabled" : "active";
          const disabledAtMs = row.disabledAt ? Date.parse(row.disabledAt) : NaN;
          this.players[row.id] = {
            id: row.id,
            status,
            displayName: row.displayName,
            joinedAt: Date.parse(row.createdAt) || nowMs(),
            disabledAt: Number.isFinite(disabledAtMs) ? disabledAtMs : null,
            disabledReason: row.disabledReason ?? null,
            disabledBy: row.disabledBy ?? null,
            card,
            progress: evaluateCard(card, this.drawnNumbers),
          };
        }

        this.updatedAt = loadedUpdatedAt || nowMs();
        this.loaded = true;
      })();
    }

    await this.loadPromise;
    if (!this.session) return textResponse("session not found", { status: 404 });
    return null;
  }

  private assertActiveSession(): Response | null {
    if (!this.session) return textResponse("session not found", { status: 404 });
    if (this.session.status !== "active") return textResponse("session ended", { status: 410 });
    return null;
  }

  private async assertInvite(request: Request, requiredRole: "admin" | "mod"): Promise<Response | null> {
    if (!this.session) return textResponse("session not found", { status: 404 });
    const cookieName = requiredRole === "admin" ? ADMIN_INVITE_COOKIE : MOD_INVITE_COOKIE;
    const token = getCookieFromRequest(request, cookieName);
    if (!token || token.trim() === "") return textResponse("missing token", { status: 401 });

    const db = getDb(this.env);
    const rows = await db
      .select()
      .from(invites)
      .where(and(eq(invites.token, token.trim()), eq(invites.sessionId, this.session.id), eq(invites.role, requiredRole)))
      .limit(1);
    if (!rows.length) return textResponse("forbidden", { status: 403 });
    return null;
  }

  private createSnapshotShared(): SnapshotShared {
    const playersList = Object.values(this.players);
    const activePlayers = playersList.filter((p) => p.status === "active");
    const stats = computeSessionStats(activePlayers.map((p) => p.progress));
    const lastNumber = this.drawnNumbers.length > 0 ? this.drawnNumbers[this.drawnNumbers.length - 1] : null;
    const lastNumbers = this.drawnNumbers.slice(-10);

    const spotlightPlayers = this.spotlight.ids
      .map((id) => this.players[id])
      .filter((p): p is PlayerState => Boolean(p && p.status === "active"))
      .map((p) => ({ id: p.id, displayName: p.displayName, progress: p.progress }));

    let privilegedCache: PrivilegedPlayerSnapshot[] | null = null;
    function getPrivilegedPlayers(): PrivilegedPlayerSnapshot[] {
      if (privilegedCache) return privilegedCache;
      privilegedCache = playersList.map((p) => ({
        id: p.id,
        status: p.status,
        displayName: p.displayName,
        joinedAt: p.joinedAt,
        disabledAt: p.disabledAt,
        disabledReason: p.disabledReason,
        disabledBy: p.disabledBy,
        progress: p.progress,
        card: p.card,
      }));
      return privilegedCache;
    }

    return { stats, lastNumber, lastNumbers, spotlightPlayers, getPrivilegedPlayers };
  }

  private buildSnapshot(attachment: WsAttachment | null, shared?: SnapshotShared): unknown {
    if (!this.session) return { type: "snapshot", ok: false, error: "session not found" };

    const computed = shared ?? this.createSnapshotShared();
    const { stats, lastNumber, lastNumbers, spotlightPlayers } = computed;
    const actualReachIntensity = reachIntensityFromCount(stats.reachPlayers);
    const effectiveReachIntensity = this.devFxIntensityOverride ?? actualReachIntensity;

    const base = {
      type: "snapshot",
      ok: true,
      sessionCode: this.session.code,
      sessionStatus: this.session.status,
      endedAt: this.session.endedAt,
      updatedAt: this.updatedAt,
      drawCount: this.drawnNumbers.length,
      lastNumber,
      lastNumbers,
      stats,
      fx: {
        actualReachIntensity,
        effectiveReachIntensity,
        intensityOverride: this.devFxIntensityOverride,
      },
      spotlight: {
        ...this.spotlight,
        players: spotlightPlayers,
      },
      drawState: this.pendingDraw ? this.pendingDraw.state : "idle",
    };

    if (!attachment) return base;

    if (attachment.role === "participant") {
      const player = attachment.playerId ? this.players[attachment.playerId] : null;
      return {
        ...base,
        role: "participant",
        drawnNumbers: this.drawnNumbers,
        player: player
          ? {
              id: player.id,
              status: player.status,
              displayName: player.displayName,
              joinedAt: player.joinedAt,
              disabledAt: player.disabledAt,
              card: player.card,
              progress: player.progress,
            }
          : null,
      };
    }

    if (attachment.role === "display") {
      const screen = attachment.screen ?? "ten";
      const lastCommittedDigit = lastNumber ? digitsOf(lastNumber)[screen] : null;
      const status = this.pendingDraw ? this.pendingDraw.reel[screen] : "idle";
      const stoppedDigit =
        this.pendingDraw && this.pendingDraw.reel[screen] === "stopped"
          ? this.pendingDraw.stoppedDigits[screen] ?? digitsOf(this.pendingDraw.number)[screen]
          : lastCommittedDigit;
      const spotlightPlayersWithCard = this.spotlight.ids
        .map((id) => this.players[id])
        .filter((p): p is PlayerState => Boolean(p && p.status === "active"))
        .map((p) => ({ id: p.id, displayName: p.displayName, progress: p.progress, card: p.card }));
      return {
        ...base,
        role: "display",
        drawnNumbers: this.drawnNumbers,
        spotlight: {
          ...base.spotlight,
          players: spotlightPlayersWithCard,
        },
        screen,
        reel: {
          status,
          digit: status === "spinning" ? null : stoppedDigit,
        },
      };
    }

    const players = computed.getPrivilegedPlayers();

    if (attachment.role === "mod") {
      return {
        ...base,
        role: "mod",
        drawnNumbers: this.drawnNumbers,
        players,
      };
    }

    if (attachment.role === "admin") {
      return {
        ...base,
        role: "admin",
        drawnNumbers: this.drawnNumbers,
        players,
        pendingDraw: this.pendingDraw
          ? {
              preparedAt: this.pendingDraw.preparedAt,
              number: this.pendingDraw.number,
              impact: this.pendingDraw.impact,
              reel: this.pendingDraw.reel,
              stoppedDigits: this.pendingDraw.stoppedDigits,
              state: this.pendingDraw.state,
            }
          : null,
      };
    }

    return base;
  }

  private sendSnapshot(ws: WebSocket, shared?: SnapshotShared): void {
    const attachment = getAttachmentFromWebSocket(ws);
    ws.send(JSON.stringify(this.buildSnapshot(attachment, shared)));
  }

  private broadcastSnapshots(): void {
    const shared = this.createSnapshotShared();
    for (const ws of this.state.getWebSockets()) {
      try {
        this.sendSnapshot(ws, shared);
      } catch {
        try {
          ws.close(1011, "snapshot failed");
        } catch {
          // ignore
        }
      }
    }
  }

  private broadcastEvent(filter: (a: WsAttachment | null) => boolean, payload: unknown): void {
    const msg = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      const attachment = getAttachmentFromWebSocket(ws);
      if (!filter(attachment)) continue;
      try {
        ws.send(msg);
      } catch {
        // ignore
      }
    }
  }

  private remainingNumbers(): number[] {
    const drawn = new Set<number>(this.drawnNumbers);
    if (this.pendingDraw) drawn.add(this.pendingDraw.number);
    const remaining: number[] = [];
    for (let n = 1; n <= 75; n += 1) {
      if (!drawn.has(n)) remaining.push(n);
    }
    return remaining;
  }

  private refreshPendingDrawImpact(): void {
    if (!this.pendingDraw) return;
    if (this.pendingDraw.state !== "prepared") return;
    this.pendingDraw.impact = computeImpact(this.players, this.drawnNumbers, this.pendingDraw.number);
  }

  private async ensurePendingDraw(): Promise<PendingDrawState | Response> {
    if (!this.session) return textResponse("session not found", { status: 404 });
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;
    if (this.pendingDraw) return this.pendingDraw;

    const remaining = this.remainingNumbers();
    if (remaining.length === 0) return textResponse("no numbers remaining", { status: 409 });
    const next = remaining[Math.floor(Math.random() * remaining.length)];
    const preparedAt = nowMs();
    this.pendingDraw = {
      number: next,
      preparedAt,
      impact: computeImpact(this.players, this.drawnNumbers, next),
      state: "prepared",
      reel: { ten: "idle", one: "idle" },
      stoppedDigits: { ten: null, one: null },
    };
    return this.pendingDraw;
  }

  private async handleParticipantJoin(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }
    const displayName = clampDisplayName((body as { displayName?: unknown }).displayName);
    if (!displayName) return textResponse("displayName required", { status: 400 });
    const deviceId = clampDeviceId((body as { deviceId?: unknown }).deviceId);
    if (!deviceId) return textResponse("deviceId required", { status: 400 });

    const db = getDb(this.env);
    const sessionId = this.session!.id;

    // Idempotent join per device: if the same device joins again, reuse the existing card/playerId
    // and treat it as a displayName update (no duplicate participants from one device).
    const existingRows = await db
      .select()
      .from(participants)
      .where(and(eq(participants.sessionId, sessionId), eq(participants.deviceId, deviceId)))
      .limit(1);
    if (existingRows.length) {
      const existing = existingRows[0];
      await db.update(participants).set({ displayName }).where(eq(participants.id, existing.id));
      const cached = this.players[existing.id];
      if (cached) cached.displayName = displayName;
      this.touch();
      this.broadcastSnapshots();
      return jsonResponse({ ok: true, playerId: existing.id, mode: "updated" });
    }

    const playerId = crypto.randomUUID();
    const createdAt = isoNow();
    const card = generate75BallCard();
    const progress = evaluateCard(card, this.drawnNumbers);

    try {
      await db.insert(participants).values({
        id: playerId,
        sessionId,
        deviceId,
        status: "active",
        displayName,
        cardJson: JSON.stringify(card),
        createdAt,
        disabledAt: null,
        disabledReason: null,
        disabledBy: null,
      });
    } catch {
      // Race: another tab/device might have inserted first. Re-fetch and reuse.
      const retryRows = await db
        .select()
        .from(participants)
        .where(and(eq(participants.sessionId, sessionId), eq(participants.deviceId, deviceId)))
        .limit(1);
      if (retryRows.length) {
        const existing = retryRows[0];
        await db.update(participants).set({ displayName }).where(eq(participants.id, existing.id));
        const cached = this.players[existing.id];
        if (cached) cached.displayName = displayName;
        this.touch();
        this.broadcastSnapshots();
        return jsonResponse({ ok: true, playerId: existing.id, mode: "updated" });
      }
      return textResponse("failed to create participant", { status: 500 });
    }

    this.players[playerId] = {
      id: playerId,
      status: "active",
      displayName,
      joinedAt: Date.parse(createdAt) || nowMs(),
      disabledAt: null,
      disabledReason: null,
      disabledBy: null,
      card,
      progress,
    };

    this.refreshPendingDrawImpact();
    this.touch();
    this.broadcastSnapshots();

    return jsonResponse({
      ok: true,
      playerId,
      card,
      progress,
      mode: "created",
    });
  }

  private async handleAdminPrepare(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;

    if (this.pendingDraw && (this.pendingDraw.reel.ten === "spinning" || this.pendingDraw.reel.one === "spinning")) {
      return textResponse("spinning; cannot prepare", { status: 409 });
    }

    const ensured = await this.ensurePendingDraw();
    if (ensured instanceof Response) return ensured;

    this.broadcastEvent(
      (a) => a?.role === "admin",
      { type: "draw.prepared", number: ensured.number, preparedAt: ensured.preparedAt, impact: ensured.impact },
    );
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true, pendingDraw: ensured });
  }

  private async handleAdminDevPrepare(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;

    if (this.pendingDraw && (this.pendingDraw.reel.ten === "spinning" || this.pendingDraw.reel.one === "spinning")) {
      return textResponse("spinning; cannot prepare", { status: 409 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const raw = (body as { number?: unknown }).number;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
    const number = Number.isFinite(n) ? Math.floor(n) : NaN;
    if (!Number.isFinite(number) || number < 1 || number > 75) return textResponse("number must be 1..75", { status: 400 });
    if (this.drawnNumbers.includes(number)) return textResponse("number already drawn", { status: 409 });

    const preparedAt = nowMs();
    this.pendingDraw = {
      number,
      preparedAt,
      impact: computeImpact(this.players, this.drawnNumbers, number),
      state: "prepared",
      reel: { ten: "idle", one: "idle" },
      stoppedDigits: { ten: null, one: null },
    };

    this.broadcastEvent(
      (a) => a?.role === "admin",
      { type: "draw.prepared", number, preparedAt, impact: this.pendingDraw.impact },
    );
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true, pendingDraw: this.pendingDraw });
  }

  private async handleAdminDevTune(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;

    if (this.pendingDraw && (this.pendingDraw.reel.ten === "spinning" || this.pendingDraw.reel.one === "spinning")) {
      return textResponse("spinning; cannot tune", { status: 409 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const raw = (body as { targetIntensity?: unknown }).targetIntensity;
    if (raw === null || typeof raw === "undefined") {
      this.devFxIntensityOverride = null;
    } else {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
      const v = Number.isFinite(n) ? Math.floor(n) : NaN;
      if (v !== 0 && v !== 1 && v !== 2 && v !== 3) return textResponse("targetIntensity must be 0..3 (or null)", { status: 400 });
      this.devFxIntensityOverride = v as ReachIntensity;
    }

    this.touch();
    this.broadcastSnapshots();

    return jsonResponse({
      ok: true,
      intensityOverride: this.devFxIntensityOverride,
      actualReachIntensity: reachIntensityFromCount(this.createSnapshotShared().stats.reachPlayers),
    });
  }

  private async handleAdminDevSeed(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;
    if (!this.session) return textResponse("session not found", { status: 404 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const rawCount = (body as { count?: unknown }).count;
    const n = typeof rawCount === "number" ? rawCount : typeof rawCount === "string" ? Number.parseInt(rawCount, 10) : NaN;
    const requested = Number.isFinite(n) ? Math.floor(n) : NaN;
    if (!Number.isFinite(requested) || requested <= 0) return textResponse("count must be > 0", { status: 400 });

    const rawPrefix = (body as { prefix?: unknown }).prefix;
    const prefix = typeof rawPrefix === "string" && rawPrefix.trim() ? rawPrefix.trim().slice(0, 12) : "DEV";

    const maxPlayers = 200;
    const existing = Object.keys(this.players).length;
    const capacity = Math.max(0, maxPlayers - existing);
    const addCount = Math.min(requested, capacity);
    if (addCount <= 0) return jsonResponse({ ok: true, added: 0, total: existing, maxPlayers });

    const db = getDb(this.env);
    const createdAt = isoNow();
    const joinedAt = Date.parse(createdAt) || nowMs();
    const rows: Array<{
      id: string;
      sessionId: string;
      deviceId: string;
      status: ParticipantStatus;
      displayName: string;
      cardJson: string;
      createdAt: string;
      disabledAt: null;
      disabledReason: null;
      disabledBy: null;
    }> = [];

    for (let i = 0; i < addCount; i += 1) {
      const id = crypto.randomUUID();
      const displayName = clampDisplayName(`${prefix}${String(existing + i + 1).padStart(3, "0")}`) ?? `${prefix}${existing + i + 1}`;
      const deviceId = clampDeviceId(`dev:${this.session.id}:${id}`) ?? `dev:${this.session.id}:${id}`.slice(0, 64);
      const card = generate75BallCard();
      rows.push({
        id,
        sessionId: this.session.id,
        deviceId,
        status: "active",
        displayName,
        cardJson: JSON.stringify(card),
        createdAt,
        disabledAt: null,
        disabledReason: null,
        disabledBy: null,
      });
      this.players[id] = {
        id,
        status: "active",
        displayName,
        joinedAt,
        disabledAt: null,
        disabledReason: null,
        disabledBy: null,
        card,
        progress: evaluateCard(card, this.drawnNumbers),
      };
    }

    await db.insert(participants).values(rows);

    this.refreshPendingDrawImpact();
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true, added: addCount, total: Object.keys(this.players).length, maxPlayers });
  }

  private async handleAdminDevReset(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;
    if (!this.session) return textResponse("session not found", { status: 404 });

    if (this.pendingDraw && (this.pendingDraw.reel.ten === "spinning" || this.pendingDraw.reel.one === "spinning")) {
      return textResponse("spinning; cannot reset", { status: 409 });
    }

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const revive = Boolean((body as { revive?: unknown } | null)?.revive ?? true);

    const db = getDb(this.env);
    await db.delete(drawCommits).where(eq(drawCommits.sessionId, this.session.id));
    await db.delete(participants).where(eq(participants.sessionId, this.session.id));
    if (revive) {
      await db.update(sessions).set({ status: "active", endedAt: null }).where(eq(sessions.id, this.session.id));
      this.session.status = "active";
      this.session.endedAt = null;
    }

    this.players = {};
    this.drawnNumbers = [];
    this.pendingDraw = null;
    this.devFxIntensityOverride = null;
    this.spotlight = defaultSpotlightState(nowMs());
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true, revived: revive });
  }

  private async confirmPendingDraw(): Promise<Response | null> {
    if (!this.session || !this.pendingDraw) return null;

    const number = this.pendingDraw.number;
    const beforeBingo = new Set(Object.values(this.players).filter((p) => p.status === "active" && p.progress.isBingo).map((p) => p.id));

    this.drawnNumbers.push(number);
    for (const player of Object.values(this.players)) {
      player.progress = evaluateCard(player.card, this.drawnNumbers);
    }

    const afterBingo = new Set(Object.values(this.players).filter((p) => p.status === "active" && p.progress.isBingo).map((p) => p.id));
    let newBingoCount = 0;
    const newBingoIds: string[] = [];
    for (const id of afterBingo) {
      if (beforeBingo.has(id)) continue;
      newBingoCount += 1;
      newBingoIds.push(id);
    }
    const newBingoNames = newBingoIds.map((id) => this.players[id]?.displayName ?? id);

    const seq = this.drawnNumbers.length;
    const stats = computeSessionStats(Object.values(this.players).filter((p) => p.status === "active").map((p) => p.progress));
    const committedAt = isoNow();

    const db = getDb(this.env);
    await db.insert(drawCommits).values({
      sessionId: this.session.id,
      seq,
      number,
      committedAt,
      reachCount: stats.reachPlayers,
      bingoCount: stats.bingoPlayers,
      newBingoCount,
    });

    this.pendingDraw = null;
    this.touch();

    const baseEvent = { type: "draw.committed" as const, seq, number, committedAt, stats };
    this.broadcastEvent((a) => a?.role === "participant", baseEvent);
    this.broadcastEvent((a) => a?.role === "display", newBingoNames.length ? { ...baseEvent, newBingoNames } : baseEvent);
    this.broadcastEvent(
      (a) => a?.role === "admin" || a?.role === "mod",
      newBingoIds.length ? { ...baseEvent, newBingoIds } : baseEvent,
    );
    this.broadcastSnapshots();
    return null;
  }

  private async handleAdminReel(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const action = (body as { action?: unknown }).action;
    if (action !== "go") return textResponse("action required", { status: 400 });

    if (!this.pendingDraw) return textResponse("no pending draw; press P (prepare) first", { status: 409 });
    const pending = this.pendingDraw;

    if (pending.state !== "prepared") return textResponse("not prepared", { status: 409 });
    if (pending.reel.ten !== "idle" || pending.reel.one !== "idle") return textResponse("reel not idle", { status: 409 });

    pending.state = "spinning";
    pending.reel.ten = "spinning";
    pending.reel.one = "spinning";
    pending.stoppedDigits.ten = null;
    pending.stoppedDigits.one = null;

    const startedAt = nowMs();
    this.broadcastEvent((a) => a?.role === "display", { type: "draw.spin", action: "start", digit: "ten", at: startedAt });
    this.broadcastEvent((a) => a?.role === "display", { type: "draw.spin", action: "start", digit: "one", at: startedAt });

    const reachCount = computeSessionStats(Object.values(this.players).filter((p) => p.status === "active").map((p) => p.progress)).reachPlayers;
    const actualIntensity = reachIntensityFromCount(reachCount);
    const effectiveIntensity = this.devFxIntensityOverride ?? actualIntensity;
    const timing = spinTimingForIntensity(effectiveIntensity);

    const gapMs = randomIntInclusive(timing.gapMinMs, timing.gapMaxMs);
    const firstStopAfterMs = randomIntInclusive(900, timing.totalMaxMs - gapMs);
    const secondStopAfterMs = firstStopAfterMs + gapMs;

    const firstDigit: DisplayScreen = Math.random() < 0.5 ? "ten" : "one";
    const secondDigit: DisplayScreen = firstDigit === "ten" ? "one" : "ten";

    const stopSequence = (async () => {
      const current = pending;
      const number = current.number;
      await Promise.all([
        (async () => {
          await sleepMs(firstStopAfterMs);
          if (this.pendingDraw !== current) return;
          if (current.reel[firstDigit] !== "spinning") return;
          const digitValue = digitsOf(number)[firstDigit];
          current.reel[firstDigit] = "stopped";
          current.stoppedDigits[firstDigit] = digitValue;
          this.broadcastEvent((a) => a?.role === "display", {
            type: "draw.spin",
            action: "stop",
            digit: firstDigit,
            at: nowMs(),
            digitValue,
          });
          this.touch();
          this.broadcastSnapshots();
        })(),
        (async () => {
          await sleepMs(secondStopAfterMs);
          if (this.pendingDraw !== current) return;
          if (current.reel[secondDigit] !== "spinning") return;
          const digitValue = digitsOf(number)[secondDigit];
          current.reel[secondDigit] = "stopped";
          current.stoppedDigits[secondDigit] = digitValue;
          this.broadcastEvent((a) => a?.role === "display", {
            type: "draw.spin",
            action: "stop",
            digit: secondDigit,
            at: nowMs(),
            digitValue,
          });
          this.touch();
          this.broadcastSnapshots();
        })(),
      ]);

      if (this.pendingDraw !== current) return;
      if (current.reel.ten !== "stopped" || current.reel.one !== "stopped") return;
      await this.confirmPendingDraw();
    })();

    this.state.waitUntil(stopSequence);

    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true, pendingDraw: pending });
  }

  private async handleAdminEnd(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;
    if (!this.session) return textResponse("session not found", { status: 404 });

    if (this.session.status === "ended") return jsonResponse({ ok: true, status: "ended" });

    const endedAt = isoNow();
    const db = getDb(this.env);
    await db.update(sessions).set({ status: "ended", endedAt }).where(eq(sessions.id, this.session.id));

    this.session.status = "ended";
    this.session.endedAt = endedAt;
    this.pendingDraw = null;
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true, status: "ended", endedAt });
  }

  private async handleModSpotlight(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "mod");
    if (authError) return authError;
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const ids = sanitizeSpotlightIds((body as { spotlight?: unknown }).spotlight).filter((id) => this.players[id]?.status === "active");
    const updatedBy = clampSpotlightUpdatedBy((body as { updatedBy?: unknown }).updatedBy) ?? "mod";
    const updatedAt = nowMs();

    this.spotlight = {
      version: this.spotlight.version + 1,
      ids,
      updatedAt,
      updatedBy,
    };

    const spotlightPlayers = this.spotlight.ids
      .map((id) => this.players[id])
      .filter((p): p is PlayerState => Boolean(p && p.status === "active"))
      .map((p) => ({ id: p.id, displayName: p.displayName, progress: p.progress }));

    this.broadcastEvent((a) => a?.role === "display" || a?.role === "mod" || a?.role === "admin", {
      type: "spotlight.changed",
      spotlight: {
        ...this.spotlight,
        players: spotlightPlayers,
      },
    });
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true, spotlight: this.spotlight });
  }

  private async handleModParticipantStatus(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "mod");
    if (authError) return authError;
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;
    if (!this.session) return textResponse("session not found", { status: 404 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const participantIdRaw = (body as { participantId?: unknown }).participantId;
    if (typeof participantIdRaw !== "string" || participantIdRaw.trim() === "") return textResponse("participantId required", { status: 400 });
    const participantId = participantIdRaw.trim();

    const statusRaw = (body as { status?: unknown }).status;
    const nextStatus: ParticipantStatus | null = statusRaw === "active" || statusRaw === "disabled" ? statusRaw : null;
    if (!nextStatus) return textResponse("status required", { status: 400 });

    const updatedBy = clampSpotlightUpdatedBy((body as { updatedBy?: unknown }).updatedBy) ?? "mod";
    const reason = clampDisabledReason((body as { reason?: unknown }).reason);

    const player = this.players[participantId];
    if (!player) return textResponse("participant not found", { status: 404 });

    const db = getDb(this.env);
    if (nextStatus === "disabled") {
      if (player.status !== "disabled") {
        const disabledAt = isoNow();
        await db
          .update(participants)
          .set({ status: "disabled", disabledAt, disabledReason: reason, disabledBy: updatedBy })
          .where(and(eq(participants.sessionId, this.session.id), eq(participants.id, participantId)));
        player.status = "disabled";
        player.disabledAt = Date.parse(disabledAt) || nowMs();
        player.disabledReason = reason;
        player.disabledBy = updatedBy;
      }
    } else {
      if (player.status !== "active") {
        await db
          .update(participants)
          .set({ status: "active", disabledAt: null, disabledReason: null, disabledBy: null })
          .where(and(eq(participants.sessionId, this.session.id), eq(participants.id, participantId)));
        player.status = "active";
        player.disabledAt = null;
        player.disabledReason = null;
        player.disabledBy = null;
      }
    }

    if (nextStatus === "disabled" && this.spotlight.ids.includes(participantId)) {
      const updatedAt = nowMs();
      this.spotlight = {
        version: this.spotlight.version + 1,
        ids: this.spotlight.ids.filter((id) => id !== participantId),
        updatedAt,
        updatedBy,
      };

      const spotlightPlayers = this.spotlight.ids
        .map((id) => this.players[id])
        .filter((p): p is PlayerState => Boolean(p && p.status === "active"))
        .map((p) => ({ id: p.id, displayName: p.displayName, progress: p.progress }));

      this.broadcastEvent((a) => a?.role === "display" || a?.role === "mod" || a?.role === "admin", {
        type: "spotlight.changed",
        spotlight: {
          ...this.spotlight,
          players: spotlightPlayers,
        },
      });
    }

    this.refreshPendingDrawImpact();
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const loadError = await this.ensureLoaded(request);
      if (loadError) return loadError;

      const roleRaw = url.searchParams.get("role");
      const role: Role = roleRaw === "participant" || roleRaw === "display" || roleRaw === "admin" || roleRaw === "mod" ? roleRaw : "participant";

      if (role === "admin") {
        const authError = await this.assertInvite(request, "admin");
        if (authError) return authError;
      }
      if (role === "mod") {
        const authError = await this.assertInvite(request, "mod");
        if (authError) return authError;
      }

      const attachment: WsAttachment = { role };
      if (role === "participant") {
        const playerId = url.searchParams.get("playerId");
        if (playerId && playerId.trim() !== "") attachment.playerId = playerId.trim();
      }
      if (role === "display") {
        const raw = url.searchParams.get("screen");
        if (raw === "ten" || raw === "one") attachment.screen = raw;
        else attachment.screen = "ten";
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);
      server.serializeAttachment?.(attachment);
      this.sendSnapshot(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/participant/join" && request.method === "POST") return this.handleParticipantJoin(request);
    if (url.pathname === "/admin/prepare" && request.method === "POST") return this.handleAdminPrepare(request);
    if (url.pathname === "/admin/dev/prepare" && request.method === "POST") return this.handleAdminDevPrepare(request);
    if (url.pathname === "/admin/dev/tune" && request.method === "POST") return this.handleAdminDevTune(request);
    if (url.pathname === "/admin/dev/seed" && request.method === "POST") return this.handleAdminDevSeed(request);
    if (url.pathname === "/admin/dev/reset" && request.method === "POST") return this.handleAdminDevReset(request);
    if (url.pathname === "/admin/reel" && request.method === "POST") return this.handleAdminReel(request);
    if (url.pathname === "/admin/end" && request.method === "POST") return this.handleAdminEnd(request);
    if (url.pathname === "/mod/participant/status" && request.method === "POST") return this.handleModParticipantStatus(request);
    if (url.pathname === "/mod/spotlight" && request.method === "POST") return this.handleModSpotlight(request);

    return textResponse("not found", { status: 404 });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    if (message === "ping") {
      ws.send("pong");
      return;
    }

    const parsed = parseJsonBody(message) as { type?: unknown } | null;
    if (parsed?.type === "ping") ws.send(JSON.stringify({ type: "pong", t: nowMs() }));
  }
}
