import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import BingoCard from "../components/BingoCard";
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
  newBingoNames?: string[];
};

type SpotlightPlayer = DisplaySnapshot["spotlight"]["players"][number];

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
  if (sec < 10) return "NOW";
  if (sec < 60) return `${sec}s AGO`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m AGO`;
  const hr = Math.floor(min / 60);
  return `${hr}h AGO`;
}

function randomIntInclusive(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
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
  const maybe = ev as { type?: unknown; seq?: unknown; number?: unknown; committedAt?: unknown; stats?: unknown; newBingoNames?: unknown };
  if (maybe.type !== "draw.committed") return false;
  if (typeof maybe.seq !== "number") return false;
  if (typeof maybe.number !== "number") return false;
  if (typeof maybe.committedAt !== "string") return false;
  if (typeof maybe.newBingoNames !== "undefined" && !Array.isArray(maybe.newBingoNames)) return false;
  if (!maybe.stats || typeof maybe.stats !== "object") return false;
  const stats = maybe.stats as { bingoPlayers?: unknown };
  if (typeof stats.bingoPlayers !== "number") return false;
  return true;
}

// Decoding effect characters
const DECODE_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+-=[]{}|;:,.<>?";

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

  const [shownDigit, setShownDigit] = useState<string | number | null>(null);
  const timerRef = useRef<number | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const hideOverlayTimerRef = useRef<number | null>(null);
  const prevReelStatusRef = useRef<string | null>(null);
  
  // Juice States
  const [shake, setShake] = useState<"none" | "small" | "medium" | "violent">("none");
  const shakeTimerRef = useRef<number | null>(null);
  const [glitch, setGlitch] = useState(false);
  
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
  const [bingoAnnounce, setBingoAnnounce] = useState<{ key: number; names: string[]; showNames: boolean } | null>(null);
  const bingoAnnounceSeqRef = useRef(0);
  const bingoAnnounceNameTimerRef = useRef<number | null>(null);
  const bingoAnnounceHideTimerRef = useRef<number | null>(null);
  const prevBingoPlayersRef = useRef<number | null>(null);
  const lastCommittedSeqRef = useRef<number | null>(null);

  const [reelSignal, setReelSignal] = useState<Record<ReelDigit, "idle" | "spinning" | "stopped">>({ ten: "idle", one: "idle" });
  const currentSpinIdRef = useRef<number | null>(null);
  const spotlightCacheRef = useRef<Map<string, SpotlightPlayer>>(new Map());

  const screenDigit: ReelDigit = screen === "one" ? "one" : "ten";
  const otherDigit: ReelDigit = screenDigit === "ten" ? "one" : "ten";
  const reachCount = view?.stats?.reachPlayers ?? null;
  const reachIntensity = reachIntensityFromCount(reachCount);
  const visualReachIntensity: ReachIntensity = safeMode ? (Math.min(1, reachIntensity) as ReachIntensity) : reachIntensity;
  const isSpinning = view?.reel.status === "spinning";
  const isLastSpinning = Boolean(isSpinning && reelSignal[otherDigit] === "stopped");
  
  // Spin speed: slow down in safe/reduced-motion mode to reduce motion and CPU load.
  const spinIntervalMs = safeMode || !fxEnabled ? 90 : isLastSpinning ? 60 : 40;

  // Trigger shake helper
  const triggerShake = (intensity: "small" | "medium" | "violent") => {
    if (safeMode || !fxActive) return;
    setShake(intensity);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = window.setTimeout(() => setShake("none"), intensity === "violent" ? 600 : intensity === "medium" ? 400 : 200);
  };

  const bingoParticles = useMemo(() => {
    if (!bingoFx || safeMode || !fxActive) return [];
    const list: Array<{ key: string; style: CSSProperties }> = [];
    for (let i = 0; i < 25; i += 1) { // More particles
      const side = i % 2 === 0 ? "left" : "right";
      const xBase = side === "left" ? 10 : 78;
      const xJitter = Math.random() * 20;
      const x = xBase + xJitter;
      const size = 8 + Math.floor(Math.random() * 14);
      const delay = Math.floor(Math.random() * 300);
      const dur = 1000 + Math.floor(Math.random() * 800);
      const dx = (side === "left" ? 1 : -1) * (30 + Math.floor(Math.random() * 50));
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
    const list = view?.spotlight?.players ?? [];
    if (!list.length) return;
    const cache = spotlightCacheRef.current;
    for (const p of list) {
      const prev = cache.get(p.id);
      cache.set(p.id, { ...prev, ...p, card: p.card ?? prev?.card });
    }
  }, [view?.spotlight?.players]);

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
          
          // Trigger small shake on spin start
          triggerShake("small");
        }
      }

      if (lastEvent.action === "stop") {
        setReelSignal((prev) => ({ ...prev, [digit]: "stopped" }));
      }
    }

    if (isDrawCommittedEvent(lastEvent)) {
      if (lastCommittedSeqRef.current === lastEvent.seq) return;
      lastCommittedSeqRef.current = lastEvent.seq;

      // Reset spin tracking.
      currentSpinIdRef.current = null;
      setReelSignal({ ten: "idle", one: "idle" });
      setGoPulse(false);

      if (confirmedPulseTimerRef.current) window.clearTimeout(confirmedPulseTimerRef.current);
      if (readableBoostTimerRef.current) window.clearTimeout(readableBoostTimerRef.current);
      setConfirmedPulse(false);
      setReadableBoost(true);
      readableBoostTimerRef.current = window.setTimeout(() => setReadableBoost(false), 900);

      if (fxActive && !safeMode) {
        setConfirmedPulse(true);
        confirmedPulseTimerRef.current = window.setTimeout(() => setConfirmedPulse(false), 180);
        // Medium shake on commit
        triggerShake("medium");
      }

      bingoAnnounceSeqRef.current += 1;
      const announceSeq = bingoAnnounceSeqRef.current;
      if (bingoAnnounceNameTimerRef.current) window.clearTimeout(bingoAnnounceNameTimerRef.current);
      if (bingoAnnounceHideTimerRef.current) window.clearTimeout(bingoAnnounceHideTimerRef.current);
      bingoAnnounceNameTimerRef.current = null;
      bingoAnnounceHideTimerRef.current = null;
      const newBingoNames = Array.isArray(lastEvent.newBingoNames)
        ? lastEvent.newBingoNames.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        : [];
      if (newBingoNames.length > 0) {
        const key = Date.now();
        setBingoAnnounce({ key, names: newBingoNames, showNames: safeMode });
        
        // Violent shake on Bingo!
        triggerShake("violent");
        setGlitch(true);
        setTimeout(() => setGlitch(false), 1000);

        const revealDelayMs = safeMode ? 0 : randomIntInclusive(250, 650);
        if (!safeMode) {
          bingoAnnounceNameTimerRef.current = window.setTimeout(() => {
            if (bingoAnnounceSeqRef.current !== announceSeq) return;
            setBingoAnnounce({ key, names: newBingoNames, showNames: true });
          }, revealDelayMs);
        }

        const hideAfterMs = safeMode ? 2200 : 3800;
        bingoAnnounceHideTimerRef.current = window.setTimeout(() => {
          if (bingoAnnounceSeqRef.current !== announceSeq) return;
          setBingoAnnounce(null);
        }, hideAfterMs);
      } else {
        setBingoAnnounce(null);
      }

      const nextBingoPlayers = lastEvent.stats.bingoPlayers;
      const prevBingoPlayers = prevBingoPlayersRef.current;
      const delta =
        newBingoNames.length > 0
          ? newBingoNames.length
          : typeof nextBingoPlayers === "number" && typeof prevBingoPlayers === "number"
            ? Math.max(0, nextBingoPlayers - prevBingoPlayers)
            : 0;
      if (delta > 0 && fxEnabled) {
        if (bingoFxTimerRef.current) window.clearTimeout(bingoFxTimerRef.current);
        const key = Date.now();
        setBingoFx({ key, count: delta });
        const duration = safeMode ? 1100 : 1700;
        bingoFxTimerRef.current = window.setTimeout(() => setBingoFx(null), duration);
      }
      if (typeof nextBingoPlayers === "number") prevBingoPlayersRef.current = nextBingoPlayers;
    }
  }, [lastEvent, fxActive, fxEnabled, safeMode]);

  useEffect(() => {
    const count = view?.stats?.bingoPlayers;
    if (typeof count !== "number") return;
    if (typeof prevBingoPlayersRef.current !== "number") prevBingoPlayersRef.current = count;
  }, [view?.stats?.bingoPlayers]);

  // DECODING EFFECT
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
        // Show random character from DECODE_CHARS
        const char = DECODE_CHARS[Math.floor(Math.random() * DECODE_CHARS.length)];
        setShownDigit(char);
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
      if (bingoAnnounceNameTimerRef.current) window.clearTimeout(bingoAnnounceNameTimerRef.current);
      if (bingoAnnounceHideTimerRef.current) window.clearTimeout(bingoAnnounceHideTimerRef.current);
      if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current);
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
      <main className="min-h-dvh bg-pit-bg text-pit-text-main font-mono">
        <div className="mx-auto max-w-xl px-6 py-10">
          <h1 className="text-xl font-semibold">DISPLAY_INIT_FAIL</h1>
          <p className="mt-2 text-sm text-pit-text-dim">URL ENDPOINT INVALID. /ten OR /one REQUIRED.</p>
        </div>
      </main>
    );
  }

  const drawnNumbers = view?.drawnNumbers ?? [];
  const spotlightIds = view?.spotlight?.ids ?? [];
  const spotlightPlayers = view?.spotlight?.players ?? [];
  const playerById = new Map<string, SpotlightPlayer>();
  for (const p of spotlightPlayers) playerById.set(p.id, p);
  const sideIds = screen === "ten" ? spotlightIds.slice(0, 3) : spotlightIds.slice(3, 6);
  const sidePlayers: Array<SpotlightPlayer | null> = [];
  for (let i = 0; i < 3; i += 1) {
    const id = sideIds[i];
    if (!id) {
      sidePlayers.push(null);
      continue;
    }
    sidePlayers.push(playerById.get(id) ?? spotlightCacheRef.current.get(id) ?? null);
  }
  const emptySlots = sidePlayers.filter((p) => !p).length;

  const sideCards: ReactNode[] = [];
  let emptyRank = 0;
  for (let i = 0; i < 3; i += 1) {
    const p = sidePlayers[i] ?? null;
    if (p) {
      sideCards.push(
        <div key={`spotlight:${i}`} className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate text-xl font-bold text-pit-text-main text-glow">{p.displayName}</div>
            {p.progress.isBingo && <Badge variant="success" className="animate-pulse">BINGO</Badge>}
          </div>
          {p.card ? (
            <div className="mt-3">
              <BingoCard card={p.card} drawnNumbers={drawnNumbers} showHeaders={false} className="max-w-none" />
            </div>
          ) : (
            <div className="mt-3 text-sm text-pit-text-dim">NO CARD DATA</div>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-pit-text-dim">
            <div className="border border-pit-border bg-pit-bg/80 px-2 py-2">
              <div className="text-[0.65rem] text-pit-text-muted">MIN</div>
              <div className="mt-1 font-mono text-base text-pit-primary">{p.progress.minMissingToLine}</div>
            </div>
            <div className="border border-pit-border bg-pit-bg/80 px-2 py-2">
              <div className="text-[0.65rem] text-pit-text-muted">REACH</div>
              <div className="mt-1 font-mono text-base text-pit-primary">{p.progress.reachLines}</div>
            </div>
            <div className="border border-pit-border bg-pit-bg/80 px-2 py-2">
              <div className="text-[0.65rem] text-pit-text-muted">LINES</div>
              <div className="mt-1 font-mono text-base text-pit-primary">{p.progress.bingoLines}</div>
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
        <div key={`stats-detail:${i}`} className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
          <div className="text-xs text-pit-text-muted">STATS_DETAIL_DUMP</div>
          <div className="mt-2 grid gap-1 text-sm text-pit-text-dim">
            <div>
              [0]: <span className="font-mono text-pit-text-main">{view?.stats?.minMissingHistogram?.["0"] ?? "—"}</span>
            </div>
            <div>
              [1]: <span className="font-mono text-pit-text-main">{view?.stats?.minMissingHistogram?.["1"] ?? "—"}</span>
            </div>
            <div>
              [2]: <span className="font-mono text-pit-text-main">{view?.stats?.minMissingHistogram?.["2"] ?? "—"}</span>
            </div>
            <div>
              [3+]: <span className="font-mono text-pit-text-main">{view?.stats?.minMissingHistogram?.["3plus"] ?? "—"}</span>
            </div>
          </div>
        </div>,
      );
      continue;
    }

    if (rank === 1) {
      sideCards.push(
        <div key={`recent:${i}`} className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
          <div className="text-xs text-pit-text-muted">RECENT_LOG</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(view?.lastNumbers ?? []).slice().reverse().slice(0, 8).map((n, idx) => (
              <div key={idx} className="border border-pit-border bg-pit-bg/80 px-3 py-1 text-sm font-mono text-pit-primary">
                {n}
              </div>
            ))}
            {!view?.lastNumbers?.length && <div className="text-sm text-pit-text-dim">NO_DATA</div>}
          </div>
        </div>,
      );
      continue;
    }

    sideCards.push(
      <div key={`stats-core:${i}`} className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
        <div className="text-xs text-pit-text-muted">CORE_STATS</div>
        <div className="mt-3 grid gap-2 text-sm text-pit-text-main">
          <div>
            DRAW: <span className="font-mono text-pit-primary">{view?.drawCount ?? "—"}</span> / 75
          </div>
          <div>
            REACH: <span className="font-mono text-pit-primary">{view?.stats?.reachPlayers ?? "—"}</span>
          </div>
          <div>
            BINGO: <span className="font-mono text-pit-primary">{view?.stats?.bingoPlayers ?? "—"}</span>
          </div>
        </div>
      </div>,
    );
  }

  const shakeClass = shake === "small" ? "shake-small" : shake === "medium" ? "shake-medium" : shake === "violent" ? "shake-violent" : "";
  const glitchClass = glitch ? "glitch-active" : "";

  return (
    <main
      className={cn(
        "relative min-h-dvh overflow-hidden text-pit-text-main font-mono bg-pit-bg crt-monitor",
      )}
    >
      <div className="crt-overlay" />

      {/* Juice Container */}
      <div className={cn("relative z-10 size-full transition-transform", shakeClass)}>

      {fxActive && (
        <>
            {/* Vignette & texture (in addition to CRT) */}
          <div
            className={cn(
              "pointer-events-none fixed inset-0 z-0 bg-noise [background-size:180px_180px]",
              safeMode ? "opacity-[0.04]" : "opacity-[0.1]",
              !safeMode && "animate-[clover-noise_8s_linear_infinite]",
            )}
          />
        </>
      )}

      {readableBoost && <div className="pointer-events-none fixed inset-0 z-10 bg-black/50" />}

      {(bingoFx || bingoAnnounce) && (
        <>
          {!safeMode && fxActive && fxEnabled && bingoFx && (
            <div className="pointer-events-none fixed inset-0 z-30">
              {bingoParticles.map((p) => (
                <span key={p.key} className="clover-particle" style={p.style} />
              ))}
            </div>
          )}
          <div className={cn("pointer-events-none fixed inset-0 z-40 flex items-start justify-center pt-20", glitchClass)}>
            <div
              className={cn(
                "border px-8 py-6 text-center backdrop-blur-sm",
                "border-pit-primary bg-black/80 text-pit-primary",
                safeMode ? "shadow-[0_0_40px_rgba(234,179,8,0.12)]" : "shadow-[0_0_100px_rgba(234,179,8,0.4)] box-glow",
              )}
            >
              <div className="text-6xl font-black tracking-tighter text-pit-primary drop-shadow-[0_0_24px_rgba(234,179,8,0.6)] md:text-8xl animate-pulse">
                JACKPOT!
              </div>
              {bingoAnnounce && bingoAnnounce.showNames && (
                <>
                  <div className="mt-4 max-w-[84vw] truncate text-4xl font-bold text-white md:text-6xl text-glow">
                    {bingoAnnounce.names[0] ?? "?"}
                  </div>
                  {bingoAnnounce.names.length > 1 && (
                    <div className="mt-4">
                      <div className="text-sm font-semibold tracking-[0.5em] text-pit-text-dim">WINNERS_LIST</div>
                      <div className="mt-2 flex max-w-[84vw] flex-wrap justify-center gap-x-6 gap-y-2 text-xl text-pit-text-main md:text-2xl">
                        {bingoAnnounce.names.slice(1, 5).map((name, idx) => (
                          <span key={idx} className="max-w-[18ch] truncate text-glow">
                            {name}
                          </span>
                        ))}
                        {(() => {
                          const shownOthers = Math.min(4, Math.max(0, bingoAnnounce.names.length - 1));
                          const remaining = Math.max(0, bingoAnnounce.names.length - 1 - shownOthers);
                          return remaining > 0 ? <span className="text-pit-text-dim">+ {remaining} OTHERS</span> : null;
                        })()}
                      </div>
                    </div>
                  )}
                </>
              )}
              {(() => {
                const count = bingoFx?.count ?? (bingoAnnounce ? bingoAnnounce.names.length : 0);
                return count > 1 ? <div className="mt-2 text-xl text-pit-primary font-bold">+{count}</div> : null;
              })()}
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
        <div className="flex items-center gap-2 border border-pit-border bg-pit-bg/90 px-3 py-2 text-xs text-pit-text-main shadow-lg">
          <span className="font-mono text-pit-primary">{code}</span>
          <span className="text-pit-text-dim">::</span>
          <span className="font-mono">{screen}</span>
        </div>
        <WsStatusPill status={status} />
        <Button onClick={goFullscreen} size="sm" variant="secondary" className="rounded-none font-mono">
          FULLSCREEN
        </Button>
      </div>

      {status !== "connected" && (
        <div className="fixed bottom-4 left-4 z-50">
          <WsStatusPill status={status} className="px-4 py-2 text-sm rounded-none" />
        </div>
      )}

      {!connected && <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 text-xs text-pit-danger animate-pulse">SIGNAL LOST / RECONNECTING...</div>}

      {fxEnabled && connected && isSpinning && typeof reachCount === "number" && (
        <div className="fixed right-4 top-4 z-50 border border-pit-danger bg-pit-bg/90 px-4 py-2 text-xs font-bold text-pit-danger animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]">
          REACH_ALERT :: {reachCount}
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
            <div className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
              <div className="text-xs text-pit-text-muted">CORE_STATS</div>
              <div className="mt-3 grid gap-2 text-sm text-pit-text-main">
                <div>
                  DRAW: <span className="font-mono text-pit-primary">{view?.drawCount ?? "—"}</span> / 75
                </div>
                <div>
                  REACH: <span className="font-mono text-pit-primary">{view?.stats?.reachPlayers ?? "—"}</span>
                </div>
                <div>
                  BINGO: <span className="font-mono text-pit-primary">{view?.stats?.bingoPlayers ?? "—"}</span>
                </div>
              </div>
            </div>
            <div className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
              <div className="text-xs text-pit-text-muted">RECENT_LOG</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(view?.lastNumbers ?? []).slice().reverse().map((n, idx) => (
                  <div key={idx} className="border border-pit-border bg-pit-bg/80 px-3 py-1 text-sm font-mono text-pit-primary">
                    {n}
                  </div>
                ))}
                {!view?.lastNumbers?.length && <div className="text-sm text-pit-text-dim">NO_DATA</div>}
              </div>
            </div>
            <div className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
              <div className="text-xs text-pit-text-muted">SPOTLIGHT_META</div>
              <div className="mt-2 text-sm text-pit-text-dim">
                v{fmtNum(view?.spotlight?.version)} / {view?.spotlight?.updatedBy ?? "—"} /{" "}
                {view?.spotlight?.updatedAt ? relativeFromNow(view.spotlight.updatedAt) : "—"}
              </div>
              <div className="mt-3 grid gap-2">
                {sidePlayers.map((p, idx) => (
                  <div key={idx} className="border border-pit-border bg-pit-bg/80 px-3 py-2 text-sm text-pit-text-main">
                    {p?.displayName ?? "VOID_SLOT"}
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
                    "relative isolate overflow-hidden border p-[1.8vw]",
                    "border-pit-border bg-black shadow-[0_0_100px_rgba(0,0,0,1)]",
                    fxActive && !safeMode && !isSpinning && "animate-[clover-breath_4.8s_ease-in-out_infinite]",
                    isSpinning && "border-pit-primary/50 shadow-[0_0_140px_rgba(234,179,8,0.3)]",
                    fxActive && isLastSpinning && visualReachIntensity > 0 && "border-pit-danger/50 shadow-[0_0_180px_rgba(239,68,68,0.3)]",
                    readableBoost && "bg-black/90",
                  )}
                >
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)50%,rgba(0,0,0,0.25)50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] opacity-20" />
                
                {goPulse && fxActive && !safeMode && (
                  <div className="pointer-events-none absolute inset-0 animate-[clover-go_560ms_ease-out] border-4 border-pit-primary" />
                )}
                {confirmedPulse && fxActive && !safeMode && (
                  <div className="pointer-events-none absolute inset-0 animate-[clover-confirm_180ms_ease-out] border-4 border-emerald-500" />
                )}

                <div
                  className={cn(
                    "relative z-10 font-black tabular-nums tracking-tight font-header",
                    "text-[min(92vw,88vh)] leading-none",
                    isSpinning
                      ? "text-pit-primary drop-shadow-[0_0_20px_rgba(234,179,8,0.8)]"
                      : "text-pit-text-main drop-shadow-[0_0_20px_rgba(255,255,255,0.4)]",
                    fxActive && isSpinning && !safeMode && (isLastSpinning ? "blur-[0.5px]" : "blur-[2px]"),
                  )}
                >
                  {shownDigit ?? "?"}
                </div>

                {fxEnabled && readableBoost && (
                  <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 border border-pit-secondary bg-black/80 px-4 py-1 text-sm font-bold text-pit-secondary tracking-[0.2em] shadow-[0_0_10px_rgba(16,185,129,0.5)]">
                    LOCKED
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 text-sm font-mono text-pit-text-dim tracking-wider">
              REEL_STATUS ::{" "}
              <span className={cn("text-pit-text-main", view?.reel.status === "spinning" ? "text-pit-primary animate-pulse" : "")}>
                {(view?.reel?.status ?? "idle").toUpperCase()}
              </span>{" "}
              <span className="mx-2">|</span> LAST_IDX :: <span className="font-mono text-pit-text-main">{view?.lastNumber ?? "—"}</span>
            </div>
            {view?.sessionStatus === "ended" && (
              <div className="mt-4 border border-pit-danger bg-pit-danger/10 p-3 text-sm text-pit-danger font-bold tracking-widest">
                SESSION_TERMINATED
              </div>
            )}
          </div>
        </div>

        {/* Inner side: stats core / spotlight */}
        {screen === "ten" ? (
          <aside className="grid gap-4 lg:order-3">
            <div className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
              <div className="text-xs text-pit-text-muted">CORE_STATS</div>
              <div className="mt-3 grid gap-2 text-sm text-pit-text-main">
                <div>
                  DRAW: <span className="font-mono text-pit-primary">{view?.drawCount ?? "—"}</span> / 75
                </div>
                <div>
                  REACH: <span className="font-mono text-pit-primary">{view?.stats?.reachPlayers ?? "—"}</span>
                </div>
                <div>
                  BINGO: <span className="font-mono text-pit-primary">{view?.stats?.bingoPlayers ?? "—"}</span>
                </div>
              </div>
            </div>
            <div className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
              <div className="text-xs text-pit-text-muted">RECENT_LOG</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(view?.lastNumbers ?? []).slice().reverse().map((n, idx) => (
                  <div key={idx} className="border border-pit-border bg-pit-bg/80 px-3 py-1 text-sm font-mono text-pit-primary">
                    {n}
                  </div>
                ))}
                {!view?.lastNumbers?.length && <div className="text-sm text-pit-text-dim">NO_DATA</div>}
              </div>
            </div>
            {emptySlots > 0 && (
              <div className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
                <div className="text-xs text-pit-text-muted">STATS_DETAIL_DUMP</div>
                <div className="mt-2 grid gap-1 text-sm text-pit-text-dim">
                  <div>
                    [0]: <span className="font-mono text-pit-text-main">{view?.stats?.minMissingHistogram?.["0"] ?? "—"}</span>
                  </div>
                  <div>
                    [1]: <span className="font-mono text-pit-text-main">{view?.stats?.minMissingHistogram?.["1"] ?? "—"}</span>
                  </div>
                  <div>
                    [2]: <span className="font-mono text-pit-text-main">{view?.stats?.minMissingHistogram?.["2"] ?? "—"}</span>
                  </div>
                  <div>
                    [3+]: <span className="font-mono text-pit-text-main">{view?.stats?.minMissingHistogram?.["3plus"] ?? "—"}</span>
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
      </div>
    </main>
  );
}
