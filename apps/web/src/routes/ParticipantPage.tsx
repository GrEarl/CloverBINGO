import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import BingoCard from "../components/BingoCard";
import { useLocalStorageString } from "../lib/useLocalStorage";
import { useSessionSocket, type ParticipantSnapshot } from "../lib/useSessionSocket";

export default function ParticipantPage() {
  const params = useParams();
  const code = params.code ?? "";

  const playerIdKey = `cloverbingo:player:${code}:id`;
  const nameKey = `cloverbingo:player:${code}:name`;
  const [playerId, setPlayerId] = useLocalStorageString(playerIdKey, "");
  const [displayName, setDisplayName] = useLocalStorageString(nameKey, "");

  const [joinName, setJoinName] = useState(displayName);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const { snapshot, connected } = useSessionSocket({ role: "participant", code, playerId: playerId || undefined });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as ParticipantSnapshot).role !== "participant") return null;
    return snapshot as ParticipantSnapshot;
  }, [snapshot]);

  async function join() {
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/participant/join?code=${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: joinName }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `join failed (${res.status})`);
      }
      const json = (await res.json()) as { ok: true; playerId: string };
      setPlayerId(json.playerId);
      setDisplayName(joinName);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setJoining(false);
    }
  }

  function resetIdentity() {
    setPlayerId("");
    setDisplayName("");
    setJoinName("");
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">参加者</h1>
            <div className="mt-1 text-sm text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span>
            </div>
          </div>
          <div className="text-xs text-neutral-400">
            WS:{" "}
            <span className={connected ? "text-emerald-300" : "text-amber-300"}>{connected ? "connected" : "reconnecting..."}</span>
          </div>
        </div>

        {!playerId && (
          <div className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
            <h2 className="text-base font-semibold">表示名を入力</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <input
                className="w-full max-w-sm rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm outline-none focus:border-emerald-600"
                placeholder="例: らい"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
              />
              <button
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
                disabled={joining || joinName.trim().length === 0}
                onClick={join}
                type="button"
              >
                {joining ? "参加中..." : "参加する"}
              </button>
            </div>
            {joinError && <div className="mt-3 text-sm text-red-200">参加に失敗: {joinError}</div>}
            <div className="mt-4 text-xs text-neutral-500">※ セッションが未初期化の場合は 404 になります（ローカルはトップで作成）。</div>
          </div>
        )}

        {playerId && (
          <div className="mt-8 grid gap-6">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-neutral-200">
                  あなた: <span className="font-semibold">{displayName || "（未設定）"}</span>
                </div>
                <button
                  className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-950/70"
                  onClick={resetIdentity}
                  type="button"
                >
                  名前を変える（再参加）
                </button>
              </div>

              <div className="mt-4 grid gap-2 text-sm text-neutral-200">
                <div>
                  直近:{" "}
                  <span className="font-mono text-lg text-neutral-50">{view?.lastNumber ?? "—"}</span>{" "}
                  <span className="text-xs text-neutral-400">/ draw {view?.drawCount ?? "—"}</span>
                </div>
                {view?.player?.progress && (
                  <div className="text-xs text-neutral-400">
                    reachLines: <span className="text-neutral-200">{view.player.progress.reachLines}</span> / bingoLines:{" "}
                    <span className="text-neutral-200">{view.player.progress.bingoLines}</span> / minMissingToLine:{" "}
                    <span className="text-neutral-200">{view.player.progress.minMissingToLine}</span>
                  </div>
                )}
              </div>

              {view && view.player === null && (
                <div className="mt-6 rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-200">
                  参加情報が見つかりませんでした（playerId が無効の可能性があります）。「名前を変える（再参加）」を押してください。
                </div>
              )}

              {view?.player?.card ? (
                <div className="mt-6">
                  <BingoCard card={view.player.card} drawnNumbers={view.drawnNumbers} />
                </div>
              ) : view && view.player === null ? null : (
                <div className="mt-6 text-sm text-neutral-400">カードを読み込み中...</div>
              )}
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <h2 className="text-base font-semibold">スポットライト</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {view?.spotlight?.players?.length ? (
                  view.spotlight.players.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-full border border-neutral-800 bg-neutral-950/40 px-3 py-1 text-xs text-neutral-200"
                      title={p.id}
                    >
                      {p.displayName}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-neutral-400">（まだ選ばれていません）</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
