import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import WsStatusPill from "../components/ui/WsStatusPill";
import { cn } from "../lib/cn";
import { useSessionSocket, type DisplayScreen, type DisplaySnapshot } from "../lib/useSessionSocket";

type ReachIntensity = 0 | 1 | 2 | 3;
type ReelDigit = "ten" | "one";

type DrawSpinEvent = {
  type: "draw.spin";
  action: "start" | "stop";
  digit: ReelDigit;
  at: number;
  digitValue?: number;
};

type DrawCommittedEvent = {
  type: "draw.committed";
  seq: number;
  number: number;
  committedAt: string;
  stats: { bingoPlayers: number };
};

function safeScreen(input: string | undefined): DisplayScreen | null {
  if (input === "ten" || input === "one") return input;
  return null;
}

function fmtNum(n: number | null | undefined): string {
  if (typeof n !== "number") return "—";
  return String(n);
}

function relativeFromNow(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 10) return "いま";
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  return `${hr}時間前`;
}

function reachIntensityFromCount(reachCount: number | null | undefined): ReachIntensity {
  if (typeof reachCount !== "number" || !Number.isFinite(reachCount)) return 0;
  if (reachCount <= 1) return 0;
  if (reachCount <= 4) return 1;
  if (reachCount <= 8) return 2;
  return 3;
}

function isDrawSpinEvent(ev: unknown): ev is DrawSpinEvent {
  if (!ev || typeof ev !== "object") return false;
  const maybe = ev as { type?: unknown; action?: unknown; digit?: unknown; at?: unknown; digitValue?: unknown };
  if (maybe.type !== "draw.spin") return false;
  if (maybe.action !== "start" && maybe.action !== "stop") return false;
  if (maybe.digit !== "ten" && maybe.digit !== "one") return false;
  if (typeof maybe.at !== "number") return false;
  if (typeof maybe.digitValue !== "undefined" && typeof maybe.digitValue !== "number") return false;
  return true;
}

function isDrawCommittedEvent(ev: unknown): ev is DrawCommittedEvent {
  if (!ev || typeof ev !== "object") return false;
  const maybe = ev as { type?: unknown; seq?: unknown; number?: unknown; committedAt?: unknown; stats?: unknown };
  if (maybe.type !== "draw.committed") return false;
  if (typeof maybe.seq !== "number") return false;
  if (typeof maybe.number !== "number") return false;
  if (typeof maybe.committedAt !== "string") return false;
  if (!maybe.stats || typeof maybe.stats !== "object") return false;
  const stats = maybe.stats as { bingoPlayers?: unknown };
  if (typeof stats.bingoPlayers !== "number") return false;
  return true;
}

export default function DisplayPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const code = params.code ?? "";
  const screen = safeScreen(params.screen);

  const fxEnabled = searchParams.get("fx") !== "0";
  const safeRequested = searchParams.get("safe") === "1";
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const { snapshot, status, lastEvent } = useSessionSocket({ role: "display", code, screen: screen ?? "ten" });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as DisplaySnapshot).role !== "display") return null;
    return snapshot as DisplaySnapshot;
  }, [snapshot]);

  const connected = status === "connected";
  const safeMode = safeRequested || prefersReducedMotion || !connected;
  const fxActive = fxEnabled && connected;

  const [shownDigit, setShownDigit] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const hideOverlayTimerRef = useRef<number | null>(null);
  const prevReelStatusRef = useRef<string | null>(null);
  const [popDigit, setPopDigit] = useState(false);
  const popTimerRef = useRef<number | null>(null);

  const [goPulse, setGoPulse] = useState(false);
  const goPulseTimerRef = useRef<number | null>(null);
  const goPulseIdRef = useRef<number | null>(null);

  const [confirmedPulse, setConfirmedPulse] = useState(false);
  const confirmedPulseTimerRef = useRef<number | null>(null);
  const [readableBoost, setReadableBoost] = useState(false);
  const readableBoostTimerRef = useRef<number | null>(null);

  const [bingoFx, setBingoFx] = useState<{ key: number; count: number } | null>(null);
  const bingoFxTimerRef = useRef<number | null>(null);
  const prevBingoPlayersRef = useRef<number | null>(null);
  const lastCommittedSeqRef = useRef<number | null>(null);

  const [reelSignal, setReelSignal] = useState<Record<ReelDigit, "idle" | "spinning" | "stopped">>({ ten: "idle", one: "idle" });
  const currentSpinIdRef = useRef<number | null>(null);

  const screenDigit: ReelDigit = screen === "one" ? "one" : "ten";
  const otherDigit: ReelDigit = screenDigit === "ten" ? "one" : "ten";
  const reachCount = view?.stats?.reachPlayers ?? null;
  const reachIntensity = reachIntensityFromCount(reachCount);
  const visualReachIntensity: ReachIntensity = safeMode ? (Math.min(1, reachIntensity) as ReachIntensity) : reachIntensity;
  const isSpinning = view?.reel.status === "spinning";
  const isLastSpinning = Boolean(isSpinning && reelSignal[otherDigit] === "stopped");
  const slowSpinMs = (safeMode ? 115 : 85) + (fxActive ? visualReachIntensity * 10 : 0);
  const spinIntervalMs = !fxEnabled ? 90 : isLastSpinning ? slowSpinMs : safeMode ? 80 : 45;
  const bingoParticles = useMemo(() => {
    if (!bingoFx || safeMode || !fxActive) return [];
    const list: Array<{ key: string; style: CSSProperties }> = [];
    for (let i = 0; i < 18; i += 1) {
      const side = i % 2 === 0 ? "left" : "right";
      const xBase = side === "left" ? 10 : 78;
      const xJitter = Math.random() * 14;
      const x = xBase + xJitter;
      const size = 8 + Math.floor(Math.random() * 10);
      const delay = Math.floor(Math.random() * 240);
      const dur = 1200 + Math.floor(Math.random() * 900);
      const dx = (side === "left" ? 1 : -1) * (20 + Math.floor(Math.random() * 40));
      const rot = (side === "left" ? 1 : -1) * (240 + Math.floor(Math.random() * 220));
      list.push({
        key: `${bingoFx.key}:${i}`,
        style: {
          "--x": `${x}%`,
          "--size": `${size}px`,
          "--delay": `${delay}ms`,
          "--dur": `${dur}ms`,
          "--dx": `${dx}px`,
          "--rot": `${rot}deg`,
        } as CSSProperties,
      });
    }
    return list;
  }, [bingoFx, fxActive, safeMode]);

  useEffect(() => {
    const mql = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : null;
    if (!mql) return;
    const update = () => setPrefersReducedMotion(Boolean(mql.matches));
    update();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  useEffect(() => {
    if (!lastEvent) return;

    if (isDrawSpinEvent(lastEvent)) {
      const digit = lastEvent.digit;
      if (lastEvent.action === "start") {
        if (currentSpinIdRef.current !== lastEvent.at) {
          currentSpinIdRef.current = lastEvent.at;
          setReelSignal({ ten: "idle", one: "idle" });
        }
        setReelSignal((prev) => ({ ...prev, [digit]: "spinning" }));

        if (fxActive && !safeMode && goPulseIdRef.current !== lastEvent.at) {
          goPulseIdRef.current = lastEvent.at;
          setGoPulse(true);
          if (goPulseTimerRef.current) window.clearTimeout(goPulseTimerRef.current);
          goPulseTimerRef.current = window.setTimeout(() => setGoPulse(false), 560);
        }
      }

      if (lastEvent.action === "stop") {
        setReelSignal((prev) => ({ ...prev, [digit]: "stopped" }));
      }
    }

    if (isDrawCommittedEvent(lastEvent)) {
      if (lastCommittedSeqRef.current === lastEvent.seq) return;
      lastCommittedSeqRef.current = lastEvent.seq;

      // Reset spin tracking. (After commit, snapshot reel status becomes idle.)
      currentSpinIdRef.current = null;
      setReelSignal({ ten: "idle", one: "idle" });
      setGoPulse(false);

      if (confirmedPulseTimerRef.current) window.clearTimeout(confirmedPulseTimerRef.current);
      if (readableBoostTimerRef.current) window.clearTimeout(readableBoostTimerRef.current);
      setConfirmedPulse(false);
      setReadableBoost(true);
      readableBoostTimerRef.current = window.setTimeout(() => setReadableBoost(false), 1100);

      if (fxActive && !safeMode) {
        setConfirmedPulse(true);
        confirmedPulseTimerRef.current = window.setTimeout(() => setConfirmedPulse(false), 180);
      }

      const nextBingoPlayers = lastEvent.stats.bingoPlayers;
      const prevBingoPlayers = prevBingoPlayersRef.current;
      if (typeof nextBingoPlayers === "number") {
        if (typeof prevBingoPlayers === "number") {
          const delta = Math.max(0, nextBingoPlayers - prevBingoPlayers);
          if (delta > 0 && fxEnabled) {
            if (bingoFxTimerRef.current) window.clearTimeout(bingoFxTimerRef.current);
            const key = Date.now();
            setBingoFx({ key, count: delta });
            const duration = safeMode ? 1200 : 1900;
            bingoFxTimerRef.current = window.setTimeout(() => setBingoFx(null), duration);
          }
        }
        prevBingoPlayersRef.current = nextBingoPlayers;
      }
    }
  }, [lastEvent, fxActive, fxEnabled, safeMode]);

  useEffect(() => {
    const count = view?.stats?.bingoPlayers;
    if (typeof count !== "number") return;
    if (typeof prevBingoPlayersRef.current !== "number") prevBingoPlayersRef.current = count;
  }, [view?.stats?.bingoPlayers]);

  useEffect(() => {
    if (!view) return;
    const reelStatus = view.reel.status;
    if (!connected) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (reelStatus !== "spinning") setShownDigit(view.reel.digit);
      return;
    }
    if (reelStatus === "spinning") {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setShownDigit(Math.floor(Math.random() * 10));
      }, spinIntervalMs);
      return;
    }

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setShownDigit(view.reel.digit);
  }, [view?.reel.status, view?.reel.digit, connected, spinIntervalMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (goPulseTimerRef.current) window.clearTimeout(goPulseTimerRef.current);
      if (confirmedPulseTimerRef.current) window.clearTimeout(confirmedPulseTimerRef.current);
      if (readableBoostTimerRef.current) window.clearTimeout(readableBoostTimerRef.current);
      if (bingoFxTimerRef.current) window.clearTimeout(bingoFxTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function scheduleHide() {
      if (hideOverlayTimerRef.current) window.clearTimeout(hideOverlayTimerRef.current);
      hideOverlayTimerRef.current = window.setTimeout(() => setOverlayVisible(false), 3500);
    }
    function showOverlay() {
      setOverlayVisible(true);
      scheduleHide();
    }

    scheduleHide();
    window.addEventListener("mousemove", showOverlay);
    window.addEventListener("keydown", showOverlay);
    window.addEventListener("touchstart", showOverlay, { passive: true });
    return () => {
      if (hideOverlayTimerRef.current) window.clearTimeout(hideOverlayTimerRef.current);
      window.removeEventListener("mousemove", showOverlay);
      window.removeEventListener("keydown", showOverlay);
      window.removeEventListener("touchstart", showOverlay);
    };
  }, []);

  useEffect(() => {
    const prev = prevReelStatusRef.current;
    const next = view?.reel.status ?? null;
    if (prev === "spinning" && next === "stopped") {
      setPopDigit(true);
      if (popTimerRef.current) window.clearTimeout(popTimerRef.current);
      popTimerRef.current = window.setTimeout(() => setPopDigit(false), 420);
    }
    prevReelStatusRef.current = next;
    return () => {
      if (popTimerRef.current) window.clearTimeout(popTimerRef.current);
    };
  }, [view?.reel.status]);

  async function goFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // ignore
    }
  }

  if (!screen) {
    return (
      <main className="min-h-dvh bg-neutral-950 text-neutral-50">
        <div className="mx-auto max-w-xl px-6 py-10">
          <h1 className="text-xl font-semibold">表示画面</h1>
          <p className="mt-2 text-sm text-neutral-300">URL の末尾は /ten または /one を指定してください。</p>
        </div>
      </main>
    );
  }

  const spotlightIds = view?.spotlight?.ids ?? [];
  const spotlightPlayers = view?.spotlight?.players ?? [];
  const playerById = new Map<string, (typeof spotlightPlayers)[number]>();
  for (const p of spotlightPlayers) playerById.set(p.id, p);
  const sideIds = screen === "ten" ? spotlightIds.slice(0, 3) : spotlightIds.slice(3, 6);
  const sidePlayers: Array<(typeof spotlightPlayers)[number] | null> = [];
  for (let i = 0; i < 3; i += 1) {
    const id = sideIds[i];
    if (!id) {
      sidePlayers.push(null);
      continue;
    }
    sidePlayers.push(playerById.get(id) ?? null);
  }
  const emptySlots = sidePlayers.filter((p) => !p).length;

  const sideCards: ReactNode[] = [];
  let emptyRank = 0;
  for (let i = 0; i < 3; i += 1) {
    const p = sidePlayers[i] ?? null;
    if (p) {
      sideCards.push(
        <div key={`spotlight:${i}`} className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate text-lg font-semibold text-neutral-50">{p.displayName}</div>
            {p.progress.isBingo && <Badge variant="success">BINGO</Badge>}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-neutral-300">
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-2 py-2">
              <div className="text-[0.65rem] text-neutral-500">min</div>
              <div className="mt-1 font-mono text-sm text-neutral-100">{p.progress.minMissingToLine}</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-2 py-2">
              <div className="text-[0.65rem] text-neutral-500">reach</div>
              <div className="mt-1 font-mono text-sm text-neutral-100">{p.progress.reachLines}</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-2 py-2">
              <div className="text-[0.65rem] text-neutral-500">lines</div>
              <div className="mt-1 font-mono text-sm text-neutral-100">{p.progress.bingoLines}</div>
            </div>
          </div>
        </div>,
      );
      continue;
    }

    const rank = emptyRank;
    emptyRank += 1;
    if (rank === 0) {
      sideCards.push(
        <div key={`stats-detail:${i}`} className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="text-xs text-neutral-500">統計（詳細）</div>
          <div className="mt-2 grid gap-1 text-sm text-neutral-300">
            <div>
              0手: <span className="font-mono text-neutral-200">{view?.stats?.minMissingHistogram?.["0"] ?? "—"}</span>
            </div>
            <div>
              1手: <span className="font-mono text-neutral-200">{view?.stats?.minMissingHistogram?.["1"] ?? "—"}</span>
            </div>
            <div>
              2手: <span className="font-mono text-neutral-200">{view?.stats?.minMissingHistogram?.["2"] ?? "—"}</span>
            </div>
            <div>
              3+: <span className="font-mono text-neutral-200">{view?.stats?.minMissingHistogram?.["3plus"] ?? "—"}</span>
            </div>
          </div>
        </div>,
      );
      continue;
    }

    if (rank === 1) {
      sideCards.push(
        <div key={`recent:${i}`} className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="text-xs text-neutral-500">直近</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(view?.lastNumbers ?? []).slice().reverse().slice(0, 8).map((n, idx) => (
              <div key={idx} className="rounded-full border border-neutral-800 bg-neutral-950/40 px-3 py-1 text-sm font-mono text-neutral-200">
                {n}
              </div>
            ))}
            {!view?.lastNumbers?.length && <div className="text-sm text-neutral-400">—</div>}
          </div>
        </div>,
      );
      continue;
    }

    sideCards.push(
      <div key={`stats-core:${i}`} className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="text-xs text-neutral-500">統計（コア）</div>
        <div className="mt-3 grid gap-2 text-sm text-neutral-200">
          <div>
            draw: <span className="font-mono text-neutral-50">{view?.drawCount ?? "—"}</span> / 75
          </div>
          <div>
            reach: <span className="font-mono text-neutral-50">{view?.stats?.reachPlayers ?? "—"}</span>
          </div>
          <div>
            bingo: <span className="font-mono text-neutral-50">{view?.stats?.bingoPlayers ?? "—"}</span>
          </div>
        </div>
      </div>,
    );
  }

  return (
    <main
      className={cn(
        "relative min-h-dvh overflow-hidden text-neutral-50",
        fxActive ? "bg-gradient-to-br from-neutral-950 via-neutral-900/10 to-neutral-950" : "bg-neutral-950",
      )}
    >
      {fxActive && (
        <>
          <div
            className={cn(
              "pointer-events-none fixed inset-0 z-0 bg-noise [background-size:180px_180px]",
              safeMode ? "opacity-[0.08]" : isSpinning ? "opacity-[0.24]" : "opacity-[0.18]",
              !safeMode && "animate-[clover-noise_8s_linear_infinite]",
            )}
          />
          <div
            className={cn(
              "pointer-events-none fixed inset-0 z-0",
              safeMode ? "opacity-[0.05]" : isSpinning ? "opacity-[0.13]" : "opacity-[0.10]",
            )}
            style={{
              backgroundImage:
                "repeating-linear-gradient(to bottom, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 6px)",
            }}
          />
        </>
      )}

      {readableBoost && <div className="pointer-events-none fixed inset-0 z-10 bg-black/35" />}

      {bingoFx && fxEnabled && (
        <>
          {!safeMode && fxActive && (
            <div className="pointer-events-none fixed inset-0 z-30">
              {bingoParticles.map((p) => (
                <span key={p.key} className="clover-particle" style={p.style} />
              ))}
            </div>
          )}
          <div className="pointer-events-none fixed inset-0 z-40 flex items-start justify-center pt-20">
            <div
              className={cn(
                "rounded-2xl border px-6 py-4 text-center",
                "border-amber-700/50 bg-amber-950/20 text-amber-100",
                safeMode ? "shadow-[0_0_40px_rgba(234,179,8,0.12)]" : "shadow-[0_0_70px_rgba(234,179,8,0.18)]",
              )}
            >
              <div className="text-3xl font-black tracking-tight text-amber-200 drop-shadow-[0_0_24px_rgba(234,179,8,0.20)] md:text-5xl">
                BINGO!
              </div>
              {bingoFx.count > 1 && <div className="mt-1 text-sm text-amber-200/80">+{bingoFx.count}</div>}
            </div>
          </div>
        </>
      )}

      <div
        className={cn(
          "fixed left-4 top-4 z-50 flex items-center gap-2 transition-opacity duration-300",
          overlayVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-xs text-neutral-200">
          <span className="font-mono">{code}</span>
          <span className="text-neutral-500">/</span>
          <span className="font-mono">{screen}</span>
        </div>
        <WsStatusPill status={status} />
        <Button onClick={goFullscreen} size="sm" variant="secondary">
          全画面
        </Button>
      </div>

      {status !== "connected" && (
        <div className="fixed bottom-4 left-4 z-50">
          <WsStatusPill status={status} className="px-4 py-2 text-sm" />
        </div>
      )}

      {!connected && <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 text-xs text-neutral-300">RECONNECTING…</div>}

      {fxEnabled && connected && isSpinning && typeof reachCount === "number" && (
        <div className="fixed right-4 top-4 z-50 rounded-full border border-neutral-800 bg-neutral-950/40 px-4 py-2 text-xs font-semibold text-neutral-100">
          REACH x{reachCount}
        </div>
      )}

      <div className="relative z-20 grid min-h-dvh grid-cols-1 gap-6 px-6 pb-10 pt-20 lg:grid-cols-[minmax(0,340px)_1fr_minmax(0,340px)] lg:items-stretch">
        {/* Outer side: spotlight (or detailed stats) */}
        {screen === "ten" ? (
          <aside className="grid gap-4 lg:order-1">
            {sideCards}
          </aside>
        ) : (
          <aside className="grid gap-4 lg:order-1">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="text-xs text-neutral-500">統計（コア）</div>
              <div className="mt-3 grid gap-2 text-sm text-neutral-200">
                <div>
                  draw: <span className="font-mono text-neutral-50">{view?.drawCount ?? "—"}</span> / 75
                </div>
                <div>
                  reach: <span className="font-mono text-neutral-50">{view?.stats?.reachPlayers ?? "—"}</span>
                </div>
                <div>
                  bingo: <span className="font-mono text-neutral-50">{view?.stats?.bingoPlayers ?? "—"}</span>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="text-xs text-neutral-500">直近</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(view?.lastNumbers ?? []).slice().reverse().map((n, idx) => (
                  <div key={idx} className="rounded-full border border-neutral-800 bg-neutral-950/40 px-3 py-1 text-sm font-mono text-neutral-200">
                    {n}
                  </div>
                ))}
                {!view?.lastNumbers?.length && <div className="text-sm text-neutral-400">—</div>}
              </div>
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="text-xs text-neutral-500">スポットライト</div>
              <div className="mt-2 text-sm text-neutral-300">
                v{fmtNum(view?.spotlight?.version)} / {view?.spotlight?.updatedBy ?? "—"} /{" "}
                {view?.spotlight?.updatedAt ? relativeFromNow(view.spotlight.updatedAt) : "—"}
              </div>
              <div className="mt-3 grid gap-2">
                {sidePlayers.map((p, idx) => (
                  <div key={idx} className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm text-neutral-200">
                    {p?.displayName ?? "（未選択）"}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Center: reel */}
        <div className={cn("flex items-center justify-center lg:order-2", screen === "ten" ? "lg:justify-end" : "lg:justify-start")}>
          <div className={cn("text-center", screen === "ten" ? "lg:text-right" : "lg:text-left")}>
            <div className={cn("relative inline-flex items-center justify-center", fxActive && popDigit && !safeMode && "animate-[clover-clunk_420ms_ease-out]")}>
              <div
                className={cn(
                  "relative isolate overflow-hidden rounded-[2.75rem] border px-[4vw] py-[2vw]",
                  "border-neutral-800/70 bg-neutral-950/35 shadow-[0_0_140px_rgba(0,0,0,0.70)]",
                  fxActive && !safeMode && !isSpinning && "animate-[clover-breath_4.8s_ease-in-out_infinite]",
                  isSpinning && "border-amber-700/25 shadow-[0_0_140px_rgba(234,179,8,0.10)]",
                  fxActive && isLastSpinning && visualReachIntensity > 0 && "border-amber-500/35 shadow-[0_0_180px_rgba(234,179,8,0.12)]",
                  readableBoost && "bg-neutral-950/60",
                )}
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-white/0 to-transparent opacity-70" />
                <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]" />

                {goPulse && fxActive && !safeMode && (
                  <div className="pointer-events-none absolute inset-0 animate-[clover-go_560ms_ease-out] rounded-[2.75rem] ring-2 ring-amber-400/30" />
                )}
                {confirmedPulse && fxActive && !safeMode && (
                  <div className="pointer-events-none absolute inset-0 animate-[clover-confirm_180ms_ease-out] rounded-[2.75rem] ring-2 ring-emerald-300/25" />
                )}

                <div
                  className={cn(
                    "relative z-10 font-black tabular-nums tracking-tight",
                    "text-[42vw] leading-none md:text-[26vw]",
                    isSpinning
                      ? "text-amber-200 drop-shadow-[0_0_70px_rgba(234,179,8,0.22)]"
                      : "text-neutral-50 drop-shadow-[0_0_40px_rgba(255,255,255,0.10)]",
                    fxActive && isSpinning && !safeMode && (isLastSpinning ? "blur-[0.2px]" : "blur-[0.8px]"),
                  )}
                >
                  {shownDigit ?? "?"}
                </div>

                {fxEnabled && readableBoost && (
                  <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-neutral-700/50 bg-neutral-950/60 px-3 py-1 text-xs font-semibold text-neutral-100">
                    CONFIRMED
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 text-sm text-neutral-400">
              reel: <span className="text-neutral-200">{view?.reel.status ?? "idle"}</span> / last:{" "}
              <span className="font-mono text-neutral-200">{view?.lastNumber ?? "—"}</span>
            </div>
            {view?.sessionStatus === "ended" && (
              <div className="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-200">
                セッションは終了しました。
              </div>
            )}
          </div>
        </div>

        {/* Inner side: stats core / spotlight */}
        {screen === "ten" ? (
          <aside className="grid gap-4 lg:order-3">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="text-xs text-neutral-500">統計（コア）</div>
              <div className="mt-3 grid gap-2 text-sm text-neutral-200">
                <div>
                  draw: <span className="font-mono text-neutral-50">{view?.drawCount ?? "—"}</span> / 75
                </div>
                <div>
                  reach: <span className="font-mono text-neutral-50">{view?.stats?.reachPlayers ?? "—"}</span>
                </div>
                <div>
                  bingo: <span className="font-mono text-neutral-50">{view?.stats?.bingoPlayers ?? "—"}</span>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="text-xs text-neutral-500">直近</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(view?.lastNumbers ?? []).slice().reverse().map((n, idx) => (
                  <div key={idx} className="rounded-full border border-neutral-800 bg-neutral-950/40 px-3 py-1 text-sm font-mono text-neutral-200">
                    {n}
                  </div>
                ))}
                {!view?.lastNumbers?.length && <div className="text-sm text-neutral-400">—</div>}
              </div>
            </div>
            {emptySlots > 0 && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                <div className="text-xs text-neutral-500">統計（詳細）</div>
                <div className="mt-2 grid gap-1 text-sm text-neutral-300">
                  <div>
                    0手: <span className="font-mono text-neutral-200">{view?.stats?.minMissingHistogram?.["0"] ?? "—"}</span>
                  </div>
                  <div>
                    1手: <span className="font-mono text-neutral-200">{view?.stats?.minMissingHistogram?.["1"] ?? "—"}</span>
                  </div>
                  <div>
                    2手: <span className="font-mono text-neutral-200">{view?.stats?.minMissingHistogram?.["2"] ?? "—"}</span>
                  </div>
                  <div>
                    3+: <span className="font-mono text-neutral-200">{view?.stats?.minMissingHistogram?.["3plus"] ?? "—"}</span>
                  </div>
                </div>
              </div>
            )}
          </aside>
        ) : (
          <aside className="grid gap-4 lg:order-3">
            {sideCards}
          </aside>
        )}
      </div>
    </main>
  );
}
