import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import BingoCard from "../components/BingoCard";
import Alert from "../components/ui/Alert";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import WsStatusPill from "../components/ui/WsStatusPill";
import { useLocalStorageString } from "../lib/useLocalStorage";
import { useSessionSocket, type ModSnapshot, type Player } from "../lib/useSessionSocket";

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
  if (a.progress.minMissingToLine !== b.progress.minMissingToLine) return a.progress.minMissingToLine - b.progress.minMissingToLine;
  if (a.progress.reachLines !== b.progress.reachLines) return b.progress.reachLines - a.progress.reachLines;
  return a.displayName.localeCompare(b.displayName, "ja");
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

export default function ModPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const code = params.code ?? "";
  const inviteToken = search.get("token") ?? "";

  const { snapshot, status } = useSessionSocket({ role: "mod", code });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as ModSnapshot).role !== "mod") return null;
    return snapshot as ModSnapshot;
  }, [snapshot]);

  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [enterToken, setEnterToken] = useState(inviteToken);

  const [draft, setDraft] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const didInitDraft = useRef(false);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clientIdKey = `cloverbingo:mod:${code}:clientId`;
  const [clientId, setClientId] = useLocalStorageString(clientIdKey, "");

  useEffect(() => {
    if (!clientId) setClientId(crypto.randomUUID().slice(0, 8));
  }, [clientId, setClientId]);

  useEffect(() => {
    didInitDraft.current = false;
    setDraft([]);
    setSelectedId(null);
  }, [code]);

  useEffect(() => {
    if (!view) return;
    if (didInitDraft.current) return;
    didInitDraft.current = true;
    setDraft(view.spotlight.ids);
  }, [view?.spotlight?.version]);

  const players = useMemo(() => {
    const list = view?.players ? [...view.players] : [];
    list.sort(sortPlayers);
    return list;
  }, [view?.players]);

  const filteredPlayers = useMemo(() => {
    if (!query.trim()) return players;
    const q = query.trim().toLowerCase();
    return players.filter((p) => p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [players, query]);

  const selectedPlayer = useMemo(() => {
    if (!selectedId) return null;
    return players.find((p) => p.id === selectedId) ?? null;
  }, [players, selectedId]);

  function toggle(id: string) {
    setDraft((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 6) {
        setDraftWarning("スポットライトは最大6人です。外してから追加してください。");
        return prev;
      }
      return prev.concat(id);
    });
  }

  useEffect(() => {
    if (!draftWarning) return;
    const t = window.setTimeout(() => setDraftWarning(null), 2200);
    return () => window.clearTimeout(t);
  }, [draftWarning]);

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

  async function send() {
    setSending(true);
    setError(null);
    try {
      await postJson(`/api/mod/spotlight?code=${encodeURIComponent(code)}`, { spotlight: draft, updatedBy: clientId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Mod</h1>
            <div className="mt-1 text-sm text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <WsStatusPill status={status} />
              <div className="text-xs text-neutral-500">スポットライトは「下書き→送信」の2段階（最大6人）。</div>
            </div>
          </div>
          <div className="text-xs text-neutral-500">
            players: <span className="font-mono text-neutral-200">{players.length}</span> / shown:{" "}
            <span className="font-mono text-neutral-200">{filteredPlayers.length}</span> / last:{" "}
            <span className="font-mono text-neutral-200">{view?.lastNumber ?? "—"}</span>
          </div>
        </div>

        {view?.sessionStatus === "ended" && (
          <div className="mt-6">
            <Alert variant="warning">
              このセッションは終了しました。{view.endedAt ? <span className="text-xs text-amber-100">endedAt: {view.endedAt}</span> : null}
            </Alert>
          </div>
        )}

        {!view && (
          <div className="mt-6">
            <Card>
              <h2 className="text-base font-semibold">入室（認証）</h2>
              <p className="mt-2 text-sm text-neutral-300">招待リンクの token を使って入室してください（cookieに保存します）。</p>
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
          </div>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr] lg:items-start">
          <div className="grid gap-4 lg:sticky lg:top-6">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold">スポットライト</h2>
                <div className="flex items-center gap-2">
                  <Button disabled={sending || !view || view.sessionStatus !== "active"} onClick={() => setDraft([])} size="sm" variant="secondary">
                    クリア
                  </Button>
                  <Button disabled={sending || !view || view.sessionStatus !== "active"} onClick={() => void send()} size="sm" variant="primary">
                    {sending ? "送信中..." : "送信"}
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                <div>
                  現在 <span className="font-mono text-neutral-200">{view?.spotlight?.ids?.length ?? 0}</span>人
                </div>
                <span className="text-neutral-700">/</span>
                <div>
                  下書き <span className="font-mono text-neutral-200">{draft.length}</span>人（最大6）
                </div>
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                spotlight: v{view?.spotlight?.version ?? "—"} / updatedBy {view?.spotlight?.updatedBy ?? "—"} /{" "}
                {view?.spotlight?.updatedAt ? relativeFromNow(view.spotlight.updatedAt) : "—"}
              </div>

              {draftWarning && (
                <div className="mt-3">
                  <Alert variant="warning">{draftWarning}</Alert>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {draft.length ? (
                  draft.map((id) => {
                    const p = players.find((x) => x.id === id);
                    return (
                      <button key={id} onClick={() => toggle(id)} title="クリックで外す" type="button">
                        <Badge>{p?.displayName ?? id}</Badge>
                      </button>
                    );
                  })
                ) : (
                  <div className="text-sm text-neutral-400">（未選択）</div>
                )}
              </div>

              {error && (
                <div className="mt-3">
                  <Alert variant="danger">error: {error}</Alert>
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-neutral-500">選択中</div>
                  <div className="mt-1 text-sm font-semibold text-neutral-50">{selectedPlayer ? selectedPlayer.displayName : "（未選択）"}</div>
                  {selectedPlayer && (
                    <div className="mt-1 text-xs text-neutral-400">
                      min {selectedPlayer.progress.minMissingToLine} / reach {selectedPlayer.progress.reachLines} / bingoLines {selectedPlayer.progress.bingoLines}{" "}
                      {selectedPlayer.progress.isBingo ? <span className="text-emerald-200">/ BINGO</span> : null}
                    </div>
                  )}
                </div>
                {selectedPlayer && (
                  <Button onClick={() => toggle(selectedPlayer.id)} size="sm" variant="secondary">
                    {draft.includes(selectedPlayer.id) ? "★ 下書きから外す" : "★ 下書きに追加"}
                  </Button>
                )}
              </div>
              {selectedPlayer ? (
                <div className="mt-4">
                  {selectedPlayer.card ? <BingoCard card={selectedPlayer.card} drawnNumbers={view?.drawnNumbers ?? []} /> : <div className="text-sm text-neutral-400">カードなし</div>}
                </div>
              ) : (
                <div className="mt-4 text-sm text-neutral-400">参加者を選ぶと簡易カードが表示されます。</div>
              )}
            </Card>
          </div>

          <Card>
            <h2 className="text-base font-semibold">参加者一覧</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Input placeholder="検索（名前/ID）" value={query} onChange={(e) => setQuery(e.target.value)} />
              {selectedPlayer && (
                <div className="text-xs text-neutral-400">
                  選択中: <span className="font-mono text-neutral-200">{selectedPlayer.id}</span>
                </div>
              )}
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-neutral-800">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 bg-neutral-950/40 px-3 py-2 text-xs text-neutral-400">
                <div>★</div>
                <div>name</div>
                <div className="text-right">min</div>
                <div className="text-right">reach</div>
                <div className="text-right">bingo</div>
              </div>
              <div className="max-h-[70vh] overflow-auto">
                {filteredPlayers.map((p) => {
                  const selected = draft.includes(p.id);
                  const isBingo = p.progress.isBingo;
                  const isFocused = selectedId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={[
                        "grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-3 px-3 py-2 text-left text-sm",
                        "border-t border-neutral-800/70",
                        selected ? "bg-emerald-500/10" : "bg-transparent",
                        isFocused ? "outline outline-2 outline-emerald-500/30" : "",
                      ].join(" ")}
                      title={p.id}
                    >
                      <Button
                        className="h-7 w-7 justify-center px-0 py-0"
                        onClick={() => toggle(p.id)}
                        size="sm"
                        variant={selected ? "primary" : "secondary"}
                        title={selected ? "下書きから外す" : "下書きに追加"}
                        type="button"
                      >
                        ★
                      </Button>
                      <button
                        className="truncate text-left"
                        onClick={() => setSelectedId(p.id)}
                        type="button"
                      >
                        <span className={isBingo ? "font-semibold text-emerald-200" : "text-neutral-200"}>{p.displayName}</span>
                      </button>
                      <div className="text-right font-mono text-xs text-neutral-300">{p.progress.minMissingToLine}</div>
                      <div className="text-right font-mono text-xs text-neutral-300">{p.progress.reachLines}</div>
                      <div className="text-right font-mono text-xs text-neutral-300">{p.progress.bingoLines}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 text-xs text-neutral-500">並び順: minMissingToLine asc → reachLines desc → displayName</div>
          </Card>
        </div>
      </div>
    </main>
  );
}
