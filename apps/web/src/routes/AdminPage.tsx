import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import Alert from "../components/ui/Alert";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Kbd from "../components/ui/Kbd";
import WsStatusPill from "../components/ui/WsStatusPill";
import { useSessionSocket, type AdminSnapshot, type ReelStatus, type ServerEvent } from "../lib/useSessionSocket";

type Digit = "ten" | "one";
type Action = "start" | "stop";

type InviteEnterResponse =
  | { ok: false; error?: string }
  | { ok: true; role: "admin" | "mod"; sessionCode: string; redirectTo: string };

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

  const { snapshot, status, lastEvent } = useSessionSocket({ role: "admin", code });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as AdminSnapshot).role !== "admin") return null;
    return snapshot as AdminSnapshot;
  }, [snapshot]);
  const viewRef = useRef<AdminSnapshot | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [enterToken, setEnterToken] = useState(inviteToken);

  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioRef = useRef<{
    spin: HTMLAudioElement;
    stop: HTMLAudioElement;
    commit: HTMLAudioElement;
    bingo: HTMLAudioElement;
  } | null>(null);
  const prevReelRef = useRef<{ ten: ReelStatus; one: ReelStatus } | null>(null);
  const nextHint = useMemo(() => {
    if (!view) return "認証が必要（招待URLで入室）";
    if (view.sessionStatus !== "active") return "セッション終了";
    if (!view.pendingDraw) return "P (prepare) または W (十 start)";
    const ten = view.pendingDraw.reel.ten;
    const one = view.pendingDraw.reel.one;
    if (ten === "idle" && one === "idle") return "W (十 start) → S (一 start) → A/D (stop)";
    if (ten === "spinning" && one === "spinning") return "A / D (stop)";
    if (ten === "idle") return "W (十 start)";
    if (ten === "spinning") return "A (十 stop)";
    if (one === "idle") return "S (一 start)";
    if (one === "spinning") return "D (一 stop)";
    return "P (prepare)";
  }, [view]);

  const tenReel = view?.pendingDraw?.reel.ten ?? "idle";
  const oneReel = view?.pendingDraw?.reel.one ?? "idle";
  const canOperate = Boolean(view && view.sessionStatus === "active");
  const canPrepare = Boolean(canOperate && view?.drawState !== "spinning");
  const canTenStart = Boolean(canOperate && tenReel === "idle");
  const canTenStop = Boolean(canOperate && tenReel === "spinning");
  const canOneStart = Boolean(canOperate && oneReel === "idle");
  const canOneStop = Boolean(canOperate && oneReel === "spinning");

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
      const res = await postJson<InviteEnterResponse>("/api/invite/enter", { token });
      if (!res.ok) throw new Error(res.error ?? "enter failed");
      window.location.replace(res.redirectTo);
    } catch (err) {
      setEnterError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setEntering(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const current = viewRef.current;
      if (!current) return;
      if (current.sessionStatus !== "active") return;
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
  }, [code]);

  function safePlay(audio: HTMLAudioElement) {
    try {
      audio.currentTime = 0;
      void audio.play();
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!audioEnabled) return;
    const aud = audioRef.current;
    if (!aud) return;
    const ev = lastEvent as ServerEvent | null;
    if (!ev || ev.type !== "draw.committed") return;
    if (Array.isArray(ev.newBingoIds) && ev.newBingoIds.length > 0) safePlay(aud.bingo);
    else safePlay(aud.commit);
  }, [audioEnabled, lastEvent]);

  useEffect(() => {
    const aud = audioRef.current;
    const current = view?.pendingDraw?.reel ?? null;
    const prev = prevReelRef.current;

    if (audioEnabled && aud) {
      if (prev && current) {
        if (prev.ten === "spinning" && current.ten === "stopped") safePlay(aud.stop);
        if (prev.one === "spinning" && current.one === "stopped") safePlay(aud.stop);
      }
      const spinning = Boolean(current && (current.ten === "spinning" || current.one === "spinning"));
      if (spinning) {
        try {
          if (aud.spin.paused) void aud.spin.play();
        } catch {
          // ignore
        }
      } else {
        try {
          aud.spin.pause();
          aud.spin.currentTime = 0;
        } catch {
          // ignore
        }
      }
    } else if (aud) {
      try {
        aud.spin.pause();
        aud.spin.currentTime = 0;
      } catch {
        // ignore
      }
    }

    prevReelRef.current = current ? { ten: current.ten, one: current.one } : null;
    return () => {
      if (!aud) return;
      try {
        aud.spin.pause();
      } catch {
        // ignore
      }
    };
  }, [audioEnabled, view?.pendingDraw?.reel.ten, view?.pendingDraw?.reel.one]);

  async function enableAudio() {
    setError(null);
    try {
      const spin = new Audio("/sfx/spin.ogg");
      spin.loop = true;
      spin.volume = 0.7;
      const stop = new Audio("/sfx/stop.ogg");
      stop.volume = 0.9;
      const commit = new Audio("/sfx/commit.ogg");
      commit.volume = 0.8;
      const bingo = new Audio("/sfx/bingo.ogg");
      bingo.volume = 0.85;

      audioRef.current = { spin, stop, commit, bingo };
      setAudioEnabled(true);

      // Unlock audio on user gesture
      await stop.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to enable audio");
      setAudioEnabled(false);
      audioRef.current = null;
    }
  }

  async function endSession() {
    setError(null);
    try {
      if (!window.confirm("セッションを終了します。以後、全操作は無効になります。よろしいですか？")) return;
      setLastAction("end");
      await postJson(`/api/admin/end?code=${encodeURIComponent(code)}`, {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
            <div className="mt-1 text-sm text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <div className="flex flex-wrap items-center gap-1">
                <Kbd>P</Kbd> <span>prepare</span>
              </div>
              <span className="text-neutral-700">/</span>
              <div className="flex flex-wrap items-center gap-1">
                <Kbd>W</Kbd> <span>十 start</span> <Kbd>A</Kbd> <span>十 stop</span>
              </div>
              <span className="text-neutral-700">/</span>
              <div className="flex flex-wrap items-center gap-1">
                <Kbd>S</Kbd> <span>一 start</span> <Kbd>D</Kbd> <span>一 stop</span>
              </div>
            </div>
            <div className="mt-2">
              <Badge variant="warning">next: {nextHint}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <WsStatusPill status={status} />
            <Badge>last: {view?.lastNumber ?? "—"}</Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          {!view && (
            <Card>
              <h2 className="text-base font-semibold">入室（認証）</h2>
              <p className="mt-2 text-sm text-neutral-300">
                招待リンクの token を使って入室してください（cookieに保存します）。入室後は URL から token を外しても動きます。
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Input placeholder="token を貼り付け" value={enterToken} onChange={(e) => setEnterToken(e.target.value)} />
                <Button disabled={entering || enterToken.trim().length === 0} onClick={() => void enter(enterToken)} variant="primary">
                  {entering ? "入室中..." : "入室"}
                </Button>
              </div>
              {enterError && (
                <div className="mt-3">
                  <Alert variant="danger">入室に失敗: {enterError}</Alert>
                </div>
              )}
            </Card>
          )}

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">抽選操作</h2>
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <span>lastAction:</span>
                <span className="font-mono text-neutral-200">{lastAction ?? "—"}</span>
              </div>
            </div>

            {!audioEnabled && (
              <div className="mt-4">
                <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-3">
                  <div>音を出すには「音を有効化」を一度押してください（ブラウザの自動再生制限のため）。</div>
                  <Button onClick={() => void enableAudio()} size="sm" variant="primary">
                    音を有効化
                  </Button>
                </Alert>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={() => void prepare().catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!canPrepare}
                variant="primary"
              >
                P / Prepare
              </Button>
              <Button
                onClick={() => void reel("ten", "start").catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!canTenStart}
                variant="secondary"
              >
                W / 十 start
              </Button>
              <Button
                onClick={() => void reel("ten", "stop").catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!canTenStop}
                variant="secondary"
              >
                A / 十 stop
              </Button>
              <Button
                onClick={() => void reel("one", "start").catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!canOneStart}
                variant="secondary"
              >
                S / 一 start
              </Button>
              <Button
                onClick={() => void reel("one", "stop").catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!canOneStop}
                variant="secondary"
              >
                D / 一 stop
              </Button>
              <Button
                onClick={() => void endSession()}
                disabled={!canOperate}
                variant="destructive"
              >
                セッション終了
              </Button>
            </div>

            {error && (
              <div className="mt-3">
                <Alert variant="danger">error: {error}</Alert>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
              <div>
                status: <span className="text-neutral-200">{view?.sessionStatus ?? "—"}</span>
                {view?.endedAt ? <span> / endedAt: {view.endedAt}</span> : null}
              </div>
              <div>
                drawState: <span className="text-neutral-200">{view?.drawState ?? "—"}</span>
              </div>
              <div>
                stats: reach <span className="text-neutral-200">{view?.stats?.reachPlayers ?? "—"}</span> / bingo{" "}
                <span className="text-neutral-200">{view?.stats?.bingoPlayers ?? "—"}</span>
              </div>
              <div>
                audio: <span className={audioEnabled ? "text-emerald-200" : "text-amber-200"}>{audioEnabled ? "enabled" : "disabled"}</span>
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-xs text-neutral-400">pendingDraw</div>
              {view?.pendingDraw ? (
                <div className="mt-2 grid gap-1 text-sm">
                  <div>
                    次番号（Adminのみ）: <span className="font-mono text-2xl text-neutral-50">{view.pendingDraw.number}</span>
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
          </Card>
        </div>
      </div>
    </main>
  );
}
