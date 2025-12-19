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

type BingoAnnounceState = {
  key: number;
  names: string[];
  showNames: boolean;
  pageIndex: number;
  shownCount: number;
  pageSize: number;
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

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function computeJackpotStepMs(winnerCount: number): number {
  // Keep the reveal readable for small counts, but avoid absurd durations for large counts.
  const count = Math.max(1, Math.floor(winnerCount));
  const raw = Math.floor(12000 / count);
  return clampInt(raw, 180, 1400);
}

function computeJackpotPageSize(): number {
  if (typeof window === "undefined") return 8;
  const w = Math.max(320, window.innerWidth);
  const h = Math.max(320, window.innerHeight);
  // Header uses text-[min(26vw,26vh)] and we keep extra padding for borders and spacing.
  const headerPx = Math.min(w * 0.26, h * 0.26);
  const chromePx = 260; // conservative: border/padding/title spacing
  const available = Math.max(180, h - headerPx - chromePx);
  // Winner rows use text-[min(6vw,3.6rem)] => max ~58px on typical screens.
  const fontPx = Math.min(w * 0.06, 58);
  const rowPx = fontPx * 1.08 + 10; // leading + gap
  const rows = Math.floor(available / rowPx);
  return clampInt(rows, 3, 12);
}

const ADMIN_BINGO_NAME_STEP_MS = 1400;
// Measured via ffprobe: 4.111s (add a small buffer so we never cut early).
const LONG_STREAK_END_SFX_MS = 4300;

function computeJackpotMinVisibleMs(winnerCount: number): number {
  const count = Math.max(0, Math.floor(winnerCount));
  if (count < 2) return 0;
  // Admin plays longStreakEnd after "1400ms/name" cycling ends.
  return count * ADMIN_BINGO_NAME_STEP_MS + LONG_STREAK_END_SFX_MS;
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
  const [strobe, setStrobe] = useState(false);
  const glitchTimerRef = useRef<number | null>(null);
  const strobeTimerRef = useRef<number | null>(null);
  
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
  const [bingoAnnounce, setBingoAnnounce] = useState<BingoAnnounceState | null>(null);
  const bingoAnnounceSeqRef = useRef(0);
  const bingoAnnounceNameTimerRef = useRef<number | null>(null);
  const bingoAnnounceStepTimerRef = useRef<number | null>(null);
  const bingoAnnounceHideTimerRef = useRef<number | null>(null);
  const prevBingoPlayersRef = useRef<number | null>(null);
  const lastCommittedSeqRef = useRef<number | null>(null);

  const [reelSignal, setReelSignal] = useState<Record<ReelDigit, "idle" | "spinning" | "stopped">>({ ten: "idle", one: "idle" });
  const currentSpinIdRef = useRef<number | null>(null);
  const spotlightCacheRef = useRef<Map<string, SpotlightPlayer>>(new Map());

  const screenDigit: ReelDigit = screen === "one" ? "one" : "ten";
  const otherDigit: ReelDigit = screenDigit === "ten" ? "one" : "ten";
  const reachCount = view?.stats?.reachPlayers ?? null;
  const actualReachIntensity: ReachIntensity = (view?.fx?.actualReachIntensity ?? reachIntensityFromCount(reachCount)) as ReachIntensity;
  const effectiveReachIntensity: ReachIntensity = (view?.fx?.effectiveReachIntensity ?? actualReachIntensity) as ReachIntensity;
  const visualReachIntensity: ReachIntensity = safeMode ? (Math.min(1, effectiveReachIntensity) as ReachIntensity) : effectiveReachIntensity;
  const drawSpinning = view?.drawState === "spinning";
  const tensionLevel: ReachIntensity = fxActive && drawSpinning ? visualReachIntensity : 0;
  const tensionTheme = tensionLevel === 3 ? "rainbow" : tensionLevel === 2 ? "red" : tensionLevel === 1 ? "yellow" : "calm";
  const isSpinning = view?.reel?.status === "spinning";
  const isLastSpinning = Boolean(isSpinning && reelSignal[otherDigit] === "stopped");
  
  // Spin speed: slow down in safe/reduced-motion mode to reduce motion and CPU load.
  const spinIntervalMs = safeMode || !fxEnabled ? 90 : isLastSpinning ? 60 : 40;

  const noiseLevel: ReachIntensity = !safeMode && fxActive && drawSpinning ? tensionLevel : 0;
  const noiseOpacityClass = safeMode
    ? "opacity-[0.04]"
    : noiseLevel === 3
      ? "opacity-[0.18]"
      : noiseLevel === 2
        ? "opacity-[0.14]"
        : noiseLevel === 1
          ? "opacity-[0.1]"
          : "opacity-[0.08]";
  const noiseAnimClass =
    safeMode || !fxActive
      ? ""
      : noiseLevel === 3
        ? "animate-[clover-noise_3.2s_linear_infinite]"
        : noiseLevel === 2
          ? "animate-[clover-noise_5s_linear_infinite]"
          : noiseLevel === 1
            ? "animate-[clover-noise_7s_linear_infinite]"
            : "animate-[clover-noise_8s_linear_infinite]";

  // Trigger shake helper
  const triggerShake = (intensity: "small" | "medium" | "violent") => {
    if (safeMode || !fxActive) return;
    setShake(intensity);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = window.setTimeout(() => setShake("none"), intensity === "violent" ? 600 : intensity === "medium" ? 400 : 200);
  };

  const bingoParticles = useMemo(() => {
    if (!bingoFx || safeMode || !fxActive) return [];
    const particleCount = visualReachIntensity === 3 ? 60 : visualReachIntensity === 2 ? 45 : 30;
    const minSize = visualReachIntensity === 3 ? 14 : visualReachIntensity === 2 ? 12 : 10;
    const sizeJitter = visualReachIntensity === 3 ? 36 : visualReachIntensity === 2 ? 28 : 20;
    const list: Array<{ key: string; style: CSSProperties }> = [];
    for (let i = 0; i < particleCount; i += 1) {
      const side = i % 2 === 0 ? "left" : "right";
      const xBase = side === "left" ? 10 : 78;
      const xJitter = Math.random() * 20;
      const x = xBase + xJitter;
      const size = minSize + Math.floor(Math.random() * sizeJitter);
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
  }, [bingoFx, fxActive, safeMode, visualReachIntensity]);

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
          
          const startShake = visualReachIntensity >= 3 ? "violent" : visualReachIntensity >= 2 ? "medium" : "small";
          triggerShake(startShake);
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
        const commitShake = visualReachIntensity >= 3 ? "violent" : "medium";
        triggerShake(commitShake);
      }

      bingoAnnounceSeqRef.current += 1;
      const announceSeq = bingoAnnounceSeqRef.current;
      if (bingoAnnounceNameTimerRef.current) window.clearTimeout(bingoAnnounceNameTimerRef.current);
      if (bingoAnnounceStepTimerRef.current) window.clearTimeout(bingoAnnounceStepTimerRef.current);
      if (bingoAnnounceHideTimerRef.current) window.clearTimeout(bingoAnnounceHideTimerRef.current);
      bingoAnnounceNameTimerRef.current = null;
      bingoAnnounceStepTimerRef.current = null;
      bingoAnnounceHideTimerRef.current = null;
      const newBingoNames = Array.isArray(lastEvent.newBingoNames)
        ? lastEvent.newBingoNames.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        : [];
      if (newBingoNames.length > 0) {
        const key = Date.now();
        const startedAt = key;
        const pageSize = computeJackpotPageSize();
        const pageTotal = Math.max(1, Math.ceil(newBingoNames.length / pageSize));
        const minVisibleMs = computeJackpotMinVisibleMs(newBingoNames.length);

        const pageCount = (pageIndex: number) => Math.max(0, Math.min(pageSize, newBingoNames.length - pageIndex * pageSize));

        // VJ-Level FX (disabled in safe/reduced-motion mode)
        triggerShake("violent");
        if (fxActive && !safeMode) {
          setGlitch(true);
          if (glitchTimerRef.current) window.clearTimeout(glitchTimerRef.current);
          glitchTimerRef.current = window.setTimeout(() => setGlitch(false), 1200);
          setStrobe(true);
          if (strobeTimerRef.current) window.clearTimeout(strobeTimerRef.current);
          strobeTimerRef.current = window.setTimeout(() => setStrobe(false), 2000);
        }

        const pageHoldMs = safeMode ? 1800 : 900;
        const endHoldMs = safeMode ? 1100 : 3200;

        if (safeMode) {
          // No staged reveal in safe mode: show per-page instantly, then flip pages.
          setBingoAnnounce({
            key,
            names: newBingoNames,
            showNames: true,
            pageIndex: 0,
            shownCount: pageCount(0),
            pageSize,
          });

          if (pageTotal > 1) {
            let nextPage = 1;
            const flip = () => {
              if (bingoAnnounceSeqRef.current !== announceSeq) return;
              if (nextPage >= pageTotal) return;
              setBingoAnnounce({
                key,
                names: newBingoNames,
                showNames: true,
                pageIndex: nextPage,
                shownCount: pageCount(nextPage),
                pageSize,
              });
              nextPage += 1;
              bingoAnnounceStepTimerRef.current = window.setTimeout(flip, pageHoldMs);
            };
            bingoAnnounceStepTimerRef.current = window.setTimeout(flip, pageHoldMs);
          }

          const minDurationMs = 2200;
          const hideAfterMs = Math.max(minDurationMs, pageTotal * pageHoldMs + endHoldMs, minVisibleMs);
          bingoAnnounceHideTimerRef.current = window.setTimeout(() => {
            if (bingoAnnounceSeqRef.current !== announceSeq) return;
            setBingoAnnounce(null);
          }, hideAfterMs);
        } else {
          // Normal mode: reveal winners one-by-one, growing the list downward.
          const revealDelayMs = randomIntInclusive(250, 650);
          const stepMs = computeJackpotStepMs(newBingoNames.length);

          let pageIndex = 0;
          let shownCount = 0;

          const scheduleHide = () => {
            if (bingoAnnounceHideTimerRef.current) window.clearTimeout(bingoAnnounceHideTimerRef.current);
            const elapsedMs = Date.now() - startedAt;
            const remainingForSfxMs = minVisibleMs > 0 ? Math.max(0, minVisibleMs - elapsedMs) : 0;
            const delayMs = Math.max(endHoldMs, remainingForSfxMs);
            bingoAnnounceHideTimerRef.current = window.setTimeout(() => {
              if (bingoAnnounceSeqRef.current !== announceSeq) return;
              setBingoAnnounce(null);
            }, delayMs);
          };

          const step = () => {
            if (bingoAnnounceSeqRef.current !== announceSeq) return;
            const currentPageCount = pageCount(pageIndex);
            if (currentPageCount <= 0) {
              setBingoAnnounce(null);
              return;
            }

            if (shownCount < currentPageCount) {
              shownCount += 1;
              setBingoAnnounce({
                key,
                names: newBingoNames,
                showNames: true,
                pageIndex,
                shownCount,
                pageSize,
              });
              if (shownCount < currentPageCount) {
                bingoAnnounceStepTimerRef.current = window.setTimeout(step, stepMs);
              } else if (pageIndex + 1 < pageTotal) {
                bingoAnnounceStepTimerRef.current = window.setTimeout(() => {
                  if (bingoAnnounceSeqRef.current !== announceSeq) return;
                  pageIndex += 1;
                  shownCount = 0;
                  step();
                }, pageHoldMs);
              } else {
                scheduleHide();
              }
              return;
            }

            if (pageIndex + 1 < pageTotal) {
              bingoAnnounceStepTimerRef.current = window.setTimeout(() => {
                if (bingoAnnounceSeqRef.current !== announceSeq) return;
                pageIndex += 1;
                shownCount = 0;
                step();
              }, pageHoldMs);
              return;
            }

            scheduleHide();
          };

          // Create the announce container immediately (so JACKPOT text appears), but reveal names after delay.
          setBingoAnnounce({
            key,
            names: newBingoNames,
            showNames: false,
            pageIndex: 0,
            shownCount: 0,
            pageSize,
          });

          bingoAnnounceNameTimerRef.current = window.setTimeout(() => {
            if (bingoAnnounceSeqRef.current !== announceSeq) return;
            step();
          }, revealDelayMs);
        }
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
  }, [lastEvent, fxActive, fxEnabled, safeMode, visualReachIntensity]);

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
  }, [view?.reel?.status, view?.reel?.digit, connected, spinIntervalMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (goPulseTimerRef.current) window.clearTimeout(goPulseTimerRef.current);
      if (confirmedPulseTimerRef.current) window.clearTimeout(confirmedPulseTimerRef.current);
      if (readableBoostTimerRef.current) window.clearTimeout(readableBoostTimerRef.current);
      if (bingoFxTimerRef.current) window.clearTimeout(bingoFxTimerRef.current);
      if (bingoAnnounceNameTimerRef.current) window.clearTimeout(bingoAnnounceNameTimerRef.current);
      if (bingoAnnounceStepTimerRef.current) window.clearTimeout(bingoAnnounceStepTimerRef.current);
      if (bingoAnnounceHideTimerRef.current) window.clearTimeout(bingoAnnounceHideTimerRef.current);
      if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current);
      if (glitchTimerRef.current) window.clearTimeout(glitchTimerRef.current);
      if (strobeTimerRef.current) window.clearTimeout(strobeTimerRef.current);
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
    const next = view?.reel?.status ?? null;
    if (prev === "spinning" && next === "stopped") {
      setPopDigit(true);
      if (popTimerRef.current) window.clearTimeout(popTimerRef.current);
      popTimerRef.current = window.setTimeout(() => setPopDigit(false), 420);
    }
    prevReelStatusRef.current = next;
    return () => {
      if (popTimerRef.current) window.clearTimeout(popTimerRef.current);
    };
  }, [view?.reel?.status]);

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
  const stats = view?.stats ?? null;
  const minMissing = stats?.minMissingHistogram ?? null;
  const statBingo = minMissing?.["0"] ?? stats?.bingoPlayers ?? 0;
  const statOneAway = minMissing?.["1"] ?? stats?.reachPlayers ?? 0;
  const statTwoAway = minMissing?.["2"] ?? 0;
  const statThreePlus = minMissing?.["3plus"] ?? 0;

  const renderStatsCard = (key: string) => (
    <div
      key={key}
      className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_12px_rgba(0,0,0,0.55)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-pit-text-muted tracking-[0.22em]">STATS</div>
        <div className="text-xs text-pit-text-dim">
          DRAW <span className="font-mono text-pit-primary">{view?.drawCount ?? 0}</span>/75
        </div>
      </div>

      {/* Podium */}
      <div className="mt-4 flex items-end justify-center gap-3">
        <div className="w-[30%]">
          <div className="mb-1 text-center text-[0.65rem] text-pit-text-dim tracking-[0.18em]">1 AWAY</div>
          <div className="flex h-[max(10rem,20vh)] items-end justify-center border border-pit-border bg-black/40 px-2 pb-3">
            <div className="text-center">
              <div className="text-[min(6.2vw,5.2rem)] font-black tabular-nums text-pit-primary drop-shadow-[0_0_18px_rgba(234,179,8,0.55)]">
                {statOneAway}
              </div>
            </div>
          </div>
        </div>
        <div className="w-[34%]">
          <div className="mb-1 text-center text-[0.65rem] text-pit-text-dim tracking-[0.18em]">BINGO</div>
          <div className="flex h-[max(12rem,24vh)] items-end justify-center border border-pit-primary/60 bg-black/50 px-2 pb-3 shadow-[0_0_22px_rgba(234,179,8,0.2)]">
            <div className="text-center">
              <div className="text-[min(6.8vw,5.8rem)] font-black tabular-nums text-pit-primary drop-shadow-[0_0_24px_rgba(234,179,8,0.75)]">
                {statBingo}
              </div>
            </div>
          </div>
        </div>
        <div className="w-[30%]">
          <div className="mb-1 text-center text-[0.65rem] text-pit-text-dim tracking-[0.18em]">2 AWAY</div>
          <div className="flex h-[max(9rem,18vh)] items-end justify-center border border-pit-border bg-black/35 px-2 pb-3">
            <div className="text-center">
              <div className="text-[min(5.5vw,4.6rem)] font-black tabular-nums text-pit-text-main drop-shadow-[0_0_16px_rgba(255,255,255,0.25)]">
                {statTwoAway}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-pit-border/60 pt-3 text-sm text-pit-text-dim">
        <div className="tracking-[0.18em]">3+ AWAY</div>
        <div className="font-mono text-[min(4.2vw,3.2rem)] font-black tabular-nums text-pit-text-main">{statThreePlus}</div>
      </div>
    </div>
  );

  const sideCards: ReactNode[] = sidePlayers.map((p, idx) => {
    if (!p) return renderStatsCard(`stats:${idx}`);

    return (
      <div key={`spotlight:${idx}`} className="rounded-none border border-pit-border bg-pit-surface/80 p-4 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-lg font-bold text-pit-text-main text-glow">{p.displayName}</div>
          {p.progress.isBingo && (
            <Badge variant="success" className="shrink-0">
              BINGO
            </Badge>
          )}
        </div>
        <div className="mt-3 flex items-start gap-4">
          {p.card ? (
            <BingoCard
              variant="compact"
              card={p.card}
              drawnNumbers={drawnNumbers}
              showHeaders={false}
              className="w-full max-w-[min(24vh,260px)] shrink-0"
            />
          ) : (
            <div className="w-full max-w-[min(24vh,260px)] border border-pit-border bg-black/40 p-4 text-xs text-pit-text-dim">
              NO CARD DATA
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-3 gap-3">
              <div className="border border-pit-border bg-black/35 px-3 py-2">
                <div className="text-[0.65rem] font-semibold tracking-[0.28em] text-pit-text-dim">NEED</div>
                <div className="mt-1 text-[min(6vw,4rem)] font-black tabular-nums text-pit-text-main">{p.progress.minMissingToLine}</div>
              </div>
              <div className="border border-pit-border bg-black/35 px-3 py-2">
                <div className="text-[0.65rem] font-semibold tracking-[0.28em] text-pit-text-dim">REACH</div>
                <div className="mt-1 text-[min(6vw,4rem)] font-black tabular-nums text-pit-text-main">{p.progress.reachLines}</div>
              </div>
              <div className="border border-pit-border bg-black/35 px-3 py-2">
                <div className="text-[0.65rem] font-semibold tracking-[0.28em] text-pit-text-dim">LINES</div>
                <div className="mt-1 text-[min(6vw,4rem)] font-black tabular-nums text-pit-text-main">{p.progress.bingoLines}</div>
              </div>
            </div>

            <div className="mt-3 text-xs text-pit-text-dim">{p.progress.isBingo ? "STATUS: BINGO" : "STATUS: ACTIVE"}</div>
          </div>
        </div>
      </div>
    );
  });

  const shakeClass = shake === "small" ? "shake-small" : shake === "medium" ? "shake-medium" : shake === "violent" ? "shake-violent" : "";
  const glitchClass = glitch ? "glitch-active" : "";
  const strobeClass = strobe ? "strobe-active" : "";
  const jackpot = useMemo(() => {
    if (!bingoAnnounce) return null;
    const pageSize = Math.max(1, bingoAnnounce.pageSize);
    const totalPages = Math.max(1, Math.ceil(bingoAnnounce.names.length / pageSize));
    const pageIndex = clampInt(bingoAnnounce.pageIndex, 0, totalPages - 1);
    const start = pageIndex * pageSize;
    const pageNames = bingoAnnounce.names.slice(start, start + pageSize);
    const shownCount = clampInt(bingoAnnounce.shownCount, 0, pageNames.length);
    const shown = bingoAnnounce.showNames ? pageNames.slice(0, shownCount) : [];
    return { totalPages, pageIndex, shown, totalWinners: bingoAnnounce.names.length };
  }, [bingoAnnounce]);

  return (
    <div className="crt-stage bg-black">
    <main
      className={cn(
        "relative min-h-dvh overflow-hidden text-pit-text-main font-mono bg-pit-bg crt-monitor",
      )}
    >
      <div className={cn("crt-overlay", fxActive && !safeMode && "crt-overlay-flicker")} />

      {/* Juice Container */}
      <div className={cn("relative z-10 size-full transition-transform", shakeClass)}>

      {fxActive && (
        <>
          {tensionTheme !== "calm" && (
            <div
              className={cn(
                "pointer-events-none fixed inset-0 z-0",
                tensionTheme === "yellow" && "bg-[radial-gradient(circle_at_center,rgba(234,179,8,0.14),rgba(0,0,0,0)_70%)]",
                tensionTheme === "red" && "bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.16),rgba(0,0,0,0)_70%)]",
                tensionTheme === "rainbow" && "rainbow-overlay rainbow-pan opacity-[0.14] mix-blend-screen",
              )}
            />
          )}
          {/* Vignette & texture (in addition to CRT) */}
          <div className={cn("pointer-events-none fixed inset-0 z-0 bg-noise [background-size:180px_180px]", noiseOpacityClass, noiseAnimClass)} />
          {/* Strobe Layer */}
          <div className={cn("pointer-events-none fixed inset-0 z-[5] mix-blend-overlay", strobeClass)} />
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
          <div className={cn("pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-8", glitchClass)}>
            <div
              className={cn(
                "border px-8 py-6 text-center backdrop-blur-sm",
                "border-pit-primary bg-black/80 text-pit-primary",
                safeMode ? "shadow-[0_0_40px_rgba(234,179,8,0.12)]" : "shadow-[0_0_100px_rgba(234,179,8,0.4)] box-glow",
              )}
	            >
	              <div
	                className={cn(
	                  "text-[min(26vw,26vh)] font-black leading-none tracking-tighter text-pit-primary drop-shadow-[0_0_24px_rgba(234,179,8,0.6)]",
	                  !safeMode && "animate-pulse",
	                )}
	              >
	                JACKPOT!
	              </div>
	              {jackpot && (
	                <div className="mt-6 w-full max-w-[min(88vw,1100px)]">
	                  <div className="flex items-center justify-between gap-4 border-t border-pit-border/60 pt-4 text-xs font-semibold tracking-[0.42em] text-pit-text-dim">
	                    <div>WINNERS</div>
	                    <div className="font-mono tracking-[0.22em]">
	                      TOTAL {jackpot.totalWinners}
	                      {jackpot.totalPages > 1 ? ` :: PAGE ${jackpot.pageIndex + 1}/${jackpot.totalPages}` : ""}
	                    </div>
	                  </div>
	
	                  {jackpot.shown.length > 0 ? (
	                    <div className="mt-4 flex flex-col items-center gap-2">
	                      {jackpot.shown.map((name, idx) => (
	                        <div
	                          key={`${jackpot.pageIndex}:${idx}:${name}`}
	                          className="w-full max-w-[84vw] truncate text-center text-[min(6vw,3.6rem)] font-black leading-[1.05] text-white text-glow"
	                        >
	                          {name}
	                        </div>
	                      ))}
	                    </div>
	                  ) : (
	                    <div className="mt-4 text-xs font-semibold tracking-[0.5em] text-pit-text-dim">LOCKING IN...</div>
	                  )}
	                </div>
	              )}
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

      {fxEnabled && connected && drawSpinning && typeof reachCount === "number" && (
        <div
          className={cn(
            "fixed right-4 top-4 z-50 border bg-pit-bg/90 px-4 py-2 text-xs font-bold animate-pulse",
            tensionTheme === "calm" && "border-pit-border text-pit-text-main shadow-[0_0_10px_rgba(255,255,255,0.12)]",
            tensionTheme === "yellow" && "border-pit-primary text-pit-primary shadow-[0_0_12px_rgba(234,179,8,0.45)]",
            tensionTheme === "red" && "border-pit-danger text-pit-danger shadow-[0_0_12px_rgba(239,68,68,0.55)]",
            tensionTheme === "rainbow" && "border-pit-primary shadow-[0_0_14px_rgba(255,255,255,0.18)]",
          )}
        >
          {tensionTheme === "rainbow" ? (
            <span className="rainbow-text rainbow-pan">REACH_ALERT :: {reachCount}</span>
          ) : (
            <>REACH_ALERT :: {reachCount}</>
          )}
        </div>
      )}

		      <div
		        className={cn(
		          "relative z-20 grid grid-cols-1 gap-4 px-6 pb-4 pt-16 lg:h-dvh lg:items-stretch",
		          screen === "ten"
		            ? "lg:grid-cols-[minmax(0,min(44vw,840px))_1fr]"
		            : "lg:grid-cols-[1fr_minmax(0,min(44vw,840px))]",
		        )}
		      >
		        {/* Spotlight (outer side) */}
		        {screen === "ten" && <aside className="relative z-30 grid min-h-0 gap-3 lg:order-1">{sideCards}</aside>}

	        {/* Center: reel */}
	        <div className={cn("flex min-h-0 items-center justify-center lg:order-2", screen === "ten" ? "lg:justify-end" : "lg:justify-start")}>
	          <div className={cn("text-center", screen === "ten" ? "lg:text-right" : "lg:text-left")}>
	            <div className={cn("relative inline-flex items-center justify-center", fxActive && popDigit && !safeMode && "animate-[clover-clunk_420ms_ease-out]")}>
				                <div
				                  className={cn(
				                    "relative isolate overflow-hidden border max-w-full w-[min(96vw,100vh)] py-[clamp(8px,0.9vw,18px)] px-[clamp(12px,2.6vw,56px)]",
				                    "border-pit-border bg-black shadow-[0_0_100px_rgba(0,0,0,1)]",
				                    fxActive && !safeMode && !drawSpinning && "animate-[clover-breath_4.8s_ease-in-out_infinite]",
				                    drawSpinning && tensionTheme === "calm" && "border-pit-text-dim/50 shadow-[0_0_120px_rgba(255,255,255,0.12)]",
				                    drawSpinning && tensionTheme === "yellow" && "border-pit-primary/60 shadow-[0_0_180px_rgba(234,179,8,0.32)]",
			                    drawSpinning && tensionTheme === "red" && "border-pit-danger/70 shadow-[0_0_210px_rgba(239,68,68,0.36)]",
		                    drawSpinning && tensionTheme === "rainbow" && "border-pit-primary/70 rainbow-glow",
	                    drawSpinning && isLastSpinning && tensionTheme === "calm" && "border-pit-text-dim/60 shadow-[0_0_160px_rgba(255,255,255,0.16)]",
	                    drawSpinning && isLastSpinning && tensionTheme === "yellow" && "border-pit-primary/70 shadow-[0_0_240px_rgba(234,179,8,0.38)]",
	                    drawSpinning && isLastSpinning && tensionTheme === "red" && "border-pit-danger/80 shadow-[0_0_280px_rgba(239,68,68,0.42)]",
	                    drawSpinning && isLastSpinning && tensionTheme === "rainbow" && "shadow-[0_0_320px_rgba(255,255,255,0.18)]",
	                    readableBoost && "bg-black/90",
	                  )}
	                >
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)50%,rgba(0,0,0,0.25)50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] opacity-20" />
                
	                {goPulse && fxActive && !safeMode && (
	                  <div
	                    className={cn(
	                      "pointer-events-none absolute inset-0 animate-[clover-go_560ms_ease-out] border-4",
	                      tensionTheme === "red" ? "border-pit-danger" : tensionTheme === "calm" ? "border-pit-text-muted" : "border-pit-primary",
	                    )}
	                  />
	                )}
                {confirmedPulse && fxActive && !safeMode && (
                  <div className="pointer-events-none absolute inset-0 animate-[clover-confirm_180ms_ease-out] border-4 border-emerald-500" />
                )}

				                <div
				                  className={cn(
				                    "relative z-10 font-black tabular-nums tracking-tight font-header scale-x-110 text-center",
				                    "text-[min(56vw,78vh)] leading-none",
				                    drawSpinning && tensionTheme === "calm" && "text-pit-text-main drop-shadow-[0_0_18px_rgba(255,255,255,0.45)]",
				                    drawSpinning && tensionTheme === "yellow" && "text-pit-primary drop-shadow-[0_0_22px_rgba(234,179,8,0.85)]",
				                    drawSpinning && tensionTheme === "red" && "text-pit-danger drop-shadow-[0_0_28px_rgba(239,68,68,0.85)]",
			                    drawSpinning && tensionTheme === "rainbow" && "rainbow-text rainbow-pan drop-shadow-[0_0_24px_rgba(255,255,255,0.25)]",
			                    !drawSpinning && "text-pit-text-main drop-shadow-[0_0_20px_rgba(255,255,255,0.4)]",
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
		            {view?.sessionStatus === "ended" && (
		              <div className="mt-4 border border-pit-danger bg-pit-danger/10 p-3 text-sm text-pit-danger font-bold tracking-widest">
		                SESSION_TERMINATED
	              </div>
	            )}
		          </div>
		        </div>
			        {screen === "one" && <aside className="relative z-30 grid min-h-0 gap-3 lg:order-3">{sideCards}</aside>}
	      </div>
	      </div>
	    </main>
	    </div>
	  );
}
