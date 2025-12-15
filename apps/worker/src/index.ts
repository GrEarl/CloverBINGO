import { Hono } from "hono";

import { SessionDurableObject } from "./session";

type Bindings = {
  SESSIONS: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

function getSessionStub(env: Bindings, code: string): DurableObjectStub {
  const id = env.SESSIONS.idFromName(code);
  return env.SESSIONS.get(id);
}

async function forwardToSession(
  c: { env: Bindings; req: { raw: Request } },
  code: string,
  pathname: string,
): Promise<Response> {
  const stub = getSessionStub(c.env, code);
  const original = c.req.raw;
  const url = new URL(original.url);
  url.pathname = pathname;

  const headers = new Headers(original.headers);
  headers.set("x-session-code", code);

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
  return forwardToSession(c, code, "/ws");
});

app.post("/api/participant/join", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  return forwardToSession(c, code, "/participant/join");
});

app.post("/api/admin/enter", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  return forwardToSession(c, code, "/admin/enter");
});

app.post("/api/admin/prepare", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  return forwardToSession(c, code, "/admin/prepare");
});

app.post("/api/admin/reel", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  return forwardToSession(c, code, "/admin/reel");
});

app.post("/api/mod/enter", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  return forwardToSession(c, code, "/mod/enter");
});

app.post("/api/mod/spotlight", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("missing code", 400);
  return forwardToSession(c, code, "/mod/spotlight");
});

app.post("/api/dev/create-session", async (c) => {
  const code = crypto.randomUUID().slice(0, 6).toUpperCase();
  return forwardToSession(c, code, "/admin/init");
});

export default {
  fetch: app.fetch,
};

export { SessionDurableObject };
