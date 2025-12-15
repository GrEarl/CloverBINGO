import { computeSessionStats, evaluateCard, generate75BallCard, type BingoCard, type BingoProgress } from "@cloverbingo/core";
import { and, asc, eq } from "drizzle-orm";

import type { Bindings } from "./bindings";
import { getDb } from "./db/client";
import { drawCommits, invites, participants, sessions } from "./db/schema";

type Role = "participant" | "display" | "admin" | "mod";
type DisplayScreen = "ten" | "one";

type ReelStatus = "idle" | "spinning" | "stopped";

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
  displayName: string;
  joinedAt: number;
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
  displayName: string;
  joinedAt: number;
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

function clampSpotlightUpdatedBy(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 1) return null;
  if (trimmed.length > 32) return trimmed.slice(0, 32);
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
          this.players[row.id] = {
            id: row.id,
            displayName: row.displayName,
            joinedAt: Date.parse(row.createdAt) || nowMs(),
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

    const stats = computeSessionStats(playersList.map((p) => p.progress));
    const lastNumber = this.drawnNumbers.length > 0 ? this.drawnNumbers[this.drawnNumbers.length - 1] : null;
    const lastNumbers = this.drawnNumbers.slice(-10);

    const spotlightPlayers = this.spotlight.ids
      .map((id) => this.players[id])
      .filter(Boolean)
      .map((p) => ({ id: p.id, displayName: p.displayName, progress: p.progress }));

    let privilegedCache: PrivilegedPlayerSnapshot[] | null = null;
    function getPrivilegedPlayers(): PrivilegedPlayerSnapshot[] {
      if (privilegedCache) return privilegedCache;
      privilegedCache = playersList.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        joinedAt: p.joinedAt,
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
              displayName: player.displayName,
              joinedAt: player.joinedAt,
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
      return {
        ...base,
        role: "display",
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

    const playerId = crypto.randomUUID();
    const createdAt = isoNow();
    const card = generate75BallCard();
    const progress = evaluateCard(card, this.drawnNumbers);

    const db = getDb(this.env);
    await db.insert(participants).values({
      id: playerId,
      sessionId: this.session!.id,
      displayName,
      cardJson: JSON.stringify(card),
      createdAt,
    });

    this.players[playerId] = {
      id: playerId,
      displayName,
      joinedAt: Date.parse(createdAt) || nowMs(),
      card,
      progress,
    };

    this.touch();
    this.broadcastSnapshots();

    return jsonResponse({
      ok: true,
      playerId,
      card,
      progress,
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

  private async confirmPendingDraw(): Promise<Response | null> {
    if (!this.session || !this.pendingDraw) return null;

    const number = this.pendingDraw.number;
    const beforeBingo = new Set(Object.values(this.players).filter((p) => p.progress.isBingo).map((p) => p.id));

    this.drawnNumbers.push(number);
    for (const player of Object.values(this.players)) {
      player.progress = evaluateCard(player.card, this.drawnNumbers);
    }

    const afterBingo = new Set(Object.values(this.players).filter((p) => p.progress.isBingo).map((p) => p.id));
    let newBingoCount = 0;
    const newBingoIds: string[] = [];
    for (const id of afterBingo) {
      if (beforeBingo.has(id)) continue;
      newBingoCount += 1;
      newBingoIds.push(id);
    }

    const seq = this.drawnNumbers.length;
    const stats = computeSessionStats(Object.values(this.players).map((p) => p.progress));
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
    this.broadcastEvent((a) => a?.role === "participant" || a?.role === "display", baseEvent);
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

    const stopTenAfterMs = randomIntInclusive(850, 1700);
    const stopOneAfterMs = randomIntInclusive(850, 1700);

    const stopSequence = (async () => {
      const current = pending;
      const number = current.number;
      await Promise.all([
        (async () => {
          await sleepMs(stopTenAfterMs);
          if (this.pendingDraw !== current) return;
          if (current.reel.ten !== "spinning") return;
          const digitValue = digitsOf(number).ten;
          current.reel.ten = "stopped";
          current.stoppedDigits.ten = digitValue;
          this.broadcastEvent((a) => a?.role === "display", {
            type: "draw.spin",
            action: "stop",
            digit: "ten",
            at: nowMs(),
            digitValue,
          });
          this.touch();
          this.broadcastSnapshots();
        })(),
        (async () => {
          await sleepMs(stopOneAfterMs);
          if (this.pendingDraw !== current) return;
          if (current.reel.one !== "spinning") return;
          const digitValue = digitsOf(number).one;
          current.reel.one = "stopped";
          current.stoppedDigits.one = digitValue;
          this.broadcastEvent((a) => a?.role === "display", {
            type: "draw.spin",
            action: "stop",
            digit: "one",
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

    const ids = sanitizeSpotlightIds((body as { spotlight?: unknown }).spotlight).filter((id) => Boolean(this.players[id]));
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
      .filter(Boolean)
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
    if (url.pathname === "/admin/reel" && request.method === "POST") return this.handleAdminReel(request);
    if (url.pathname === "/admin/end" && request.method === "POST") return this.handleAdminEnd(request);
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
