import { Hono } from "hono";
import { eq } from "drizzle-orm";

import type { Bindings } from "./bindings";
import { getDb } from "./db/client";
import { invites, sessions } from "./db/schema";
import { SessionDurableObject } from "./session";

const app = new Hono<{ Bindings: Bindings }>();

const ADMIN_INVITE_COOKIE = "cloverbingo_admin";
const MOD_INVITE_COOKIE = "cloverbingo_mod";
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

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

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function getSessionStub(env: Bindings, sessionId: string): DurableObjectStub {
  const id = env.SESSIONS.idFromName(sessionId);
  return env.SESSIONS.get(id);
}

async function resolveSessionByCode(env: Bindings, code: string): Promise<{ sessionId: string; sessionCode: string; status: string } | null> {
  const db = getDb(env);
  const rows = await db.select().from(sessions).where(eq(sessions.code, code)).limit(1);
  if (!rows.length) return null;
  return { sessionId: rows[0].id, sessionCode: rows[0].code, status: rows[0].status };
}

async function forwardToSession(
  c: { env: Bindings; req: { raw: Request } },
  session: { sessionId: string; sessionCode: string },
  pathname: string,
): Promise<Response> {
  const stub = getSessionStub(c.env, session.sessionId);
  const original = c.req.raw;
  const url = new URL(original.url);
  url.pathname = pathname;

  const headers = new Headers(original.headers);
  headers.set("x-session-id", session.sessionId);
  headers.set("x-session-code", session.sessionCode);

  const method = original.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await original.arrayBuffer();

  const forwarded = new Request(url.toString(), {
    method,
    headers,
    body,
  });
  return stub.fetch(forwarded);
}

app.get("/api/healthz", (c) => c.json({ ok: true }));

app.get("/api/ws", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  const session = await resolveSessionByCode(c.env, code);
  if (!session) return c.text("session not found", 404);
  return forwardToSession(c, session, "/ws");
});

app.post("/api/participant/join", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  const session = await resolveSessionByCode(c.env, code);
  if (!session) return c.text("session not found", 404);
  if (session.status !== "active") return c.text("session ended", 410);
  return forwardToSession(c, session, "/participant/join");
});

app.post("/api/invite/enter", async (c) => {
  let body: unknown;
  try {
    body = await c.req.raw.json();
  } catch {
    return c.text("invalid json", 400);
  }
  const token = (body as { token?: unknown }).token;
  if (typeof token !== "string" || token.trim() === "") return c.text("token required", 400);

  const db = getDb(c.env);
  const inviteRows = await db.select().from(invites).where(eq(invites.token, token.trim())).limit(1);
  if (!inviteRows.length) return c.text("invalid token", 403);

  const invite = inviteRows[0];
  const sessionRows = await db.select().from(sessions).where(eq(sessions.id, invite.sessionId)).limit(1);
  if (!sessionRows.length) return c.text("session not found", 404);
  const session = sessionRows[0];
  if (session.status !== "active") return c.text("session ended", 410);

  const url = new URL(c.req.raw.url);
  const cookieName = invite.role === "admin" ? ADMIN_INVITE_COOKIE : invite.role === "mod" ? MOD_INVITE_COOKIE : null;
  const redirectTo = invite.role === "admin" ? `/s/${session.code}/admin` : invite.role === "mod" ? `/s/${session.code}/mod` : null;
  if (!cookieName || !redirectTo) return c.text("invalid role", 500);

  return jsonResponse(
    { ok: true, role: invite.role, sessionCode: session.code, redirectTo },
    {
      headers: {
        "set-cookie": buildAuthCookieHeader(cookieName, token.trim(), url),
      },
    },
  );
});

app.get("/api/invite/info", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.text("missing token", 400);
  const db = getDb(c.env);
  const inviteRows = await db.select().from(invites).where(eq(invites.token, token.trim())).limit(1);
  if (!inviteRows.length) return c.json({ ok: false, error: "invalid token" }, 404);
  const invite = inviteRows[0];
  const sessionRows = await db.select().from(sessions).where(eq(sessions.id, invite.sessionId)).limit(1);
  if (!sessionRows.length) return c.json({ ok: false, error: "session not found" }, 404);
  const session = sessionRows[0];
  return c.json({
    ok: true,
    role: invite.role,
    label: invite.label ?? null,
    sessionCode: session.code,
    sessionStatus: session.status,
    endedAt: session.endedAt ?? null,
  });
});

app.post("/api/admin/enter", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  let body: unknown;
  try {
    body = await c.req.raw.json();
  } catch {
    return c.text("invalid json", 400);
  }
  const token = (body as { token?: unknown }).token;
  if (typeof token !== "string" || token.trim() === "") return c.text("token required", 400);

  const session = await resolveSessionByCode(c.env, code);
  if (!session) return c.text("session not found", 404);
  if (session.status !== "active") return c.text("session ended", 410);

  const db = getDb(c.env);
  const inviteRows = await db.select().from(invites).where(eq(invites.token, token.trim())).limit(1);
  if (!inviteRows.length) return c.text("invalid token", 403);
  const invite = inviteRows[0];
  if (invite.role !== "admin") return c.text("invalid role", 403);
  if (invite.sessionId !== session.sessionId) return c.text("invalid token", 403);

  const url = new URL(c.req.raw.url);
  return jsonResponse(
    { ok: true },
    {
      headers: {
        "set-cookie": buildAuthCookieHeader(ADMIN_INVITE_COOKIE, token.trim(), url),
      },
    },
  );
});

app.post("/api/admin/prepare", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  const session = await resolveSessionByCode(c.env, code);
  if (!session) return c.text("session not found", 404);
  return forwardToSession(c, session, "/admin/prepare");
});

app.post("/api/admin/reel", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  const session = await resolveSessionByCode(c.env, code);
  if (!session) return c.text("session not found", 404);
  return forwardToSession(c, session, "/admin/reel");
});

app.post("/api/admin/end", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  const session = await resolveSessionByCode(c.env, code);
  if (!session) return c.text("session not found", 404);
  return forwardToSession(c, session, "/admin/end");
});

app.post("/api/mod/enter", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  let body: unknown;
  try {
    body = await c.req.raw.json();
  } catch {
    return c.text("invalid json", 400);
  }
  const token = (body as { token?: unknown }).token;
  if (typeof token !== "string" || token.trim() === "") return c.text("token required", 400);

  const session = await resolveSessionByCode(c.env, code);
  if (!session) return c.text("session not found", 404);
  if (session.status !== "active") return c.text("session ended", 410);

  const db = getDb(c.env);
  const inviteRows = await db.select().from(invites).where(eq(invites.token, token.trim())).limit(1);
  if (!inviteRows.length) return c.text("invalid token", 403);
  const invite = inviteRows[0];
  if (invite.role !== "mod") return c.text("invalid role", 403);
  if (invite.sessionId !== session.sessionId) return c.text("invalid token", 403);

  const url = new URL(c.req.raw.url);
  return jsonResponse(
    { ok: true },
    {
      headers: {
        "set-cookie": buildAuthCookieHeader(MOD_INVITE_COOKIE, token.trim(), url),
      },
    },
  );
});

app.post("/api/mod/spotlight", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  const session = await resolveSessionByCode(c.env, code);
  if (!session) return c.text("session not found", 404);
  return forwardToSession(c, session, "/mod/spotlight");
});

app.post("/api/dev/create-session", async (c) => {
  const db = getDb(c.env);
  const createdAt = new Date().toISOString();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const sessionId = crypto.randomUUID();
    const code = crypto.randomUUID().slice(0, 6).toUpperCase();
    const adminToken = crypto.randomUUID();
    const modToken = crypto.randomUUID();
    try {
      await db.insert(sessions).values({ id: sessionId, code, status: "active", createdAt, endedAt: null });
      await db.insert(invites).values([
        { token: adminToken, sessionId, role: "admin", createdAt, label: "admin" },
        { token: modToken, sessionId, role: "mod", createdAt, label: "mod" },
      ]);
    } catch {
      // likely code collision; retry
      continue;
    }

    return c.json({
      ok: true,
      sessionCode: code,
      adminToken,
      modToken,
      urls: {
        join: `/s/${code}`,
        displayTen: `/s/${code}/display/ten`,
        displayOne: `/s/${code}/display/one`,
        admin: `/s/${code}/admin?token=${adminToken}`,
        mod: `/s/${code}/mod?token=${modToken}`,
        adminInvite: `/i/${adminToken}`,
        modInvite: `/i/${modToken}`,
        compatAdmin: `/admin/${code}?token=${adminToken}`,
        compatMod: `/mod/${code}?token=${modToken}`,
      },
    });
  }

  return c.json({ ok: false, error: "failed to create session" }, 500);
});

export default {
  fetch: app.fetch,
};

export { SessionDurableObject };
