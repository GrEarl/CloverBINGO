import { useEffect, useMemo, useRef, useState } from "react";

import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import { cn } from "../lib/cn";

type ReachIntensity = 0 | 1 | 2 | 3;
type ReelStatus = "idle" | "spinning" | "stopped";

function randomIntInclusive(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function digitsOf(n: number): { ten: number; one: number } {
  const normalized = ((n % 100) + 100) % 100;
  return { ten: Math.floor(normalized / 10), one: normalized % 10 };
}

const DECODE_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+-=[]{}|;:,.<>?";

export default function ShowcasePage() {
  const [safeMode, setSafeMode] = useState(false);
  const [fxEnabled, setFxEnabled] = useState(true);
  const [intensity, setIntensity] = useState<ReachIntensity>(0);

  const [drawSpinning, setDrawSpinning] = useState(false);
  const [reel, setReel] = useState<{ ten: ReelStatus; one: ReelStatus }>({ ten: "idle", one: "idle" });
  const [digits, setDigits] = useState<{ ten: number | null; one: number | null }>({ ten: null, one: null });
  const [shown, setShown] = useState<{ ten: string | number | null; one: string | number | null }>({ ten: null, one: null });

  const [readableBoost, setReadableBoost] = useState(false);
  const readableBoostTimerRef = useRef<number | null>(null);
  const [glitch, setGlitch] = useState(false);
  const [strobe, setStrobe] = useState(false);

  const [bingoOverlay, setBingoOverlay] = useState<{ key: number; names: string[]; showNames: boolean } | null>(null);
  const bingoNameTimerRef = useRef<number | null>(null);
  const bingoHideTimerRef = useRef<number | null>(null);
  const bingoSeqRef = useRef(0);

  const isLastSpinning = (reel.ten === "spinning" && reel.one === "stopped") || (reel.one === "spinning" && reel.ten === "stopped");
  const spinIntervalMs = safeMode || !fxEnabled ? 90 : isLastSpinning ? 60 : 40;

  const fxActive = fxEnabled;
  const tensionTheme = drawSpinning ? (intensity === 3 ? "rainbow" : intensity === 2 ? "red" : intensity === 1 ? "yellow" : "calm") : "calm";

  const noiseOpacityClass = safeMode
    ? "opacity-[0.04]"
    : intensity === 3
      ? "opacity-[0.18]"
      : intensity === 2
        ? "opacity-[0.14]"
        : intensity === 1
          ? "opacity-[0.1]"
          : "opacity-[0.08]";
  const noiseAnimClass =
    safeMode || !drawSpinning || !fxActive
      ? ""
      : intensity === 3
        ? "animate-[clover-noise_3.2s_linear_infinite]"
        : intensity === 2
          ? "animate-[clover-noise_5s_linear_infinite]"
          : intensity === 1
            ? "animate-[clover-noise_7s_linear_infinite]"
            : "animate-[clover-noise_8s_linear_infinite]";

  const [nextNumber, setNextNumber] = useState("42");
  const [bingoNames, setBingoNames] = useState("ALICE,BOB");

  useEffect(() => {
    if (!drawSpinning) return;
    if (reel.ten !== "spinning" && reel.one !== "spinning") return;

    const t = window.setInterval(() => {
      setShown((prev) => {
        const next: typeof prev = { ...prev };
        if (reel.ten === "spinning") next.ten = DECODE_CHARS[Math.floor(Math.random() * DECODE_CHARS.length)];
        if (reel.one === "spinning") next.one = DECODE_CHARS[Math.floor(Math.random() * DECODE_CHARS.length)];
        return next;
      });
    }, spinIntervalMs);
    return () => window.clearInterval(t);
  }, [drawSpinning, reel.ten, reel.one, spinIntervalMs]);

  useEffect(() => {
    return () => {
      if (readableBoostTimerRef.current) window.clearTimeout(readableBoostTimerRef.current);
      if (bingoNameTimerRef.current) window.clearTimeout(bingoNameTimerRef.current);
      if (bingoHideTimerRef.current) window.clearTimeout(bingoHideTimerRef.current);
    };
  }, []);

  function startSpin() {
    setDrawSpinning(true);
    setReel({ ten: "spinning", one: "spinning" });
    setDigits({ ten: null, one: null });
    setShown({ ten: DECODE_CHARS[Math.floor(Math.random() * DECODE_CHARS.length)], one: DECODE_CHARS[Math.floor(Math.random() * DECODE_CHARS.length)] });
  }

  function stopFromNumber() {
    const n = Number.parseInt(nextNumber, 10);
    if (!Number.isFinite(n)) return;
    const { ten, one } = digitsOf(n);
    setDigits({ ten, one });
    setShown({ ten, one });
    setReel({ ten: "stopped", one: "stopped" });
  }

  function commit(withBingo: boolean) {
    setDrawSpinning(false);
    setReel({ ten: "idle", one: "idle" });

    if (readableBoostTimerRef.current) window.clearTimeout(readableBoostTimerRef.current);
    setReadableBoost(true);
    readableBoostTimerRef.current = window.setTimeout(() => setReadableBoost(false), 900);

    if (!withBingo) return;

    bingoSeqRef.current += 1;
    const seq = bingoSeqRef.current;
    if (bingoNameTimerRef.current) window.clearTimeout(bingoNameTimerRef.current);
    if (bingoHideTimerRef.current) window.clearTimeout(bingoHideTimerRef.current);
    bingoNameTimerRef.current = null;
    bingoHideTimerRef.current = null;

    const names = bingoNames
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 8);
    if (!names.length) return;

    const key = Date.now();
    setBingoOverlay({ key, names, showNames: safeMode });

    if (fxActive && !safeMode) {
      setGlitch(true);
      window.setTimeout(() => setGlitch(false), 1200);
      setStrobe(true);
      window.setTimeout(() => setStrobe(false), 2000);
    }

    const revealDelayMs = safeMode ? 0 : randomIntInclusive(250, 650);
    bingoNameTimerRef.current = window.setTimeout(() => {
      if (bingoSeqRef.current !== seq) return;
      setBingoOverlay((prev) => (prev ? { ...prev, showNames: true } : prev));
    }, revealDelayMs);

    const hideAfterMs = safeMode ? 2200 : 3800;
    bingoHideTimerRef.current = window.setTimeout(() => {
      if (bingoSeqRef.current !== seq) return;
      setBingoOverlay(null);
    }, hideAfterMs);
  }

  function reset() {
    setDrawSpinning(false);
    setReel({ ten: "idle", one: "idle" });
    setDigits({ ten: null, one: null });
    setShown({ ten: null, one: null });
    setReadableBoost(false);
    setBingoOverlay(null);
    setGlitch(false);
    setStrobe(false);
  }

  const shownTen = reel.ten === "spinning" ? shown.ten : digits.ten;
  const shownOne = reel.one === "spinning" ? shown.one : digits.one;

  const reelFrameClass = useMemo(() => {
    const base = [
      "relative isolate overflow-hidden border p-[1.8vw]",
      "border-pit-border bg-black shadow-[0_0_100px_rgba(0,0,0,1)]",
      readableBoost && "bg-black/90",
      drawSpinning && tensionTheme === "calm" && "border-pit-text-dim/50 shadow-[0_0_120px_rgba(255,255,255,0.12)]",
      drawSpinning && tensionTheme === "yellow" && "border-pit-primary/60 shadow-[0_0_180px_rgba(234,179,8,0.32)]",
      drawSpinning && tensionTheme === "red" && "border-pit-danger/70 shadow-[0_0_210px_rgba(239,68,68,0.36)]",
      drawSpinning && tensionTheme === "rainbow" && "border-pit-primary/70 rainbow-glow",
    ]
      .filter(Boolean)
      .join(" ");
    return base;
  }, [drawSpinning, readableBoost, tensionTheme]);

  return (
    <main className="min-h-dvh bg-pit-bg text-pit-text-main font-mono">
      <div className={cn("crt-overlay", fxActive && !safeMode && "crt-overlay-flicker")} />
      <div className={cn("pointer-events-none fixed inset-0 z-[50] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),rgba(0,0,0,0.85))]")} />
      <div className={cn("pointer-events-none fixed inset-0 z-[60] bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22 viewBox=%220 0 120 120%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22120%22 height=%22120%22 filter=%22url(%23n)%22 opacity=%220.35%22/%3E%3C/svg%3E')] mix-blend-overlay", noiseOpacityClass, noiseAnimClass)} />

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">演出ショーケース</h1>
            <div className="mt-1 text-xs text-pit-text-dim">セッション不要。表示側の演出を手元で疑似再生します。</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setSafeMode((v) => !v)} size="sm" variant={safeMode ? "primary" : "secondary"}>
              safe={safeMode ? "1" : "0"}
            </Button>
            <Button onClick={() => setFxEnabled((v) => !v)} size="sm" variant={fxEnabled ? "primary" : "secondary"}>
              fx={fxEnabled ? "1" : "0"}
            </Button>
            <Button onClick={reset} size="sm" variant="secondary">
              RESET
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[420px_1fr] lg:items-start">
          <Card className="p-4">
            <div className="text-sm font-semibold">Controls</div>
            <div className="mt-3 grid gap-3">
              <div>
                <div className="text-xs text-neutral-400">白熱度（演出段階）</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[0, 1, 2, 3].map((v) => (
                    <Button key={v} onClick={() => setIntensity(v as ReachIntensity)} size="sm" variant={intensity === v ? "primary" : "secondary"}>
                      {v}
                    </Button>
                  ))}
                  <Badge variant="warning">theme: {tensionTheme}</Badge>
                </div>
              </div>

              <div className="grid gap-2">
                <div className="text-xs text-neutral-400">次番号（1..75）</div>
                <Input value={nextNumber} onChange={(e) => setNextNumber(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <div className="text-xs text-neutral-400">BINGO名（カンマ区切り）</div>
                <Input value={bingoNames} onChange={(e) => setBingoNames(e.target.value)} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={startSpin} variant="primary">
                  SPIN START
                </Button>
                <Button onClick={stopFromNumber} variant="secondary">
                  STOP（数字確定）
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => commit(false)} variant="secondary">
                  COMMIT
                </Button>
                <Button onClick={() => commit(true)} variant="primary">
                  COMMIT + BINGO
                </Button>
              </div>

              <div className="text-xs text-neutral-500">
                spinInterval: <span className="font-mono text-neutral-300">{spinIntervalMs}ms</span> / reel: ten={reel.ten}, one={reel.one}
              </div>
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            {(["ten", "one"] as const).map((screen) => (
              <div key={screen} className="relative">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm text-pit-text-dim">{screen.toUpperCase()}</div>
                  {drawSpinning ? <Badge variant="warning">SPINNING</Badge> : <Badge variant="neutral">IDLE</Badge>}
                </div>
                <div className={reelFrameClass}>
                  <div
                    className={cn(
                      "flex items-center justify-center text-[18vw] leading-none tracking-[-0.08em] font-black",
                      drawSpinning && tensionTheme === "yellow" && "text-pit-primary text-glow",
                      drawSpinning && tensionTheme === "red" && "text-pit-danger text-glow-danger",
                      drawSpinning && tensionTheme === "rainbow" && "rainbow-text rainbow-pan",
                      glitch && fxActive && !safeMode && "glitch-active",
                    )}
                  >
                    {screen === "ten" ? (shownTen ?? "—") : (shownOne ?? "—")}
                  </div>

                  {readableBoost && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                      <div className="rounded-none border border-pit-border bg-black/80 px-4 py-2 text-2xl font-black tracking-[0.2em] text-pit-primary">
                        LOCKED
                      </div>
                    </div>
                  )}

                  {bingoOverlay && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                      <div className={cn("w-[92%] border border-pit-primary bg-black/85 p-4 text-center", strobe && fxActive && !safeMode && "strobe-active")}>
                        <div className="text-3xl font-black tracking-[0.28em] text-pit-primary text-glow">JACKPOT!</div>
                        {bingoOverlay.showNames ? (
                          <div className="mt-3 grid gap-1 text-2xl font-black tracking-wide text-neutral-50">
                            {bingoOverlay.names.map((n, idx) => (
                              <div key={`${bingoOverlay.key}:${idx}`} className="truncate">
                                {n}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 text-sm text-neutral-400">…</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
