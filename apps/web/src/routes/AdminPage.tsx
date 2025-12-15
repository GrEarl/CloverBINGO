import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { useSessionSocket, type AdminSnapshot } from "../lib/useSessionSocket";

type Digit = "ten" | "one";
type Action = "start" | "stop";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `request failed (${res.status})`);
  return (await res.json()) as T;
}

export default function AdminPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const code = params.code ?? "";
  const inviteToken = search.get("token") ?? "";

  const { snapshot, connected } = useSessionSocket({ role: "admin", code });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as AdminSnapshot).role !== "admin") return null;
    return snapshot as AdminSnapshot;
  }, [snapshot]);

  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [enterToken, setEnterToken] = useState(inviteToken);

  async function prepare() {
    setError(null);
    setLastAction("prepare");
    await postJson(`/api/admin/prepare?code=${encodeURIComponent(code)}`, {});
  }

  async function reel(digit: Digit, action: Action) {
    setError(null);
    setLastAction(`reel:${digit}:${action}`);
    await postJson(`/api/admin/reel?code=${encodeURIComponent(code)}`, { digit, action });
  }

  async function enter(token: string) {
    setEnterError(null);
    setEntering(true);
    try {
      await postJson(`/api/admin/enter?code=${encodeURIComponent(code)}`, { token });
      window.location.replace(`/admin/${code}`);
    } catch (err) {
      setEnterError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setEntering(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!view) return;
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === "p") void prepare().catch((err) => setError(err instanceof Error ? err.message : "unknown error"));
      if (key === "w") void reel("ten", "start").catch((err) => setError(err instanceof Error ? err.message : "unknown error"));
      if (key === "a") void reel("ten", "stop").catch((err) => setError(err instanceof Error ? err.message : "unknown error"));
      if (key === "s") void reel("one", "start").catch((err) => setError(err instanceof Error ? err.message : "unknown error"));
      if (key === "d") void reel("one", "stop").catch((err) => setError(err instanceof Error ? err.message : "unknown error"));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [code, view]);

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
            <div className="mt-1 text-sm text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span> / WS:{" "}
              <span className={connected ? "text-emerald-300" : "text-amber-300"}>{connected ? "connected" : "reconnecting..."}</span>
            </div>
            <div className="mt-1 text-xs text-neutral-500">キー: P=prepare, W/A=十の位 start/stop, S/D=一の位 start/stop</div>
          </div>
          <div className="text-xs text-neutral-500">
            last: <span className="font-mono text-neutral-200">{view?.lastNumber ?? "—"}</span> / bag:{" "}
            <span className="font-mono text-neutral-200">{view?.bagRemaining ?? "—"}</span>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          {!view && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <h2 className="text-base font-semibold">入室（認証）</h2>
              <p className="mt-2 text-sm text-neutral-300">
                招待リンクの token を使って入室してください（cookieに保存します）。入室後は URL から token を外しても動きます。
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <input
                  className="w-full max-w-md rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm outline-none focus:border-emerald-600"
                  placeholder="token を貼り付け"
                  value={enterToken}
                  onChange={(e) => setEnterToken(e.target.value)}
                />
                <button
                  className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
                  disabled={entering || enterToken.trim().length === 0}
                  onClick={() => void enter(enterToken)}
                  type="button"
                >
                  {entering ? "入室中..." : "入室"}
                </button>
              </div>
              {enterError && <div className="mt-3 text-sm text-red-200">入室に失敗: {enterError}</div>}
            </div>
          )}

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">抽選操作</h2>
              <div className="text-xs text-neutral-400">lastAction: {lastAction ?? "—"}</div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
                onClick={() => void prepare().catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!view}
                type="button"
              >
                P / Prepare
              </button>
              <button
                className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm hover:bg-neutral-950/70"
                onClick={() => void reel("ten", "start").catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!view}
                type="button"
              >
                W / 十 start
              </button>
              <button
                className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm hover:bg-neutral-950/70"
                onClick={() => void reel("ten", "stop").catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!view}
                type="button"
              >
                A / 十 stop
              </button>
              <button
                className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm hover:bg-neutral-950/70"
                onClick={() => void reel("one", "start").catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!view}
                type="button"
              >
                S / 一 start
              </button>
              <button
                className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm hover:bg-neutral-950/70"
                onClick={() => void reel("one", "stop").catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!view}
                type="button"
              >
                D / 一 stop
              </button>
            </div>

            {error && <div className="mt-3 text-sm text-red-200">error: {error}</div>}

            <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-xs text-neutral-400">pendingDraw</div>
              {view?.pendingDraw ? (
                <div className="mt-2 grid gap-1 text-sm">
                  <div>
                    次番号（Adminのみ）: <span className="font-mono text-lg">{view.pendingDraw.number}</span>
                  </div>
                  <div className="text-xs text-neutral-400">
                    impact: reachPlayers={view.pendingDraw.impact.reachPlayers}, bingoPlayers={view.pendingDraw.impact.bingoPlayers}
                  </div>
                  <div className="text-xs text-neutral-400">
                    reel: ten={view.pendingDraw.reel.ten}, one={view.pendingDraw.reel.one}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-neutral-400">（未prepare）</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
