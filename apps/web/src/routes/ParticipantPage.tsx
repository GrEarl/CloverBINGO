import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import BingoCard from "../components/BingoCard";
import Alert from "../components/ui/Alert";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import WsStatusPill from "../components/ui/WsStatusPill";
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

  const { snapshot, status } = useSessionSocket({ role: "participant", code, playerId: playerId || undefined });
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
      <div className="mx-auto max-w-md px-4 py-4 sm:px-6 sm:py-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            {!playerId ? (
              <h1 className="text-lg font-semibold tracking-tight">参加者</h1>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-lg font-semibold text-neutral-50">{displayName || "（未設定）"}</div>
                {view?.player?.progress?.isBingo && <Badge variant="success">BINGO</Badge>}
              </div>
            )}
            <div className="mt-1 text-xs text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span>
            </div>
          </div>
          <WsStatusPill status={status} />
        </div>

        {view?.sessionStatus === "ended" && (
          <div className="mt-6">
            <Alert variant="warning">
              このセッションは終了しました。{view.endedAt ? <span className="text-xs text-amber-100">endedAt: {view.endedAt}</span> : null}
            </Alert>
          </div>
        )}

        {!playerId && (
          <Card className="mt-4 p-4">
            <h2 className="text-base font-semibold">表示名を入力</h2>
            <p className="mt-2 text-sm text-neutral-300">会場で呼ばれたい名前を入力してください。</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Input placeholder="例: らい" value={joinName} onChange={(e) => setJoinName(e.target.value)} />
              <Button
                disabled={joining || joinName.trim().length === 0 || view?.sessionStatus === "ended"}
                onClick={join}
                variant="primary"
              >
                {joining ? "参加中..." : "参加する"}
              </Button>
            </div>
            {joinError && (
              <div className="mt-3">
                <Alert variant="danger">参加に失敗: {joinError}</Alert>
              </div>
            )}
            <div className="mt-4 text-xs text-neutral-500">※ セッションが未初期化の場合は 404 になります（ローカルはトップで作成）。</div>
          </Card>
        )}

        {playerId && (
          <div className="mt-4 grid gap-4">
            {view && view.player === null && (
              <Alert variant="warning">
                参加情報が見つかりませんでした（playerId が無効の可能性があります）。「名前を変える（再参加）」を押してください。
              </Alert>
            )}

            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-neutral-200">ビンゴカード</h2>
                <Button onClick={resetIdentity} size="sm" variant="secondary">
                  名前を変える（再参加）
                </Button>
              </div>

              {view?.player?.card ? (
                <div className="mt-3">
                  <BingoCard card={view.player.card} drawnNumbers={view.drawnNumbers} />
                </div>
              ) : view && view.player === null ? null : (
                <div className="mt-3 text-sm text-neutral-400">カードを読み込み中...</div>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-400">
                <div>
                  直近 <span className="font-mono text-neutral-100">{view?.lastNumber ?? "—"}</span>
                </div>
                <div>
                  draw <span className="font-mono text-neutral-100">{view?.drawCount ?? "—"}</span>/75
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-neutral-400">直近の番号</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(view?.lastNumbers ?? []).slice().reverse().map((n, idx) => (
                    <div key={idx} className="rounded-full border border-neutral-800 bg-neutral-950/40 px-3 py-1 text-sm font-mono text-neutral-200">
                      {n}
                    </div>
                  ))}
                  {!view?.lastNumbers?.length && <div className="text-sm text-neutral-400">—</div>}
                </div>
              </details>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
