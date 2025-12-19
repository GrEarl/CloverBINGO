import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import BingoCard from "../components/BingoCard";
import Alert from "../components/ui/Alert";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import WsStatusPill from "../components/ui/WsStatusPill";
import { useSessionSocket, type ObserverEvent, type ObserverSnapshot, type Player } from "../lib/useSessionSocket";

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

function formatLogDetail(event: ObserverEvent): string {
  const parts: string[] = [];
  if (event.role) parts.push(event.role);
  if (event.by) parts.push(`by:${event.by}`);
  if (event.detail) parts.push(event.detail);
  return parts.join(" ");
}

export default function ObserverPage() {
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
      window.location.replace(res.redirectTo);
    } catch (err) {
      setEnterError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setEntering(false);
    }
  }

  const pending = view?.pendingDraw ?? null;
  const impactDelta = pending && view?.stats ? {
    reach: pending.impact.reachPlayers - view.stats.reachPlayers,
    bingo: pending.impact.bingoPlayers - view.stats.bingoPlayers,
  } : null;
  const predictedNames = pending?.preview?.newBingoNames ?? [];

  const recentEvents = useMemo(() => {
    if (!view?.eventLog) return [] as ObserverEvent[];
    return [...view.eventLog].slice(-6).reverse();
  }, [view?.eventLog]);

  const connectionSummary = useMemo(() => {
    const base = { participant: 0, display: 0, admin: 0, mod: 0, observer: 0 };
    if (!view?.connections) return base;
    for (const conn of view.connections) {
      if (conn.role === "participant") base.participant += 1;
      if (conn.role === "display") base.display += 1;
      if (conn.role === "admin") base.admin += 1;
      if (conn.role === "mod") base.mod += 1;
      if (conn.role === "observer") base.observer += 1;
    }
    return base;
  }, [view?.connections]);

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Observer</h1>
            <div className="mt-1 text-sm text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <WsStatusPill status={status} />
              <Badge variant={view?.sessionStatus === "ended" ? "danger" : "neutral"}>{view?.sessionStatus ?? "—"}</Badge>
              <Badge>drawState: {view?.drawState ?? "—"}</Badge>
            </div>
          </div>
          <div className="text-xs text-neutral-500">
            <div>updated: {relativeFromNow(view?.updatedAt)}</div>
            <div>last: <span className="font-mono text-neutral-200">{view?.lastNumber ?? "—"}</span></div>
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
          <>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <Card>
                <div className="text-xs text-neutral-500">統計</div>
                <div className="mt-3 grid gap-2 text-sm">
                  <div>draw: <span className="font-mono text-neutral-200">{view.drawCount}</span> / 75</div>
                  <div>reach: <span className="font-mono text-amber-200">{view.stats.reachPlayers}</span></div>
                  <div>bingo: <span className="font-mono text-emerald-200">{view.stats.bingoPlayers}</span></div>
                  <div className="text-xs text-neutral-500">lastNumbers: {view.lastNumbers.join(", ") || "—"}</div>
                </div>
              </Card>

              <Card>
                <div className="text-xs text-neutral-500">準備/リール</div>
                <div className="mt-3 grid gap-2 text-sm">
                  <div>next: <span className="font-mono text-neutral-200">{pending ? pending.number : "—"}</span></div>
                  <div>impact: reach <span className="font-mono text-neutral-200">{pending?.impact.reachPlayers ?? "—"}</span> / bingo <span className="font-mono text-neutral-200">{pending?.impact.bingoPlayers ?? "—"}</span></div>
                  <div>delta: reach <span className="font-mono text-neutral-200">{impactDelta ? impactDelta.reach : "—"}</span> / bingo <span className="font-mono text-neutral-200">{impactDelta ? impactDelta.bingo : "—"}</span></div>
                  <div>reel: <span className="font-mono text-neutral-200">ten={pending?.reel.ten ?? "—"}</span> / <span className="font-mono text-neutral-200">one={pending?.reel.one ?? "—"}</span></div>
                  <div className="text-xs text-neutral-500">予想NEW BINGO: {predictedNames.length ? predictedNames.join("、") : "—"}</div>
                </div>
              </Card>

              <Card>
                <div className="text-xs text-neutral-500">音響 / 接続</div>
                <div className="mt-3 grid gap-2 text-sm">
                  <div>BGM: <span className="text-neutral-200">{view.audio.bgm.label ?? "—"}</span> <span className="text-neutral-500">({view.audio.bgm.state})</span></div>
                  <div className="text-xs text-neutral-500">BGM更新: {relativeFromNow(view.audio.bgm.updatedAt)}</div>
                  <div>SE: <span className="text-neutral-200">{view.audio.sfx.label ?? "—"}</span></div>
                  <div className="text-xs text-neutral-500">SE更新: {relativeFromNow(view.audio.sfx.at)}</div>
                  <div className="mt-1 text-xs text-neutral-500">
                    conn: P{connectionSummary.participant} / D{connectionSummary.display} / A{connectionSummary.admin} / M{connectionSummary.mod} / O{connectionSummary.observer}
                  </div>
                </div>
              </Card>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Card>
                <div className="text-xs text-neutral-500">直近確定 / NEW BINGO</div>
                <div className="mt-3 flex flex-wrap items-baseline gap-3">
                  <div className="font-mono text-3xl text-neutral-50">{view.lastCommit?.number ?? "—"}</div>
                  <div className="text-sm text-neutral-300">解放: <span className="font-mono text-neutral-200">{view.lastCommit?.openedPlayers ?? "—"}</span>人</div>
                </div>
                <div className="mt-2 text-sm text-amber-200">{view.lastCommit?.newBingoNames?.length ? view.lastCommit.newBingoNames.join("、") : "—"}</div>
                <div className="mt-1 text-xs text-neutral-500">committed: {view.lastCommit?.committedAt ?? "—"}</div>
              </Card>

              <Card>
                <div className="text-xs text-neutral-500">操作監視（直近）</div>
                <div className="mt-3 grid gap-2 text-xs text-neutral-300">
                  {recentEvents.length === 0 && <div className="text-neutral-600">—</div>}
                  {recentEvents.map((ev) => (
                    <div key={ev.id} className="flex items-start justify-between gap-3">
                      <div>
                        <span className="font-mono text-neutral-200">{ev.type}</span>
                        {formatLogDetail(ev) && <span className="ml-2 text-neutral-400">{formatLogDetail(ev)}</span>}
                      </div>
                      <div className="text-neutral-500">{relativeFromNow(ev.at)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs text-neutral-600">
                  詳細ログ:{" "}
                  <a
                    className="underline hover:text-neutral-300"
                    href={`/s/${encodeURIComponent(code)}/debug`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    /s/{code}/debug
                  </a>
                </div>
              </Card>
            </div>

            <Card className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">参加者カード（{players.length}人）</div>
                <div className="text-xs text-neutral-500">page {pageIndex + 1} / {pageCount}</div>
              </div>
              <div className={`mt-4 grid gap-3`} style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}>
                {pagePlayers.map((p) => (
                  <div key={p.id} className={`rounded-md border border-neutral-800 bg-neutral-950/40 p-2 ${p.status === "disabled" ? "opacity-60" : ""}`}>
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
          </>
        )}
      </div>
    </main>
  );
}
