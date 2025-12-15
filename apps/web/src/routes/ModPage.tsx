import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import BingoCard from "../components/BingoCard";
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
      if (prev.length >= 6) return prev;
      return prev.concat(id);
    });
  }

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
              セッション: <span className="font-mono text-neutral-200">{code}</span> / WS:{" "}
              <span className={status === "connected" ? "text-emerald-300" : status === "offline" ? "text-red-200" : "text-amber-300"}>
                {status}
              </span>
            </div>
            <div className="mt-1 text-xs text-neutral-500">スポットライトは「下書き→送信」の2段階（最大6人）。</div>
          </div>
          <div className="text-xs text-neutral-500">
            players: <span className="font-mono text-neutral-200">{players.length}</span> / shown:{" "}
            <span className="font-mono text-neutral-200">{filteredPlayers.length}</span> / last:{" "}
            <span className="font-mono text-neutral-200">{view?.lastNumber ?? "—"}</span>
          </div>
        </div>

        {view?.sessionStatus === "ended" && (
          <div className="mt-6 rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-200">
            このセッションは終了しました。{view.endedAt ? <span className="text-xs text-amber-100">endedAt: {view.endedAt}</span> : null}
          </div>
        )}

        <div className="mt-6 grid gap-4">
          {!view && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <h2 className="text-base font-semibold">入室（認証）</h2>
              <p className="mt-2 text-sm text-neutral-300">招待リンクの token を使って入室してください（cookieに保存します）。</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <input
                  className="w-full max-w-md rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm outline-none focus:border-emerald-600"
                  placeholder="token を貼り付け"
                  value={enterToken}
                  onChange={(e) => setEnterToken(e.target.value)}
                />
                <button
                  className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
                  disabled={entering || enterToken.trim().length === 0}
                  onClick={() => void enter(enterToken)}
                  type="button"
                >
                  {entering ? "入室中..." : "入室"}
                </button>
              </div>
              {enterError && <div className="mt-3 text-sm text-red-200">入室に失敗: {enterError}</div>}
            </div>
          )}

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">スポットライト</h2>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-950/70 disabled:opacity-60"
                  disabled={sending || !view || view.sessionStatus !== "active"}
                  onClick={() => setDraft([])}
                  type="button"
                >
                  クリア
                </button>
                <button
                  className="rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
                  disabled={sending || !view || view.sessionStatus !== "active"}
                  onClick={() => void send()}
                  type="button"
                >
                  {sending ? "送信中..." : "送信"}
                </button>
              </div>
            </div>

            <div className="mt-3 text-xs text-neutral-400">
              現在: {view?.spotlight?.ids?.length ?? 0}人 / 下書き: {draft.length}人（最大6）
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              spotlight: v{view?.spotlight?.version ?? "—"} / updatedBy {view?.spotlight?.updatedBy ?? "—"} /{" "}
              {view?.spotlight?.updatedAt ? relativeFromNow(view.spotlight.updatedAt) : "—"}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {draft.length ? (
                draft.map((id) => {
                  const p = players.find((x) => x.id === id);
                  return (
                    <button
                      key={id}
                      className="rounded-full border border-neutral-800 bg-neutral-950/40 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-950/70"
                      onClick={() => toggle(id)}
                      type="button"
                      title="クリックで外す"
                    >
                      {p?.displayName ?? id}
                    </button>
                  );
                })
              ) : (
                <div className="text-sm text-neutral-400">（未選択）</div>
              )}
            </div>

            {error && <div className="mt-3 text-sm text-red-200">error: {error}</div>}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
            <h2 className="text-base font-semibold">参加者一覧</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                className="w-full max-w-sm rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm outline-none focus:border-emerald-600"
                placeholder="検索（名前/ID）"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {selectedPlayer && (
                <div className="text-xs text-neutral-400">
                  選択中: <span className="font-mono text-neutral-200">{selectedPlayer.id}</span>
                </div>
              )}
            </div>

            {selectedPlayer && (
              <div className="mt-4 grid gap-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-neutral-50">{selectedPlayer.displayName}</div>
                    <div className="mt-1 text-xs text-neutral-400">
                      min {selectedPlayer.progress.minMissingToLine} / reach {selectedPlayer.progress.reachLines} / bingoLines {selectedPlayer.progress.bingoLines}{" "}
                      {selectedPlayer.progress.isBingo ? <span className="text-emerald-200">/ BINGO</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-950/70"
                      onClick={() => {
                        toggle(selectedPlayer.id);
                      }}
                      type="button"
                    >
                      {draft.includes(selectedPlayer.id) ? "★ 下書きから外す" : "★ 下書きに追加"}
                    </button>
                  </div>
                </div>
                {selectedPlayer.card ? (
                  <BingoCard card={selectedPlayer.card} drawnNumbers={view?.drawnNumbers ?? []} />
                ) : (
                  <div className="text-sm text-neutral-400">カードなし</div>
                )}
              </div>
            )}

            <div className="mt-3 overflow-hidden rounded-lg border border-neutral-800">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 bg-neutral-950/40 px-3 py-2 text-xs text-neutral-400">
                <div>★</div>
                <div>name</div>
                <div className="text-right">min</div>
                <div className="text-right">reach</div>
                <div className="text-right">bingo</div>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                {filteredPlayers.map((p) => {
                  const selected = draft.includes(p.id);
                  const isBingo = p.progress.isBingo;
                  return (
                    <button
                      key={p.id}
                      className={[
                        "grid w-full grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-3 px-3 py-2 text-left text-sm",
                        "border-t border-neutral-800/70",
                        selected ? "bg-emerald-500/10" : "bg-transparent",
                        "hover:bg-neutral-950/60",
                      ].join(" ")}
                      onClick={() => {
                        setSelectedId(p.id);
                        toggle(p.id);
                      }}
                      type="button"
                      title={p.id}
                    >
                      <div className="text-xs">{selected ? "★" : "·"}</div>
                      <div className={isBingo ? "font-semibold text-emerald-200" : "text-neutral-200"}>{p.displayName}</div>
                      <div className="text-right font-mono text-xs text-neutral-300">{p.progress.minMissingToLine}</div>
                      <div className="text-right font-mono text-xs text-neutral-300">{p.progress.reachLines}</div>
                      <div className="text-right font-mono text-xs text-neutral-300">{p.progress.bingoLines}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 text-xs text-neutral-500">並び順: minMissingToLine asc → reachLines desc → displayName</div>
          </div>
        </div>
      </div>
    </main>
  );
}
