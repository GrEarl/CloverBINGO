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

  const operatorNameKey = "cloverbingo:mod:operatorName";
  const [operatorName, setOperatorName] = useLocalStorageString(operatorNameKey, "");
  const effectiveUpdatedBy = operatorName.trim() ? operatorName.trim() : clientId;

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
      await postJson(`/api/mod/spotlight?code=${encodeURIComponent(code)}`, { spotlight: draft, updatedBy: effectiveUpdatedBy });
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
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <div>更新者名</div>
              <Input
                className="w-44 py-1 text-xs"
                placeholder="例: MC-A"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
              />
              <div className="text-neutral-600">表示: {effectiveUpdatedBy || "?"}</div>
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

        {view && (
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
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">カード監視</h2>
                <div className="mt-1 text-xs text-neutral-500">各カードの★でスポットライト下書きに追加/削除できます。</div>
              </div>
              <div className="w-full sm:w-[280px]">
                <Input placeholder="検索（名前/ID）" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>

            {filteredPlayers.length === 0 ? (
              <div className="mt-4 text-sm text-neutral-400">該当する参加者がいません。</div>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {filteredPlayers.map((p) => {
                  const selected = draft.includes(p.id);
                  const isBingo = p.progress.isBingo;
                  const isFocused = selectedId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={[
                        "rounded-xl border p-3",
                        selected ? "border-emerald-500/30 bg-emerald-500/10" : "border-neutral-800 bg-neutral-950/30",
                        isFocused ? "outline outline-2 outline-emerald-500/30" : "",
                      ].join(" ")}
                      title={p.id}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(p.id)} type="button">
                          <div className="flex items-center gap-2">
                            <span className={["truncate text-sm", isBingo ? "font-semibold text-emerald-200" : "text-neutral-200"].join(" ")}>
                              {p.displayName}
                            </span>
                            {isBingo ? <Badge variant="success">BINGO</Badge> : null}
                          </div>
                          <div className="mt-1 text-xs text-neutral-500">
                            min <span className="font-mono text-neutral-200">{p.progress.minMissingToLine}</span> / reach{" "}
                            <span className="font-mono text-neutral-200">{p.progress.reachLines}</span>
                          </div>
                        </button>
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
                      </div>

                      <div className="mt-2">
                        <BingoCard card={p.card} drawnNumbers={view?.drawnNumbers ?? []} showHeaders={false} variant="compact" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-3 text-xs text-neutral-500">並び順: minMissingToLine asc → reachLines desc → displayName</div>
          </Card>
        </div>
        )}
      </div>
    </main>
  );
}
