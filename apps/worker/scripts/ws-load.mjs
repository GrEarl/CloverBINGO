import { setTimeout as delay } from "node:timers/promises";

function parseArgs(argv) {
  const args = { count: 200, origin: "http://127.0.0.1:8787", timeoutMs: 15000, code: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--code") args.code = argv[++i] ?? null;
    else if (a === "--count") args.count = Number(argv[++i] ?? args.count);
    else if (a === "--origin") args.origin = argv[++i] ?? args.origin;
    else if (a === "--timeout") args.timeoutMs = Number(argv[++i] ?? args.timeoutMs);
  }
  return args;
}

function toWsOrigin(httpOrigin) {
  if (httpOrigin.startsWith("https://")) return "wss://" + httpOrigin.slice("https://".length);
  if (httpOrigin.startsWith("http://")) return "ws://" + httpOrigin.slice("http://".length);
  if (httpOrigin.startsWith("wss://") || httpOrigin.startsWith("ws://")) return httpOrigin;
  return "ws://" + httpOrigin;
}

function isSnapshotMessage(text) {
  try {
    const json = JSON.parse(text);
    return json && typeof json === "object" && json.type === "snapshot" && json.ok === true;
  } catch {
    return false;
  }
}

function snapshotUpdatedAt(text) {
  try {
    const json = JSON.parse(text);
    if (!json || typeof json !== "object") return null;
    if (json.type !== "snapshot" || json.ok !== true) return null;
    return typeof json.updatedAt === "number" ? json.updatedAt : null;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.code) {
    process.stderr.write("Usage: node scripts/ws-load.mjs --code <SESSION_CODE> [--count 200] [--origin http://127.0.0.1:8787] [--timeout 15000]\n");
    process.exit(1);
  }
  if (!Number.isFinite(args.count) || args.count <= 0) throw new Error("--count must be > 0");

  const wsOrigin = toWsOrigin(args.origin);
  const wsUrl = new URL("/api/ws", wsOrigin);
  wsUrl.searchParams.set("code", args.code);
  wsUrl.searchParams.set("role", "participant");

  process.stdout.write(`target: ${wsUrl.toString()}\n`);
  process.stdout.write(`count: ${args.count}\n`);

  const sockets = [];
  const state = Array.from({ length: args.count }, () => ({
    open: false,
    firstSnapshotAt: null,
    firstUpdatedAt: null,
    gotAfterBroadcast: false,
  }));

  let openCount = 0;
  let firstSnapshotCount = 0;

  const deadline = Date.now() + args.timeoutMs;

  function timeLeft() {
    return Math.max(0, deadline - Date.now());
  }

  for (let i = 0; i < args.count; i += 1) {
    const ws = new WebSocket(wsUrl.toString());
    sockets.push(ws);

    ws.onopen = () => {
      if (state[i].open) return;
      state[i].open = true;
      openCount += 1;
    };
    ws.onmessage = (ev) => {
      const text = typeof ev.data === "string" ? ev.data : null;
      if (!text) return;

      if (!state[i].firstSnapshotAt && isSnapshotMessage(text)) {
        state[i].firstSnapshotAt = Date.now();
        state[i].firstUpdatedAt = snapshotUpdatedAt(text);
        firstSnapshotCount += 1;
        return;
      }

      if (state[i].firstUpdatedAt && !state[i].gotAfterBroadcast) {
        const updatedAt = snapshotUpdatedAt(text);
        if (updatedAt && updatedAt > state[i].firstUpdatedAt) state[i].gotAfterBroadcast = true;
      }
    };
  }

  while (openCount < args.count) {
    if (timeLeft() === 0) break;
    await delay(50);
  }
  process.stdout.write(`open: ${openCount}/${args.count}\n`);

  while (firstSnapshotCount < args.count) {
    if (timeLeft() === 0) break;
    await delay(50);
  }
  process.stdout.write(`firstSnapshot: ${firstSnapshotCount}/${args.count}\n`);

  process.stdout.write("trigger: participant/join (broadcast snapshot)\n");
  const joinName = `load_${Date.now().toString(36)}`;
  const joinRes = await fetch(`${args.origin}/api/participant/join?code=${encodeURIComponent(args.code)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: joinName }),
  });
  if (!joinRes.ok) {
    const text = await joinRes.text();
    throw new Error(`join failed: ${joinRes.status} ${text}`);
  }

  while (state.some((s) => s.firstUpdatedAt && !s.gotAfterBroadcast)) {
    if (timeLeft() === 0) break;
    await delay(50);
  }

  const gotAfter = state.filter((s) => s.gotAfterBroadcast).length;
  process.stdout.write(`afterBroadcastSnapshot: ${gotAfter}/${args.count}\n`);

  for (const ws of sockets) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  await delay(150);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + "\n");
  process.exit(1);
});

