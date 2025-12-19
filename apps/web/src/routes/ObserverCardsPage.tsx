import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import BingoCard from "../components/BingoCard";
import Alert from "../components/ui/Alert";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import WsStatusPill from "../components/ui/WsStatusPill";
import { useSessionSocket, type ObserverSnapshot, type Player } from "../lib/useSessionSocket";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `request failed (${res.status})`);
  return (await res.json()) as T;
}

function sortPlayers(a: Player, b: Player): number {
  if (a.status !== b.status) return a.status === "disabled" ? 1 : -1;
  if (a.progress.minMissingToLine !== b.progress.minMissingToLine) return a.progress.minMissingToLine - b.progress.minMissingToLine;
  if (a.progress.reachLines !== b.progress.reachLines) return b.progress.reachLines - a.progress.reachLines;
  return a.displayName.localeCompare(b.displayName, "ja");
}

function relativeFromNow(ms: number | null | undefined): string {
  if (!ms) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 10) return "いま";
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  return `${hr}時間前`;
}

export default function ObserverCardsPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const code = params.code ?? "";
  const inviteToken = search.get("token") ?? "";

  const { snapshot, status } = useSessionSocket({ role: "observer", code });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as ObserverSnapshot).role !== "observer") return null;
    return snapshot as ObserverSnapshot;
  }, [snapshot]);

  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [enterToken, setEnterToken] = useState(inviteToken);

  const [grid, setGrid] = useState({ cols: 4, rows: 3 });
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    function update() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cols = w >= 1700 ? 5 : w >= 1300 ? 4 : w >= 900 ? 3 : 2;
      const rows = h >= 900 ? 3 : h >= 700 ? 2 : 2;
      setGrid({ cols, rows });
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const players = useMemo(() => {
    const list = view?.players ? [...view.players] : [];
    list.sort(sortPlayers);
    return list;
  }, [view?.players]);

  const pageSize = Math.max(1, grid.cols * grid.rows);
  const pageCount = Math.max(1, Math.ceil(players.length / pageSize));

  useEffect(() => {
    setPageIndex(0);
  }, [players.length, pageSize]);

  useEffect(() => {
    if (pageCount <= 1) return;
    const timer = window.setInterval(() => {
      setPageIndex((prev) => (prev + 1) % pageCount);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [pageCount]);

  const pagePlayers = useMemo(() => {
    const start = pageIndex * pageSize;
    return players.slice(start, start + pageSize);
  }, [players, pageIndex, pageSize]);

  async function enter(token: string) {
    setEnterError(null);
    setEntering(true);
    try {
      const res = await postJson<{ ok: true; redirectTo: string }>("/api/invite/enter", { token });
      const next = res.redirectTo.replace("/observer", "/observer/cards");
      window.location.replace(next);
    } catch (err) {
      setEnterError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setEntering(false);
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Observer Cards</h1>
            <div className="mt-1 text-sm text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <WsStatusPill status={status} />
              <Badge variant={view?.sessionStatus === "ended" ? "danger" : "neutral"}>{view?.sessionStatus ?? "—"}</Badge>
            </div>
          </div>
          <div className="text-xs text-neutral-500 text-right">
            <div>updated: {relativeFromNow(view?.updatedAt)}</div>
            <div>page: {pageIndex + 1} / {pageCount}</div>
          </div>
        </div>

        {!view && (
          <Card className="mt-6">
            <h2 className="text-base font-semibold">入室（認証）</h2>
            <p className="mt-2 text-sm text-neutral-300">招待リンクの token を使って入室してください（cookieに保存されます）。</p>
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

        {view && (
          <Card className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">参加者カード（{players.length}人）</div>
              <div className="text-xs text-neutral-500">
                cols {grid.cols} / rows {grid.rows}
              </div>
            </div>
            <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}>
              {pagePlayers.map((p) => (
                <div
                  key={p.id}
                  className={`rounded-md border border-neutral-800 bg-neutral-950/40 p-2 ${p.status === "disabled" ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-neutral-100 truncate">{p.displayName}</div>
                    {p.status === "disabled" && <Badge variant="danger">無効</Badge>}
                  </div>
                  <div className="mt-1 text-[0.65rem] text-neutral-500">min: {p.progress.minMissingToLine} / reach: {p.progress.reachLines}</div>
                  <div className="mt-2">
                    {p.card ? (
                      <BingoCard card={p.card} drawnNumbers={view.drawnNumbers} variant="compact" showHeaders={false} />
                    ) : (
                      <div className="text-xs text-neutral-500">カード未取得</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
