import { evaluateCard, generate75BallCard, type BingoCard, type BingoProgress } from "@cloverbingo/core";

type Role = "participant" | "display" | "admin" | "mod";
type DisplayScreen = "ten" | "one";

type ReelStatus = "idle" | "spinning" | "stopped";

const ADMIN_TOKEN_COOKIE = "cloverbingo_admin";
const MOD_TOKEN_COOKIE = "cloverbingo_mod";
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

type SpotlightState = {
  version: number;
  ids: string[];
  updatedAt: number;
  updatedBy: string | null;
};

type SpotlightStateV1Legacy = {
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

type PersistedSessionStateV1Legacy = {
  version: 1;
  sessionCode: string;
  adminToken: string;
  modToken: string;
  createdAt: number;
  updatedAt: number;
  drawCount: number;
  drawnNumbers: number[];
  bag: number[];
  pendingDraw: PendingDrawState | null;
  spotlight: SpotlightStateV1Legacy;
  players: Record<string, PlayerState>;
};

type PersistedSessionStateV2 = {
  version: 2;
  sessionCode: string;
  adminToken: string;
  modToken: string;
  createdAt: number;
  updatedAt: number;
  drawCount: number;
  drawnNumbers: number[];
  bag: number[];
  pendingDraw: PendingDrawState | null;
  players: Record<string, PlayerState>;
};

type WsAttachment = {
  role: Role;
  playerId?: string;
  screen?: DisplayScreen;
};

type Bindings = {
  SESSIONS: DurableObjectNamespace;
};

function nowMs(): number {
  return Date.now();
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

function shuffleInPlace<T>(array: T[], rng: () => number): void {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function buildInitialBag(rng: () => number = Math.random): number[] {
  const bag = Array.from({ length: 75 }, (_, idx) => idx + 1);
  shuffleInPlace(bag, rng);
  return bag;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampSpotlightUpdatedBy(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 1) return null;
  if (trimmed.length > 32) return trimmed.slice(0, 32);
  return trimmed;
}

function getCookieFromRequest(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function buildAuthCookieHeader(name: string, token: string, requestUrl: URL): string {
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (requestUrl.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function defaultSpotlightState(t: number): SpotlightState {
  return { version: 0, ids: [], updatedAt: t, updatedBy: "system" };
}

function sanitizeSpotlightIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === "string").slice(0, 6);
}

function migratePersistedState(raw: unknown): { session: PersistedSessionStateV2; spotlight: SpotlightState } | null {
  if (!isRecord(raw)) return null;
  const v = raw.version;
  const t = Date.now();

  if (v === 2) {
    return {
      session: raw as PersistedSessionStateV2,
      spotlight: defaultSpotlightState(t),
    };
  }

  if (v === 1) {
    const legacy = raw as PersistedSessionStateV1Legacy;
    const legacySpotlight = legacy.spotlight as SpotlightStateV1Legacy | undefined;
    const ids = sanitizeSpotlightIds(legacySpotlight?.ids);
    const spotlight: SpotlightState = {
      version: ids.length > 0 ? 1 : 0,
      ids,
      updatedAt: typeof legacySpotlight?.updatedAt === "number" ? legacySpotlight.updatedAt : t,
      updatedBy: typeof legacySpotlight?.updatedBy === "string" ? legacySpotlight.updatedBy : null,
    };

    const session: PersistedSessionStateV2 = {
      version: 2,
      sessionCode: legacy.sessionCode,
      adminToken: legacy.adminToken,
      modToken: legacy.modToken,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      drawCount: legacy.drawCount,
      drawnNumbers: legacy.drawnNumbers,
      bag: legacy.bag,
      pendingDraw: legacy.pendingDraw,
      players: legacy.players,
    };

    return { session, spotlight };
  }

  return null;
}

function getSessionCodeFromRequest(request: Request): string | null {
  const header = request.headers.get("x-session-code");
  if (header && header.trim() !== "") return header.trim();
  const url = new URL(request.url);
  const qp = url.searchParams.get("code");
  if (qp && qp.trim() !== "") return qp.trim();
  return null;
}

function getTokenFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const qp = url.searchParams.get("token");
  if (qp && qp.trim() !== "") return qp.trim();
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice("bearer ".length).trim();
  return null;
}

function getAdminTokenFromRequest(request: Request): string | null {
  return getTokenFromRequest(request) ?? getCookieFromRequest(request, ADMIN_TOKEN_COOKIE);
}

function getModTokenFromRequest(request: Request): string | null {
  return getTokenFromRequest(request) ?? getCookieFromRequest(request, MOD_TOKEN_COOKIE);
}

function getRoleFromUrl(url: URL): Role | null {
  const raw = url.searchParams.get("role");
  if (raw === "participant" || raw === "display" || raw === "admin" || raw === "mod") return raw;
  return null;
}

function getDisplayScreenFromUrl(url: URL): DisplayScreen | null {
  const raw = url.searchParams.get("screen");
  if (raw === "ten" || raw === "one") return raw;
  return null;
}

function clampDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 1) return null;
  if (trimmed.length > 24) return trimmed.slice(0, 24);
  return trimmed;
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
    if (progress.minMissingToLine === 1) reachPlayers += 1;
    if (progress.isBingo) bingoPlayers += 1;
  }
  return { reachPlayers, bingoPlayers };
}

export class SessionDurableObject {
  private session: PersistedSessionStateV2 | null = null;
  private spotlight: SpotlightState = defaultSpotlightState(nowMs());

  constructor(private readonly state: DurableObjectState, private readonly env: Bindings) {
    this.state.blockConcurrencyWhile(async () => {
      const persisted = await this.state.storage.get<unknown>("state");
      if (!persisted) return;
      const migrated = migratePersistedState(persisted);
      if (!migrated) return;
      this.session = migrated.session;
      this.spotlight = migrated.spotlight;
      if (isRecord(persisted) && persisted.version === 1) {
        await this.state.storage.put("state", migrated.session);
      }
    });
  }

  private assertInitialized(request: Request): PersistedSessionStateV2 | Response {
    if (this.session) return this.session;
    const code = getSessionCodeFromRequest(request);
    if (!code) return textResponse("missing session code", { status: 400 });
    return textResponse(`session ${code} not initialized`, { status: 404 });
  }

  private async save(): Promise<void> {
    if (!this.session) return;
    await this.state.storage.put("state", this.session);
  }

  private sendSnapshot(ws: WebSocket): void {
    let attachment: WsAttachment | null = null;
    try {
      attachment = (ws.deserializeAttachment?.() as WsAttachment | undefined) ?? null;
    } catch {
      attachment = null;
    }
    const payload = this.buildSnapshot(attachment);
    ws.send(JSON.stringify(payload));
  }

  private broadcastSnapshots(): void {
    for (const ws of this.state.getWebSockets()) {
      try {
        this.sendSnapshot(ws);
      } catch {
        try {
          ws.close(1011, "snapshot failed");
        } catch {
          // ignore
        }
      }
    }
  }

  private buildSnapshot(attachment: WsAttachment | null): unknown {
    if (!this.session) return { type: "snapshot", ok: false, error: "not initialized" };

    const lastNumber = this.session.drawnNumbers.length > 0 ? this.session.drawnNumbers[this.session.drawnNumbers.length - 1] : null;
    const pending = this.session.pendingDraw;

    const spotlightPlayers = this.spotlight.ids
      .map((id) => this.session!.players[id])
      .filter(Boolean)
      .map((p) => ({ id: p.id, displayName: p.displayName, progress: p.progress }));

    const base = {
      type: "snapshot",
      ok: true,
      sessionCode: this.session.sessionCode,
      updatedAt: this.session.updatedAt,
      drawCount: this.session.drawCount,
      lastNumber,
      lastNumbers: this.session.drawnNumbers.slice(-10),
      spotlight: {
        ...this.spotlight,
        players: spotlightPlayers,
      },
    };

    if (!attachment) return base;

    if (attachment.role === "participant") {
      const player = attachment.playerId ? this.session.players[attachment.playerId] : null;
      return {
        ...base,
        role: "participant",
        drawnNumbers: this.session.drawnNumbers,
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
      const status = pending ? pending.reel[screen] : "idle";
      const stoppedDigit =
        pending && pending.reel[screen] === "stopped"
          ? pending.stoppedDigits[screen] ?? digitsOf(pending.number)[screen]
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

    const players = Object.values(this.session.players).map((p) => ({
      id: p.id,
      displayName: p.displayName,
      joinedAt: p.joinedAt,
      progress: p.progress,
      card: p.card,
    }));

    if (attachment.role === "mod") {
      return {
        ...base,
        role: "mod",
        players,
      };
    }

    if (attachment.role === "admin") {
      return {
        ...base,
        role: "admin",
        players,
        pendingDraw: pending
          ? {
              preparedAt: pending.preparedAt,
              number: pending.number,
              impact: pending.impact,
              reel: pending.reel,
              stoppedDigits: pending.stoppedDigits,
            }
          : null,
        bagRemaining: this.session.bag.length,
      };
    }

    return base;
  }

  private async handleAdminInit(request: Request): Promise<Response> {
    const code = getSessionCodeFromRequest(request);
    if (!code) return textResponse("missing session code", { status: 400 });

    if (!this.session) {
      const createdAt = nowMs();
      this.session = {
        version: 2,
        sessionCode: code,
        adminToken: crypto.randomUUID(),
        modToken: crypto.randomUUID(),
        createdAt,
        updatedAt: createdAt,
        drawCount: 0,
        drawnNumbers: [],
        bag: buildInitialBag(),
        pendingDraw: null,
        players: {},
      };
      this.spotlight = defaultSpotlightState(createdAt);
      await this.save();
    }

    return jsonResponse({
      ok: true,
      sessionCode: this.session.sessionCode,
      adminToken: this.session.adminToken,
      modToken: this.session.modToken,
      urls: {
        join: `/s/${this.session.sessionCode}`,
        displayTen: `/s/${this.session.sessionCode}/display/ten`,
        displayOne: `/s/${this.session.sessionCode}/display/one`,
        admin: `/admin/${this.session.sessionCode}?token=${this.session.adminToken}`,
        mod: `/mod/${this.session.sessionCode}?token=${this.session.modToken}`,
      },
    });
  }

  private async handleAdminEnter(request: Request): Promise<Response> {
    const initialized = this.assertInitialized(request);
    if (initialized instanceof Response) return initialized;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const token = (body as { token?: unknown }).token;
    if (typeof token !== "string" || token.trim() === "") return textResponse("token required", { status: 400 });
    if (!this.session) return textResponse("session not initialized", { status: 404 });
    if (token.trim() !== this.session.adminToken) return textResponse("forbidden", { status: 403 });

    const url = new URL(request.url);
    return jsonResponse(
      { ok: true },
      {
        headers: {
          "set-cookie": buildAuthCookieHeader(ADMIN_TOKEN_COOKIE, this.session.adminToken, url),
        },
      },
    );
  }

  private async handleModEnter(request: Request): Promise<Response> {
    const initialized = this.assertInitialized(request);
    if (initialized instanceof Response) return initialized;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const token = (body as { token?: unknown }).token;
    if (typeof token !== "string" || token.trim() === "") return textResponse("token required", { status: 400 });
    if (!this.session) return textResponse("session not initialized", { status: 404 });
    if (token.trim() !== this.session.modToken) return textResponse("forbidden", { status: 403 });

    const url = new URL(request.url);
    return jsonResponse(
      { ok: true },
      {
        headers: {
          "set-cookie": buildAuthCookieHeader(MOD_TOKEN_COOKIE, this.session.modToken, url),
        },
      },
    );
  }

  private async handleParticipantJoin(request: Request): Promise<Response> {
    const initialized = this.assertInitialized(request);
    if (initialized instanceof Response) return initialized;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }
    const displayName = clampDisplayName((body as { displayName?: unknown }).displayName);
    if (!displayName) return textResponse("displayName required", { status: 400 });

    const playerId = crypto.randomUUID();
    const card = generate75BallCard();
    const progress = evaluateCard(card, this.session!.drawnNumbers);

    this.session!.players[playerId] = {
      id: playerId,
      displayName,
      joinedAt: nowMs(),
      card,
      progress,
    };

    this.session!.updatedAt = nowMs();
    await this.save();
    this.broadcastSnapshots();

    return jsonResponse({
      ok: true,
      playerId,
      card,
      progress,
    });
  }

  private assertAdmin(request: Request): Response | null {
    if (!this.session) return textResponse("session not initialized", { status: 404 });
    const token = getAdminTokenFromRequest(request);
    if (!token || token !== this.session.adminToken) return textResponse("forbidden", { status: 403 });
    return null;
  }

  private assertMod(request: Request): Response | null {
    if (!this.session) return textResponse("session not initialized", { status: 404 });
    const token = getModTokenFromRequest(request);
    if (!token || token !== this.session.modToken) return textResponse("forbidden", { status: 403 });
    return null;
  }

  private async ensurePendingDraw(): Promise<PendingDrawState | Response> {
    if (!this.session) return textResponse("session not initialized", { status: 404 });
    if (this.session.pendingDraw) return this.session.pendingDraw;
    const next = this.session.bag.shift();
    if (typeof next !== "number") return textResponse("no numbers remaining", { status: 409 });

    const preparedAt = nowMs();
    this.session.pendingDraw = {
      number: next,
      preparedAt,
      impact: computeImpact(this.session.players, this.session.drawnNumbers, next),
      reel: { ten: "idle", one: "idle" },
      stoppedDigits: { ten: null, one: null },
    };
    this.session.updatedAt = preparedAt;
    await this.save();
    this.broadcastSnapshots();

    return this.session.pendingDraw;
  }

  private async handleAdminPrepare(request: Request): Promise<Response> {
    const authError = this.assertAdmin(request);
    if (authError) return authError;

    const ensured = await this.ensurePendingDraw();
    if (ensured instanceof Response) return ensured;
    return jsonResponse({ ok: true, pendingDraw: ensured });
  }

  private async confirmPendingDraw(): Promise<void> {
    if (!this.session?.pendingDraw) return;

    const confirmedAt = nowMs();
    const number = this.session.pendingDraw.number;
    this.session.drawnNumbers.push(number);
    this.session.drawCount += 1;

    for (const player of Object.values(this.session.players)) {
      player.progress = evaluateCard(player.card, this.session.drawnNumbers);
    }

    this.session.pendingDraw = null;
    this.session.updatedAt = confirmedAt;
    await this.save();
    this.broadcastSnapshots();
  }

  private async handleAdminReel(request: Request): Promise<Response> {
    const authError = this.assertAdmin(request);
    if (authError) return authError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }

    const digit = (body as { digit?: unknown }).digit;
    const action = (body as { action?: unknown }).action;
    const isDigit = digit === "ten" || digit === "one";
    const isAction = action === "start" || action === "stop";
    if (!isDigit || !isAction) return textResponse("digit/action required", { status: 400 });

    if (!this.session?.pendingDraw) {
      if (action !== "start") return textResponse("no pending draw; press start first", { status: 409 });
      const ensured = await this.ensurePendingDraw();
      if (ensured instanceof Response) return ensured;
    }

    const pending = this.session!.pendingDraw!;
    if (action === "start") {
      pending.reel[digit] = "spinning";
      pending.stoppedDigits[digit] = null;
      this.session!.updatedAt = nowMs();
      await this.save();
      this.broadcastSnapshots();
      return jsonResponse({ ok: true, pendingDraw: pending });
    }

    // stop
    const targetDigit = digitsOf(pending.number)[digit];
    pending.reel[digit] = "stopped";
    pending.stoppedDigits[digit] = targetDigit;
    this.session!.updatedAt = nowMs();
    await this.save();
    this.broadcastSnapshots();

    if (pending.reel.ten === "stopped" && pending.reel.one === "stopped") {
      await this.confirmPendingDraw();
      return jsonResponse({ ok: true, confirmed: true });
    }

    return jsonResponse({ ok: true, pendingDraw: pending });
  }

  private async handleModSpotlight(request: Request): Promise<Response> {
    const authError = this.assertMod(request);
    if (authError) return authError;
    if (!this.session) return textResponse("session not initialized", { status: 404 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return textResponse("invalid json", { status: 400 });
    }
    const rawSpotlight = (body as { spotlight?: unknown }).spotlight;
    const ids = sanitizeSpotlightIds(rawSpotlight).filter((id) => Boolean(this.session!.players[id]));
    const updatedByRaw = (body as { updatedBy?: unknown }).updatedBy;
    const updatedBy = clampSpotlightUpdatedBy(updatedByRaw) ?? "mod";

    const updatedAt = nowMs();
    this.spotlight = {
      version: this.spotlight.version + 1,
      ids,
      updatedAt,
      updatedBy,
    };
    this.broadcastSnapshots();

    return jsonResponse({ ok: true, spotlight: this.spotlight });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const sessionCode = getSessionCodeFromRequest(request);
      if (!sessionCode) return textResponse("missing session code", { status: 400 });
      if (!this.session) return textResponse(`session ${sessionCode} not initialized`, { status: 404 });

      const role = getRoleFromUrl(url) ?? "participant";
      const token = role === "admin" ? getAdminTokenFromRequest(request) : role === "mod" ? getModTokenFromRequest(request) : null;

      if ((role === "admin" || role === "mod") && (!token || token.trim() === "")) {
        return textResponse("missing token", { status: 401 });
      }
      if (role === "admin" && token !== this.session.adminToken) return textResponse("forbidden", { status: 403 });
      if (role === "mod" && token !== this.session.modToken) return textResponse("forbidden", { status: 403 });

      const attachment: WsAttachment = {
        role,
      };

      if (role === "participant") {
        const playerId = url.searchParams.get("playerId");
        if (playerId) attachment.playerId = playerId;
      }
      if (role === "display") {
        attachment.screen = getDisplayScreenFromUrl(url) ?? "ten";
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);
      server.serializeAttachment?.(attachment);
      this.sendSnapshot(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/admin/init" && request.method === "POST") return this.handleAdminInit(request);
    if (url.pathname === "/admin/enter" && request.method === "POST") return this.handleAdminEnter(request);
    if (url.pathname === "/mod/enter" && request.method === "POST") return this.handleModEnter(request);
    if (url.pathname === "/participant/join" && request.method === "POST") return this.handleParticipantJoin(request);
    if (url.pathname === "/admin/prepare" && request.method === "POST") return this.handleAdminPrepare(request);
    if (url.pathname === "/admin/reel" && request.method === "POST") return this.handleAdminReel(request);
    if (url.pathname === "/mod/spotlight" && request.method === "POST") return this.handleModSpotlight(request);

    return textResponse("not found", { status: 404 });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    if (message === "ping") {
      ws.send("pong");
      return;
    }

    try {
      const parsed = JSON.parse(message) as { type?: unknown };
      if (parsed.type === "ping") ws.send(JSON.stringify({ type: "pong", t: nowMs() }));
    } catch {
      // ignore
    }
  }
}
