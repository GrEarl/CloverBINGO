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
  if (sec < 10) return "いま";
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  return `${hr}時間前`;
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
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
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

      <div className="grid min-h-dvh grid-cols-1 gap-6 px-6 pb-10 pt-20 lg:grid-cols-[minmax(0,340px)_1fr_minmax(0,340px)] lg:items-stretch">
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
            <div
              className={[
                "font-black tabular-nums tracking-tight",
                "text-[42vw] leading-none md:text-[26vw]",
                view?.reel.status === "spinning" ? "text-amber-200 drop-shadow-[0_0_60px_rgba(251,191,36,0.25)]" : "text-neutral-50",
                popDigit && "animate-[clover-pop_420ms_ease-out]",
              ].join(" ")}
            >
              {shownDigit ?? "—"}
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
