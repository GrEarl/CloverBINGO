import { computeSessionStats, evaluateCard, generate75BallCard, type BingoCard, type BingoProgress } from "@cloverbingo/core";
import { and, asc, eq } from "drizzle-orm";

import type { Bindings } from "./bindings";
import { getDb } from "./db/client";
import { drawCommits, invites, participants, sessions } from "./db/schema";

type Role = "participant" | "display" | "admin" | "mod" | "observer";
type DisplayScreen = "ten" | "one";

type ReelStatus = "idle" | "spinning" | "stopped";
type ReachIntensity = 0 | 1 | 2 | 3;
type ParticipantStatus = "active" | "disabled";

const ADMIN_INVITE_COOKIE = "cloverbingo_admin";
const MOD_INVITE_COOKIE = "cloverbingo_mod";
const OBSERVER_INVITE_COOKIE = "cloverbingo_observer";
const MAX_PLAYERS = 200;
const MAX_EVENT_LOG = 200;
const MAX_ERROR_LOG = 120;

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

type PendingPreview = {
  newBingoIds: string[];
  newBingoNames: string[];
};

type BingoApprovalState = {
  participantId: string;
  firstBingoAt: number;
  approvedAt: number | null;
  acknowledgedAt: number | null;
  approvedBy: string | null;
};

type AudioStatus = {
  bgm: {
    label: string | null;
    state: "playing" | "paused" | "stopped";
    updatedAt: number | null;
  };
  sfx: {
    label: string | null;
    at: number | null;
  };
};

type ObserverEvent = {
  id: number;
  at: number;
  type: string;
  role?: Role;
  by?: string | null;
  detail?: string | null;
};

type ObserverError = {
  id: number;
  at: number;
  scope: string;
  message: string;
  detail?: string | null;
};

type ConnectionInfo = {
  id: string;
  role: Role;
  screen?: DisplayScreen;
  playerId?: string;
  connectedAt: number;
};

type LastCommitSummary = {
  seq: number;
  number: number;
  committedAt: string;
  openedPlayers: number;
  newBingoNames: string[];
};

type PlayerState = {
  id: string;
  status: ParticipantStatus;
  deviceId: string | null;
  displayName: string;
  joinedAt: number;
  disabledAt: number | null;
  disabledReason: string | null;
  disabledBy: string | null;
  card: BingoCard;
  progress: BingoProgress;
};

function countActivePlayers(players: Record<string, PlayerState>): number {
  return Object.values(players).filter((p) => p.status === "active").length;
}

function buildCapacityWarning(activeCount: number): string | null {
  if (activeCount <= MAX_PLAYERS) return null;
  return `参加者が${activeCount}人になりました（目安${MAX_PLAYERS}人を超えています）。混雑時は表示遅延の可能性があります。`;
}

type WsAttachment = {
  role: Role;
  playerId?: string;
  screen?: DisplayScreen;
  connectedAt?: number;
  connectionId?: string;
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

function clampAudioLabel(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 1) return null;
  if (trimmed.length > 80) return trimmed.slice(0, 80);
  return trimmed;
}

function clampLogToken(input: unknown, maxLen: number): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 1) return null;
  if (trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  return trimmed;
}

function clampKeyInput(input: unknown): string | null {
  return clampLogToken(input, 12);
}

function clampLogDetail(input: unknown): string | null {
  return clampLogToken(input, 80);
}

function sanitizeSpotlightIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === "string").slice(0, 6);
}

function sanitizeParticipantIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()).slice(0, 200);
}

function defaultSpotlightState(t: number): SpotlightState {
  return { version: 0, ids: [], updatedAt: t, updatedBy: "system" };
}

function digitsOf(n: number): { ten: number; one: number } {
  const normalized = ((n % 100) + 100) % 100;
  return { ten: Math.floor(normalized / 10), one: normalized % 10 };
}

function countPlayersWithNumber(players: Record<string, PlayerState>, n: number): number {
  let count = 0;
  for (const player of Object.values(players)) {
    if (player.status !== "active") continue;
    const card = player.card;
    for (const row of card) {
      if (row.includes(n)) {
        count += 1;
        break;
      }
    }
  }
  return count;
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

function computePendingPreview(players: Record<string, PlayerState>, hypotheticallyDrawn: number[], nextNumber: number): PendingPreview {
  const beforeBingo = new Set<string>();
  for (const player of Object.values(players)) {
    if (player.status !== "active") continue;
    if (player.progress.isBingo) beforeBingo.add(player.id);
  }

  const nextDrawn = hypotheticallyDrawn.concat([nextNumber]);
  const newBingoIds: string[] = [];
  for (const player of Object.values(players)) {
    if (player.status !== "active") continue;
    const progress = evaluateCard(player.card, nextDrawn);
    if (progress.isBingo && !beforeBingo.has(player.id)) {
      newBingoIds.push(player.id);
    }
  }
  const newBingoNames = newBingoIds.map((id) => players[id]?.displayName ?? id);
  return { newBingoIds, newBingoNames };
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
  private eventSeq = 0;
  private errorSeq = 0;
  private eventLog: ObserverEvent[] = [];
  private errorLog: ObserverError[] = [];
  private eventCounts: Record<string, number> = {};
  private audioStatus: AudioStatus = {
    bgm: { label: null, state: "stopped", updatedAt: null },
    sfx: { label: null, at: null },
  };
  private lastCommit: LastCommitSummary | null = null;
  private devFxIntensityOverride: ReachIntensity | null = null;
  private spotlight: SpotlightState = defaultSpotlightState(nowMs());
  private bingoApprovals: Record<string, BingoApprovalState> = {};
  private bingoApprovalRequired = true;

  constructor(private readonly state: DurableObjectState, private readonly env: Bindings) {}

  private touch(): void {
    this.updatedAt = nowMs();
  }

  private persistBingoApprovals(): void {
    this.state.waitUntil(this.state.storage.put("bingoApprovals", this.bingoApprovals));
  }

  private ensureBingoApprovalState(participantId: string, at: number): BingoApprovalState {
    const existing = this.bingoApprovals[participantId];
    if (existing) return existing;
    const created: BingoApprovalState = {
      participantId,
      firstBingoAt: at,
      approvedAt: null,
      acknowledgedAt: null,
      approvedBy: null,
    };
    this.bingoApprovals[participantId] = created;
    return created;
  }

  private listBingoApprovals(): BingoApprovalState[] {
    return Object.values(this.bingoApprovals).sort((a, b) => a.firstBingoAt - b.firstBingoAt);
  }

  private pushEvent(entry: Omit<ObserverEvent, "id" | "at"> & { at?: number }): void {
    const at = entry.at ?? nowMs();
    const id = ++this.eventSeq;
    this.eventLog.push({ id, at, ...entry });
    if (this.eventLog.length > MAX_EVENT_LOG) {
      this.eventLog.splice(0, this.eventLog.length - MAX_EVENT_LOG);
    }
    this.eventCounts[entry.type] = (this.eventCounts[entry.type] ?? 0) + 1;
  }

  private pushError(scope: string, err: unknown, detail?: string | null): void {
    const message = err instanceof Error ? err.message : String(err);
    const id = ++this.errorSeq;
    this.errorLog.push({ id, at: nowMs(), scope, message, detail: detail ?? null });
    if (this.errorLog.length > MAX_ERROR_LOG) {
      this.errorLog.splice(0, this.errorLog.length - MAX_ERROR_LOG);
    }
  }

  private buildConnections(): ConnectionInfo[] {
    const list: ConnectionInfo[] = [];
    for (const ws of this.state.getWebSockets()) {
      const attachment = getAttachmentFromWebSocket(ws);
      if (!attachment) continue;
      list.push({
        id: attachment.connectionId ?? "unknown",
        role: attachment.role,
        screen: attachment.screen,
        playerId: attachment.playerId,
        connectedAt: attachment.connectedAt ?? nowMs(),
      });
    }
    return list;
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
            deviceId: row.deviceId ?? null,
            displayName: row.displayName,
            joinedAt: Date.parse(row.createdAt) || nowMs(),
            disabledAt: Number.isFinite(disabledAtMs) ? disabledAtMs : null,
            disabledReason: row.disabledReason ?? null,
            disabledBy: row.disabledBy ?? null,
            card,
            progress: evaluateCard(card, this.drawnNumbers),
          };
        }

        const storedApprovals = await this.state.storage.get<Record<string, BingoApprovalState>>("bingoApprovals");
        if (storedApprovals && typeof storedApprovals === "object") {
          this.bingoApprovals = storedApprovals;
        }
        const storedRequired = await this.state.storage.get<boolean>("bingoApprovalRequired");
        if (typeof storedRequired === "boolean") {
          this.bingoApprovalRequired = storedRequired;
        }
        const seedAt = nowMs();
        let seeded = false;
        for (const player of Object.values(this.players)) {
          if (!player.progress.isBingo) continue;
          if (this.bingoApprovals[player.id]) continue;
          this.bingoApprovals[player.id] = {
            participantId: player.id,
            firstBingoAt: seedAt,
            approvedAt: seedAt,
            acknowledgedAt: seedAt,
            approvedBy: "system",
          };
          seeded = true;
        }
        if (seeded) this.persistBingoApprovals();

        if (commitRows.length > 0) {
          const lastCommitRow = commitRows[commitRows.length - 1];
          const prevDrawn = this.drawnNumbers.slice(0, -1);
          const newBingoNames: string[] = [];
          for (const player of Object.values(this.players)) {
            if (player.status !== "active") continue;
            const prev = evaluateCard(player.card, prevDrawn);
            if (prev.isBingo) continue;
            const next = evaluateCard(player.card, this.drawnNumbers);
            if (next.isBingo) newBingoNames.push(player.displayName);
          }
          this.lastCommit = {
            seq: lastCommitRow.seq,
            number: lastCommitRow.number,
            committedAt: lastCommitRow.committedAt,
            openedPlayers: countPlayersWithNumber(this.players, lastCommitRow.number),
            newBingoNames,
          };
        } else {
          this.lastCommit = null;
        }

        this.updatedAt = loadedUpdatedAt || nowMs();
        this.loaded = true;
      })();
    }

    try {
      await this.loadPromise;
    } catch (err) {
      console.error("failed to load session", err);
      this.pushError("ensureLoaded", err);
      this.loadPromise = null;
      this.loaded = false;
      return textResponse("failed to load session", { status: 500 });
    }
    if (!this.session) {
      this.loadPromise = null;
      return textResponse("session not found", { status: 404 });
    }
    return null;
  }

  private assertActiveSession(): Response | null {
    if (!this.session) return textResponse("session not found", { status: 404 });
    if (this.session.status !== "active") return textResponse("session ended", { status: 410 });
    return null;
  }

  private async assertInvite(request: Request, requiredRole: "admin" | "mod" | "observer"): Promise<Response | null> {
    if (!this.session) return textResponse("session not found", { status: 404 });
    const cookieName =
      requiredRole === "admin" ? ADMIN_INVITE_COOKIE : requiredRole === "mod" ? MOD_INVITE_COOKIE : OBSERVER_INVITE_COOKIE;
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
      bingoApprovalRequired: this.bingoApprovalRequired,
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
      const approval = player ? this.bingoApprovals[player.id] ?? null : null;
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
        bingoApproval: approval
          ? {
              firstBingoAt: approval.firstBingoAt,
              approvedAt: approval.approvedAt,
              acknowledgedAt: approval.acknowledgedAt,
              approvedBy: approval.approvedBy,
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
    const approvalSummaries = this.listBingoApprovals().map((entry) => ({
      participantId: entry.participantId,
      displayName: this.players[entry.participantId]?.displayName ?? entry.participantId,
      firstBingoAt: entry.firstBingoAt,
      approvedAt: entry.approvedAt,
      acknowledgedAt: entry.acknowledgedAt,
      approvedBy: entry.approvedBy,
    }));

    if (attachment.role === "mod") {
      return {
        ...base,
        role: "mod",
        drawnNumbers: this.drawnNumbers,
        players,
        bingoApprovals: approvalSummaries,
      };
    }

    if (attachment.role === "admin") {
      return {
        ...base,
        role: "admin",
        drawnNumbers: this.drawnNumbers,
        players,
        bingoApprovals: approvalSummaries,
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

    if (attachment.role === "observer") {
      const preview = this.pendingDraw ? computePendingPreview(this.players, this.drawnNumbers, this.pendingDraw.number) : null;
      return {
        ...base,
        role: "observer",
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
              preview,
            }
          : null,
        eventLog: this.eventLog,
        errorLog: this.errorLog,
        eventCounts: this.eventCounts,
        audio: this.audioStatus,
        connections: this.buildConnections(),
        lastCommit: this.lastCommit,
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
    const roleCounts: Partial<Record<Role, number>> = {};
    let total = 0;
    for (const ws of this.state.getWebSockets()) {
      const attachment = getAttachmentFromWebSocket(ws);
      if (!filter(attachment)) continue;
      try {
        ws.send(msg);
      } catch {
        // ignore
      }
      total += 1;
      if (attachment?.role) roleCounts[attachment.role] = (roleCounts[attachment.role] ?? 0) + 1;
    }

    const payloadType = (payload as { type?: unknown } | null)?.type;
    if (typeof payloadType === "string") {
      const roleDetail = Object.entries(roleCounts)
        .map(([role, count]) => `${role}=${count}`)
        .join(" ");
      const detailParts = [`type=${payloadType}`, `targets=${total}`];
      if (roleDetail) detailParts.push(roleDetail);
      this.pushEvent({ type: "event.emit", detail: detailParts.join(" ") });
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
      if (cached) {
        cached.displayName = displayName;
        if (!cached.deviceId && existing.deviceId) cached.deviceId = existing.deviceId;
      }
      const warning = buildCapacityWarning(countActivePlayers(this.players));
      this.touch();
      this.broadcastSnapshots();
      return jsonResponse({ ok: true, playerId: existing.id, mode: "updated", warning });
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
        if (cached) {
          cached.displayName = displayName;
          if (!cached.deviceId && existing.deviceId) cached.deviceId = existing.deviceId;
        }
        const warning = buildCapacityWarning(countActivePlayers(this.players));
        this.touch();
        this.broadcastSnapshots();
        return jsonResponse({ ok: true, playerId: existing.id, mode: "updated", warning });
      }
      return textResponse("failed to create participant", { status: 500 });
    }

    this.players[playerId] = {
      id: playerId,
      status: "active",
      deviceId,
      displayName,
      joinedAt: Date.parse(createdAt) || nowMs(),
      disabledAt: null,
      disabledReason: null,
      disabledBy: null,
      card,
      progress,
    };

    const warning = buildCapacityWarning(countActivePlayers(this.players));
    this.refreshPendingDrawImpact();
    this.touch();
    this.broadcastSnapshots();

    return jsonResponse({
      ok: true,
      playerId,
      card,
      progress,
      mode: "created",
      warning,
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

    this.pushEvent({ type: "admin.prepare", role: "admin", detail: `number=${ensured.number}` });
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

    this.pushEvent({ type: "admin.dev.prepare", role: "admin", detail: `number=${number}` });
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

    this.pushEvent({
      type: "admin.dev.tune",
      role: "admin",
      detail: this.devFxIntensityOverride === null ? "auto" : `intensity=${this.devFxIntensityOverride}`,
    });
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

    const maxPlayers = MAX_PLAYERS;
    const existing = Object.keys(this.players).length;
    const capacity = Math.max(0, maxPlayers - existing);
    const addCount = Math.min(requested, capacity);
    if (addCount <= 0) return jsonResponse({ ok: true, added: 0, total: existing, maxPlayers });

    const db = getDb(this.env);
    const createdAt = isoNow();
    const joinedAt = Date.parse(createdAt) || nowMs();
    const toInsert: Array<{
      row: {
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
      };
      player: PlayerState;
    }> = [];

    for (let i = 0; i < addCount; i += 1) {
      const id = crypto.randomUUID();
      const displayName = clampDisplayName(`${prefix}${String(existing + i + 1).padStart(3, "0")}`) ?? `${prefix}${existing + i + 1}`;
      const deviceId = clampDeviceId(`dev:${this.session.id}:${id}`) ?? `dev:${this.session.id}:${id}`.slice(0, 64);
      const card = generate75BallCard();
      toInsert.push({
        row: {
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
        },
        player: {
          id,
          status: "active",
          deviceId,
          displayName,
          joinedAt,
          disabledAt: null,
          disabledReason: null,
          disabledBy: null,
          card,
          progress: evaluateCard(card, this.drawnNumbers),
        },
      });
    }

    // NOTE: Drizzle(D1) multi-row insert can fail in some environments; keep this dev-only path robust
    // by inserting row-by-row (max 200).
    try {
      for (const item of toInsert) {
        await db.insert(participants).values(item.row);
        this.players[item.player.id] = item.player;
      }
    } catch (err) {
      this.pushError("admin.dev.seed", err instanceof Error ? err.message : String(err));
      const msg = err instanceof Error ? err.message : "failed to seed participants";
      return textResponse(`seed failed: ${msg}`, { status: 500 });
    }

    this.pushEvent({ type: "admin.dev.seed", role: "admin", detail: `added=${addCount}` });
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
    this.lastCommit = null;
    this.bingoApprovals = {};
    this.persistBingoApprovals();
    this.pushEvent({ type: "admin.dev.reset", role: "admin", detail: revive ? "revive" : "no-revive" });
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true, revived: revive });
  }

  private async confirmPendingDraw(): Promise<Response | null> {
    if (!this.session || !this.pendingDraw) return null;

    const number = this.pendingDraw.number;
    const activePlayers = Object.values(this.players).filter((p) => p.status === "active");
    const beforeBingo = new Set(activePlayers.filter((p) => p.progress.isBingo).map((p) => p.id));

    const nextDrawnNumbers = this.drawnNumbers.concat([number]);
    const nextProgressById: Record<string, BingoProgress> = {};
    for (const player of Object.values(this.players)) {
      nextProgressById[player.id] = evaluateCard(player.card, nextDrawnNumbers);
    }

    const afterBingo = new Set(activePlayers.filter((p) => nextProgressById[p.id]?.isBingo).map((p) => p.id));
    let newBingoCount = 0;
    const newBingoIds: string[] = [];
    for (const id of afterBingo) {
      if (beforeBingo.has(id)) continue;
      newBingoCount += 1;
      newBingoIds.push(id);
    }
    const newBingoNames = newBingoIds.map((id) => this.players[id]?.displayName ?? id);
    if (newBingoIds.length) {
      const stamp = nowMs();
      let changed = false;
      for (const id of newBingoIds) {
        if (!this.bingoApprovals[id]) {
          const entry = this.ensureBingoApprovalState(id, stamp);
          if (!this.bingoApprovalRequired) {
            entry.approvedAt = stamp;
            entry.acknowledgedAt = stamp;
            entry.approvedBy = "system";
          }
          changed = true;
        }
      }
      if (changed) this.persistBingoApprovals();
    }

    const seq = nextDrawnNumbers.length;
    const stats = computeSessionStats(activePlayers.map((p) => nextProgressById[p.id]));
    const committedAt = isoNow();

    const db = getDb(this.env);
    try {
      await db.insert(drawCommits).values({
        sessionId: this.session.id,
        seq,
        number,
        committedAt,
        reachCount: stats.reachPlayers,
        bingoCount: stats.bingoPlayers,
        newBingoCount,
      });
    } catch (err) {
      console.error("commit failed", err);
      this.pushError("commit", err);
      if (this.pendingDraw) {
        this.pendingDraw.state = "prepared";
        this.pendingDraw.reel.ten = "idle";
        this.pendingDraw.reel.one = "idle";
        this.pendingDraw.stoppedDigits.ten = null;
        this.pendingDraw.stoppedDigits.one = null;
      }
      this.touch();
      this.broadcastSnapshots();
      return textResponse("commit failed", { status: 500 });
    }

    const openedPlayers = countPlayersWithNumber(this.players, number);
    this.lastCommit = {
      seq,
      number,
      committedAt,
      openedPlayers,
      newBingoNames,
    };
    this.pushEvent({ type: "draw.committed", detail: `number=${number} newBingo=${newBingoNames.length}` });

    this.drawnNumbers = nextDrawnNumbers;
    for (const player of Object.values(this.players)) {
      const nextProgress = nextProgressById[player.id];
      if (nextProgress) player.progress = nextProgress;
    }

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

    this.pushEvent({ type: "admin.go", role: "admin", detail: `number=${pending.number}` });
    pending.state = "spinning";
    pending.reel.ten = "spinning";
    pending.reel.one = "spinning";
    pending.stoppedDigits.ten = null;
    pending.stoppedDigits.one = null;

    const startedAt = nowMs();
    this.broadcastEvent((a) => a?.role === "display", { type: "draw.spin", action: "start", digit: "ten", at: startedAt });
    this.broadcastEvent((a) => a?.role === "display", { type: "draw.spin", action: "start", digit: "one", at: startedAt });
    this.pushEvent({ type: "draw.spin.start", detail: "digit=ten" });
    this.pushEvent({ type: "draw.spin.start", detail: "digit=one" });

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
          this.pushEvent({ type: "draw.spin.stop", detail: `digit=${firstDigit} value=${digitValue}` });
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
          this.pushEvent({ type: "draw.spin.stop", detail: `digit=${secondDigit} value=${digitValue}` });
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

  private async handleAdminAudio(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    let touched = false;
    const bgm = (body as { bgm?: unknown }).bgm;
    if (bgm && typeof bgm === "object") {
      const label = clampAudioLabel((bgm as { label?: unknown }).label);
      const stateRaw = (bgm as { state?: unknown }).state;
      const state = stateRaw === "playing" || stateRaw === "paused" || stateRaw === "stopped" ? stateRaw : null;
      if (state) {
        const nextLabel = label ?? null;
        if (this.audioStatus.bgm.state !== state || this.audioStatus.bgm.label !== nextLabel) {
          this.audioStatus.bgm = {
            label: nextLabel,
            state,
            updatedAt: nowMs(),
          };
          this.pushEvent({ type: "audio.bgm", role: "admin", detail: label ? `${state} ${label}` : state });
          touched = true;
        }
      }
    }

    const sfx = (body as { sfx?: unknown }).sfx;
    if (sfx && typeof sfx === "object") {
      const label = clampAudioLabel((sfx as { label?: unknown }).label);
      if (label) {
        this.audioStatus.sfx = {
          label,
          at: nowMs(),
        };
        touched = true;
      }
    }

    if (touched) {
      this.touch();
      this.broadcastSnapshots();
    }

    return jsonResponse({ ok: true, audio: this.audioStatus });
  }

  private async handleAdminKey(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const key = clampKeyInput((body as { key?: unknown }).key);
    if (!key) return textResponse("key required", { status: 400 });

    const actionRaw = (body as { action?: unknown }).action;
    const action = actionRaw === "prepare" || actionRaw === "go" ? actionRaw : null;
    const allowedRaw = (body as { allowed?: unknown }).allowed;
    const allowed = typeof allowedRaw === "boolean" ? allowedRaw : null;
    const reason = clampLogDetail((body as { reason?: unknown }).reason);

    const detailParts = [`key=${key}`];
    if (action) detailParts.push(`action=${action}`);
    if (allowed !== null) detailParts.push(`allowed=${allowed ? "1" : "0"}`);
    if (reason) detailParts.push(`reason=${reason}`);
    this.pushEvent({ type: "admin.key", role: "admin", detail: detailParts.join(" ") });
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true });
  }

  private async handleAdminBingoSetting(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "admin");
    if (authError) return authError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const requiredRaw = (body as { required?: unknown }).required;
    if (typeof requiredRaw !== "boolean") return textResponse("required must be boolean", { status: 400 });

    const prev = this.bingoApprovalRequired;
    this.bingoApprovalRequired = requiredRaw;
    if (prev !== requiredRaw) {
      this.state.waitUntil(this.state.storage.put("bingoApprovalRequired", this.bingoApprovalRequired));
      if (!this.bingoApprovalRequired) {
        const stamp = nowMs();
        let changed = false;
        for (const entry of Object.values(this.bingoApprovals)) {
          if (entry.approvedAt === null) {
            entry.approvedAt = stamp;
            entry.approvedBy = "system";
            changed = true;
          }
          if (entry.acknowledgedAt === null) {
            entry.acknowledgedAt = stamp;
            changed = true;
          }
        }
        if (changed) this.persistBingoApprovals();
      }
      this.pushEvent({
        type: "admin.bingo.setting",
        role: "admin",
        detail: this.bingoApprovalRequired ? "required=1" : "required=0",
      });
      this.touch();
      this.broadcastSnapshots();
    }

    return jsonResponse({ ok: true, required: this.bingoApprovalRequired });
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
    this.pushEvent({ type: "admin.end", role: "admin" });
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

    this.pushEvent({
      type: "mod.spotlight",
      role: "mod",
      by: updatedBy,
      detail: ids.length ? ids.map((id) => this.players[id]?.displayName ?? id).join(", ") : "empty",
    });

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

    this.pushEvent({
      type: "mod.participant.status",
      role: "mod",
      by: updatedBy,
      detail: `${player.displayName} -> ${nextStatus}`,
    });

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

  private async handleModBingoApprove(request: Request): Promise<Response> {
    const loadError = await this.ensureLoaded(request);
    if (loadError) return loadError;
    const authError = await this.assertInvite(request, "mod");
    if (authError) return authError;
    const activeError = this.assertActiveSession();
    if (activeError) return activeError;

    if (!this.bingoApprovalRequired) {
      return jsonResponse({ ok: true, approved: 0, disabled: true });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const approveAll = Boolean((body as { approveAll?: unknown }).approveAll);
    const ids = approveAll ? [] : sanitizeParticipantIds((body as { participantIds?: unknown }).participantIds);
    const updatedBy = clampSpotlightUpdatedBy((body as { updatedBy?: unknown }).updatedBy) ?? "mod";

    const pending = this.listBingoApprovals().filter((entry) => entry.approvedAt === null && entry.acknowledgedAt === null);
    const targets = approveAll ? pending.map((entry) => entry.participantId) : ids;

    let changed = false;
    const approvedAt = nowMs();
    for (const id of targets) {
      const entry = this.bingoApprovals[id];
      if (!entry) continue;
      if (entry.approvedAt !== null || entry.acknowledgedAt !== null) continue;
      entry.approvedAt = approvedAt;
      entry.approvedBy = updatedBy;
      changed = true;
    }

    if (changed) {
      this.persistBingoApprovals();
      this.pushEvent({
        type: "mod.bingo.approve",
        role: "mod",
        by: updatedBy,
        detail: approveAll ? `approveAll count=${targets.length}` : `count=${targets.length}`,
      });
      this.touch();
      this.broadcastSnapshots();
    }

    return jsonResponse({ ok: true, approved: targets.length });
  }

  private async handleParticipantBingoAck(request: Request): Promise<Response> {
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

    const participantIdRaw = (body as { participantId?: unknown }).participantId;
    const participantId = typeof participantIdRaw === "string" ? participantIdRaw.trim() : "";
    const deviceId = clampDeviceId((body as { deviceId?: unknown }).deviceId);
    if (!participantId) return textResponse("participantId required", { status: 400 });
    if (!deviceId) return textResponse("deviceId required", { status: 400 });

    const player = this.players[participantId];
    if (!player) return textResponse("participant not found", { status: 404 });

    if (player.deviceId && player.deviceId !== deviceId) return textResponse("forbidden", { status: 403 });
    if (!player.deviceId) {
      const db = getDb(this.env);
      const rows = await db
        .select()
        .from(participants)
        .where(and(eq(participants.sessionId, this.session!.id), eq(participants.id, participantId), eq(participants.deviceId, deviceId)))
        .limit(1);
      if (!rows.length) return textResponse("forbidden", { status: 403 });
      player.deviceId = deviceId;
    }

    const entry = this.bingoApprovals[participantId];
    if (!entry) return textResponse("bingo approval not found", { status: 409 });
    if (entry.acknowledgedAt) return jsonResponse({ ok: true, acknowledgedAt: entry.acknowledgedAt });
    if (!entry.approvedAt && this.bingoApprovalRequired) return textResponse("not approved yet", { status: 409 });

    entry.acknowledgedAt = nowMs();
    this.persistBingoApprovals();
    this.pushEvent({ type: "participant.bingo.ack", role: "participant", detail: participantId });
    this.touch();
    this.broadcastSnapshots();
    return jsonResponse({ ok: true, acknowledgedAt: entry.acknowledgedAt });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const loadError = await this.ensureLoaded(request);
      if (loadError) return loadError;

      const roleRaw = url.searchParams.get("role");
      const role: Role =
        roleRaw === "participant" || roleRaw === "display" || roleRaw === "admin" || roleRaw === "mod" || roleRaw === "observer"
          ? roleRaw
          : "participant";

      if (role === "admin") {
        const authError = await this.assertInvite(request, "admin");
        if (authError) return authError;
      }
      if (role === "mod") {
        const authError = await this.assertInvite(request, "mod");
        if (authError) return authError;
      }
      if (role === "observer") {
        const authError = await this.assertInvite(request, "observer");
        if (authError) return authError;
      }

      const attachment: WsAttachment = { role, connectedAt: nowMs(), connectionId: crypto.randomUUID() };
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
      const detailParts: string[] = [];
      if (attachment.playerId) detailParts.push(`player=${attachment.playerId.slice(0, 8)}`);
      if (attachment.screen) detailParts.push(`screen=${attachment.screen}`);
      this.pushEvent({
        type: "ws.open",
        role: attachment.role,
        detail: detailParts.length ? detailParts.join(" ") : null,
      });
      this.touch();
      this.broadcastSnapshots();
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/participant/join" && request.method === "POST") return this.handleParticipantJoin(request);
    if (url.pathname === "/admin/prepare" && request.method === "POST") return this.handleAdminPrepare(request);
    if (url.pathname === "/admin/dev/prepare" && request.method === "POST") return this.handleAdminDevPrepare(request);
    if (url.pathname === "/admin/dev/tune" && request.method === "POST") return this.handleAdminDevTune(request);
    if (url.pathname === "/admin/dev/seed" && request.method === "POST") return this.handleAdminDevSeed(request);
    if (url.pathname === "/admin/dev/reset" && request.method === "POST") return this.handleAdminDevReset(request);
    if (url.pathname === "/admin/reel" && request.method === "POST") return this.handleAdminReel(request);
    if (url.pathname === "/admin/audio" && request.method === "POST") return this.handleAdminAudio(request);
    if (url.pathname === "/admin/bingo/setting" && request.method === "POST") return this.handleAdminBingoSetting(request);
    if (url.pathname === "/admin/key" && request.method === "POST") return this.handleAdminKey(request);
    if (url.pathname === "/admin/end" && request.method === "POST") return this.handleAdminEnd(request);
    if (url.pathname === "/participant/bingo/ack" && request.method === "POST") return this.handleParticipantBingoAck(request);
    if (url.pathname === "/mod/bingo/approve" && request.method === "POST") return this.handleModBingoApprove(request);
    if (url.pathname === "/mod/participant/status" && request.method === "POST") return this.handleModParticipantStatus(request);
    if (url.pathname === "/mod/spotlight" && request.method === "POST") return this.handleModSpotlight(request);

    return textResponse("not found", { status: 404 });
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const attachment = getAttachmentFromWebSocket(ws);
    const detail = reason ? `code=${code} reason=${reason}` : `code=${code}`;
    this.pushEvent({
      type: "ws.close",
      role: attachment?.role,
      detail,
    });
    this.touch();
    this.broadcastSnapshots();
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
