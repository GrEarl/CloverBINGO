import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { useSessionSocket, type DisplayScreen, type DisplaySnapshot } from "../lib/useSessionSocket";

function safeScreen(input: string | undefined): DisplayScreen | null {
  if (input === "ten" || input === "one") return input;
  return null;
}

export default function DisplayPage() {
  const params = useParams();
  const code = params.code ?? "";
  const screen = safeScreen(params.screen);

  const { snapshot, connected } = useSessionSocket({ role: "display", code, screen: screen ?? "ten" });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as DisplaySnapshot).role !== "display") return null;
    return snapshot as DisplaySnapshot;
  }, [snapshot]);

  const [shownDigit, setShownDigit] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!view) return;
    const status = view.reel.status;
    if (status === "spinning") {
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

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="fixed left-4 top-4 flex items-center gap-3">
        <div className="rounded-md border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-xs text-neutral-200">
          {code} / {screen} / {connected ? "WS ok" : "WS..."}
        </div>
        <button
          className="rounded-md border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-950/70"
          onClick={goFullscreen}
          type="button"
        >
          全画面
        </button>
      </div>

      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="text-center">
          <div
            className={[
              "font-black tabular-nums tracking-tight",
              "text-[38vw] leading-none md:text-[26vw]",
              view?.reel.status === "spinning" ? "text-amber-200 drop-shadow-[0_0_60px_rgba(251,191,36,0.25)]" : "text-neutral-50",
            ].join(" ")}
          >
            {shownDigit ?? "—"}
          </div>
          <div className="mt-2 text-sm text-neutral-400">
            {view?.reel.status ?? "idle"} / last: {view?.lastNumber ?? "—"}
          </div>
        </div>
      </div>
    </main>
  );
}

