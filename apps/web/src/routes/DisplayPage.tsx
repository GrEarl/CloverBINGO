import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";

import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import WsStatusPill from "../components/ui/WsStatusPill";
import { cn } from "../lib/cn";
import { useSessionSocket, type DisplayScreen, type DisplaySnapshot } from "../lib/useSessionSocket";

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

export default function DisplayPage() {
  const params = useParams();
  const code = params.code ?? "";
  const screen = safeScreen(params.screen);

  const { snapshot, status } = useSessionSocket({ role: "display", code, screen: screen ?? "ten" });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as DisplaySnapshot).role !== "display") return null;
    return snapshot as DisplaySnapshot;
  }, [snapshot]);

  const [shownDigit, setShownDigit] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const hideOverlayTimerRef = useRef<number | null>(null);
  const prevReelStatusRef = useRef<string | null>(null);
  const [popDigit, setPopDigit] = useState(false);
  const popTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!view) return;
    const reelStatus = view.reel.status;
    if (reelStatus === "spinning") {
      if (timerRef.current) return;
      timerRef.current = window.setInterval(() => {
        setShownDigit(Math.floor(Math.random() * 10));
      }, 45);
      return;
    }

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setShownDigit(view.reel.digit);
  }, [view?.reel.status, view?.reel.digit]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
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
          <h1 className="text-xl font-bold uppercase tracking-widest text-pit-primary">Display Terminal</h1>
          <p className="mt-2 text-sm text-pit-text-dim">Append /ten or /one to URL to initialize terminal.</p>
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
        <div key={`spotlight:${i}`} className="group relative overflow-hidden border-2 border-pit-border bg-pit-surface p-4 shadow-lg transition-all">
          <div className="absolute right-0 top-0 h-4 w-4 border-l-2 border-b-2 border-pit-border bg-pit-bg" />
          <div className="absolute left-0 bottom-0 h-4 w-4 border-r-2 border-t-2 border-pit-border bg-pit-bg" />
          
          <div className="flex items-center justify-between gap-3 border-b border-pit-border pb-2 mb-2">
            <div className="truncate font-mono text-lg font-bold text-pit-primary uppercase tracking-wider">{p.displayName}</div>
            {p.progress.isBingo && <Badge variant="success" className="animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]">BINGO</Badge>}
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono text-xs">
            <div className="bg-pit-bg border border-pit-border p-2 text-center">
              <div className="text-[0.6rem] text-pit-text-muted uppercase">min</div>
              <div className="mt-1 text-base text-pit-text-main font-bold">{p.progress.minMissingToLine}</div>
            </div>
            <div className="bg-pit-bg border border-pit-border p-2 text-center">
              <div className="text-[0.6rem] text-pit-text-muted uppercase">reach</div>
              <div className="mt-1 text-base text-pit-text-main font-bold">{p.progress.reachLines}</div>
            </div>
            <div className="bg-pit-bg border border-pit-border p-2 text-center">
              <div className="text-[0.6rem] text-pit-text-muted uppercase">lines</div>
              <div className="mt-1 text-base text-pit-text-main font-bold">{p.progress.bingoLines}</div>
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
        <div key={`stats-detail:${i}`} className="relative border border-dashed border-pit-text-muted/30 bg-pit-bg/50 p-4 opacity-70">
          <div className="text-xs font-bold uppercase tracking-widest text-pit-text-muted mb-2 border-b border-pit-text-muted/30 pb-1">Probability_Analysis</div>
          <div className="grid gap-1 font-mono text-sm text-pit-text-dim">
            <div className="flex justify-between">
              <span>0-MISS:</span> <span className="text-pit-text-main">{view?.stats?.minMissingHistogram?.["0"] ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>1-MISS:</span> <span className="text-pit-text-main">{view?.stats?.minMissingHistogram?.["1"] ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>2-MISS:</span> <span className="text-pit-text-main">{view?.stats?.minMissingHistogram?.["2"] ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>3+MISS:</span> <span className="text-pit-text-main">{view?.stats?.minMissingHistogram?.["3plus"] ?? "—"}</span>
            </div>
          </div>
        </div>,
      );
      continue;
    }

    if (rank === 1) {
      sideCards.push(
        <div key={`recent:${i}`} className="relative border border-dashed border-pit-text-muted/30 bg-pit-bg/50 p-4 opacity-70">
          <div className="text-xs font-bold uppercase tracking-widest text-pit-text-muted mb-2 border-b border-pit-text-muted/30 pb-1">Log_Buffer</div>
          <div className="flex flex-wrap gap-2">
            {(view?.lastNumbers ?? []).slice().reverse().slice(0, 8).map((n, idx) => (
              <div key={idx} className="flex h-8 w-8 items-center justify-center rounded-sm border border-pit-border bg-pit-surface text-sm font-mono font-bold text-pit-text-dim">
                {n}
              </div>
            ))}
            {!view?.lastNumbers?.length && <div className="text-sm text-pit-text-muted font-mono">NO_DATA</div>}
          </div>
        </div>,
      );
      continue;
    }

    sideCards.push(
      <div key={`stats-core:${i}`} className="relative border border-dashed border-pit-text-muted/30 bg-pit-bg/50 p-4 opacity-70">
        <div className="text-xs font-bold uppercase tracking-widest text-pit-text-muted mb-2 border-b border-pit-text-muted/30 pb-1">Core_Stats</div>
        <div className="grid gap-2 font-mono text-sm text-pit-text-dim">
          <div className="flex justify-between">
            <span>DRAW:</span> <span className="text-pit-text-main">{view?.drawCount ?? "—"} <span className="text-pit-text-muted">/ 75</span></span>
          </div>
          <div className="flex justify-between">
            <span>REACH:</span> <span className="text-pit-text-main">{view?.stats?.reachPlayers ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>BINGO:</span> <span className="text-pit-text-main">{view?.stats?.bingoPlayers ?? "—"}</span>
          </div>
        </div>
      </div>,
    );
  }

  return (
    <main className="min-h-dvh bg-pit-bg bg-noise text-pit-text-main font-mono selection:bg-pit-primary selection:text-pit-bg">
      {/* Overlay UI */}
      <div
        className={cn(
          "fixed left-4 top-4 z-50 flex items-center gap-2 transition-opacity duration-300",
          overlayVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex items-center gap-2 border border-pit-border bg-pit-bg/80 backdrop-blur-sm px-3 py-1 text-xs text-pit-text-dim shadow-lg">
          <div className="h-2 w-2 rounded-full bg-pit-primary animate-pulse" />
          <span className="font-bold text-pit-primary tracking-wider">{code}</span>
          <span className="text-pit-text-muted">::</span>
          <span className="font-bold tracking-wider">{screen}</span>
        </div>
        <WsStatusPill status={status} />
        <Button onClick={goFullscreen} size="sm" variant="secondary" className="border-pit-border bg-pit-surface hover:bg-pit-border text-xs uppercase tracking-wider">
          Full_Scr
        </Button>
      </div>

      {status !== "connected" && (
        <div className="fixed bottom-4 left-4 z-50">
          <WsStatusPill status={status} className="px-4 py-2 text-sm shadow-xl border border-pit-danger bg-pit-bg" />
        </div>
      )}

      {/* Main Grid */}
      <div className="grid min-h-dvh grid-cols-1 gap-6 px-6 pb-10 pt-20 lg:grid-cols-[minmax(0,340px)_1fr_minmax(0,340px)] lg:items-stretch">
        
        {/* Left Column */}
        {screen === "ten" ? (
          <aside className="grid gap-4 content-start lg:order-1">
            {sideCards}
          </aside>
        ) : (
          <aside className="grid gap-4 content-start lg:order-1">
            <div className="border-2 border-pit-border bg-pit-surface p-4">
               <div className="text-xs font-bold uppercase tracking-widest text-pit-text-muted mb-2 border-b border-pit-border pb-1">Core_Stats</div>
              <div className="grid gap-2 font-mono text-sm text-pit-text-dim">
                <div className="flex justify-between">
                  <span>DRAW:</span> <span className="text-pit-text-main font-bold">{view?.drawCount ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>REACH:</span> <span className="text-pit-text-main font-bold">{view?.stats?.reachPlayers ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>BINGO:</span> <span className="text-pit-text-main font-bold text-pit-primary">{view?.stats?.bingoPlayers ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className="border-2 border-pit-border bg-pit-surface p-4">
               <div className="text-xs font-bold uppercase tracking-widest text-pit-text-muted mb-2 border-b border-pit-border pb-1">Log_Buffer</div>
              <div className="flex flex-wrap gap-2">
                {(view?.lastNumbers ?? []).slice().reverse().map((n, idx) => (
                  <div key={idx} className="flex h-8 w-8 items-center justify-center rounded-sm border border-pit-border bg-pit-bg text-sm font-mono font-bold text-pit-text-dim">
                    {n}
                  </div>
                ))}
                {!view?.lastNumbers?.length && <div className="text-sm text-pit-text-muted font-mono">NO_DATA</div>}
              </div>
            </div>

            <div className="border-2 border-pit-border bg-pit-surface p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-pit-text-muted mb-2 border-b border-pit-border pb-1">Spotlight_Control</div>
              <div className="text-xs text-pit-text-dim mb-2 font-mono">
                VER: {fmtNum(view?.spotlight?.version)}<br/>
                OP: {view?.spotlight?.updatedBy ?? "—"}<br/>
                UPD: {view?.spotlight?.updatedAt ? relativeFromNow(view.spotlight.updatedAt) : "—"}
              </div>
              <div className="grid gap-2">
                {sidePlayers.map((p, idx) => (
                  <div key={idx} className="border border-pit-border bg-pit-bg/50 px-3 py-2 text-sm font-mono text-pit-text-main truncate">
                    {p?.displayName ?? "— EMPTY —"}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Center: The Reel */}
        <div className="flex flex-col items-center justify-center lg:order-2">
          
          {/* Machine Header */}
          <div className="mb-8 w-full max-w-lg border-b-2 border-pit-border pb-4 text-center">
             <div className="text-xs font-bold uppercase tracking-[0.3em] text-pit-text-muted">Current_Draw</div>
          </div>

          <div className="relative">
            {/* Reel Frame */}
            <div className="absolute -inset-4 rounded-3xl border-4 border-pit-border bg-pit-wall shadow-[inset_0_0_40px_rgba(0,0,0,0.8)]" />
            
            {/* Reel Window */}
            <div className="relative overflow-hidden rounded-xl border-2 border-black bg-[#050505] px-12 py-8 shadow-[inset_0_0_20px_rgba(0,0,0,1)]">
              <div
                className={[
                  "font-mono font-black tabular-nums tracking-tighter",
                  "text-[35vw] leading-none md:text-[22vw]",
                  view?.reel.status === "spinning" 
                    ? "text-pit-primary blur-[2px] animate-pulse drop-shadow-[0_0_30px_rgba(234,179,8,0.4)]" 
                    : "text-pit-text-main drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]",
                  popDigit && "animate-[clover-pop_420ms_ease-out]",
                ].join(" ")}
              >
                {shownDigit ?? "—"}
              </div>
              
              {/* Scanlines Overlay */}
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,6px_100%] bg-repeat z-10 opacity-20" />
            </div>

            {/* Status Indicator */}
            <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 whitespace-nowrap">
               <div className="flex items-center gap-3 rounded-full border border-pit-border bg-pit-bg px-4 py-1 text-xs uppercase tracking-widest text-pit-text-muted">
                 <div className={cn("h-2 w-2 rounded-full transition-colors", view?.reel.status === "spinning" ? "bg-pit-primary shadow-[0_0_8px_#eab308]" : "bg-pit-text-muted")} />
                 <span>{view?.reel.status ?? "IDLE"}</span>
                 <span className="text-pit-border">|</span>
                 <span>LAST: <span className="text-pit-text-main font-bold">{view?.lastNumber ?? "—"}</span></span>
               </div>
            </div>
          </div>

          {view?.sessionStatus === "ended" && (
            <div className="mt-20 border-2 border-pit-danger bg-pit-danger/10 p-4 text-center">
              <div className="text-xl font-bold uppercase tracking-widest text-pit-danger animate-pulse">Session Terminated</div>
            </div>
          )}
        </div>

        {/* Right Column */}
        {screen === "ten" ? (
          <aside className="grid gap-4 content-start lg:order-3">
             <div className="border-2 border-pit-border bg-pit-surface p-4">
               <div className="text-xs font-bold uppercase tracking-widest text-pit-text-muted mb-2 border-b border-pit-border pb-1">Core_Stats</div>
              <div className="grid gap-2 font-mono text-sm text-pit-text-dim">
                <div className="flex justify-between">
                  <span>DRAW:</span> <span className="text-pit-text-main font-bold">{view?.drawCount ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>REACH:</span> <span className="text-pit-text-main font-bold">{view?.stats?.reachPlayers ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>BINGO:</span> <span className="text-pit-text-main font-bold text-pit-primary">{view?.stats?.bingoPlayers ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className="border-2 border-pit-border bg-pit-surface p-4">
               <div className="text-xs font-bold uppercase tracking-widest text-pit-text-muted mb-2 border-b border-pit-border pb-1">Log_Buffer</div>
              <div className="flex flex-wrap gap-2">
                {(view?.lastNumbers ?? []).slice().reverse().map((n, idx) => (
                  <div key={idx} className="flex h-8 w-8 items-center justify-center rounded-sm border border-pit-border bg-pit-bg text-sm font-mono font-bold text-pit-text-dim">
                    {n}
                  </div>
                ))}
                {!view?.lastNumbers?.length && <div className="text-sm text-pit-text-muted font-mono">NO_DATA</div>}
              </div>
            </div>

            {emptySlots > 0 && (
              <div className="border-2 border-dashed border-pit-border bg-pit-bg/30 p-4 opacity-60">
                <div className="text-xs font-bold uppercase tracking-widest text-pit-text-muted mb-2">Probability_Model</div>
                <div className="grid gap-1 font-mono text-sm text-pit-text-dim">
                  <div className="flex justify-between"><span>0:</span> <span>{view?.stats?.minMissingHistogram?.["0"] ?? "-"}</span></div>
                  <div className="flex justify-between"><span>1:</span> <span>{view?.stats?.minMissingHistogram?.["1"] ?? "-"}</span></div>
                  <div className="flex justify-between"><span>2:</span> <span>{view?.stats?.minMissingHistogram?.["2"] ?? "-"}</span></div>
                </div>
              </div>
            )}
          </aside>
        ) : (
          <aside className="grid gap-4 content-start lg:order-3">
            {sideCards}
          </aside>
        )}
      </div>
    </main>
  );
}
