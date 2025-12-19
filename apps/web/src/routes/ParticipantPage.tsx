import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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

type CellPos = { r: number; c: number };

function buildReachHighlights(card: number[][], drawnNumbers: number[]): boolean[][] {
  const size = 5;
  const drawn = new Set(drawnNumbers);
  const highlight: boolean[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  if (card.length !== size) return highlight;

  const lines: CellPos[][] = [];
  for (let r = 0; r < size; r += 1) {
    const row: CellPos[] = [];
    for (let c = 0; c < size; c += 1) row.push({ r, c });
    lines.push(row);
  }
  for (let c = 0; c < size; c += 1) {
    const col: CellPos[] = [];
    for (let r = 0; r < size; r += 1) col.push({ r, c });
    lines.push(col);
  }
  lines.push(
    Array.from({ length: size }, (_, i) => ({ r: i, c: i })),
    Array.from({ length: size }, (_, i) => ({ r: i, c: size - 1 - i })),
  );

  for (const line of lines) {
    const missing: CellPos[] = [];
    for (const cell of line) {
      const value = card[cell.r]?.[cell.c];
      const marked = value === 0 || drawn.has(value);
      if (!marked) missing.push(cell);
    }
    if (missing.length === 1) {
      const target = missing[0];
      highlight[target.r][target.c] = true;
    }
  }

  return highlight;
}

export default function ParticipantPage() {
  const params = useParams();
  const code = params.code ?? "";

  function createDeviceId(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `dev_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    }
  }

  const deviceIdKey = "cloverbingo:deviceId";
  const [deviceId] = useLocalStorageString(deviceIdKey, createDeviceId());

  const playerIdKey = `cloverbingo:player:${code}:id`;
  const nameKey = `cloverbingo:player:${code}:name`;
  const [playerId, setPlayerId] = useLocalStorageString(playerIdKey, "");
  const [displayName, setDisplayName] = useLocalStorageString(nameKey, "");

  const [joinName, setJoinName] = useState(displayName);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  const [acking, setAcking] = useState(false);

  const { snapshot, status } = useSessionSocket({ role: "participant", code, playerId: playerId || undefined });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as ParticipantSnapshot).role !== "participant") return null;
    return snapshot as ParticipantSnapshot;
  }, [snapshot]);

  const [bingoFx, setBingoFx] = useState<{ key: number } | null>(null);
  const bingoFxTimerRef = useRef<number | null>(null);
  const prevIsBingoRef = useRef(false);
  const hasSnapshotRef = useRef(false);

  useEffect(() => {
    const isBingo = Boolean(view?.player?.progress?.isBingo);
    if (!hasSnapshotRef.current) {
      hasSnapshotRef.current = true;
      prevIsBingoRef.current = isBingo;
      return;
    }
    if (isBingo && !prevIsBingoRef.current) {
      const key = Date.now();
      setBingoFx({ key });
      if (bingoFxTimerRef.current) window.clearTimeout(bingoFxTimerRef.current);
      bingoFxTimerRef.current = window.setTimeout(() => setBingoFx(null), 1800);
    }
    prevIsBingoRef.current = isBingo;
  }, [view?.player?.progress?.isBingo]);

  useEffect(() => () => {
    if (bingoFxTimerRef.current) window.clearTimeout(bingoFxTimerRef.current);
  }, []);

  async function ackBingo() {
    if (!playerId) return;
    setAcking(true);
    setAckError(null);
    try {
      const res = await fetch(`/api/participant/bingo/ack?code=${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantId: playerId, deviceId }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `ack failed (${res.status})`);
      }
    } catch (err) {
      setAckError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setAcking(false);
    }
  }

  const reachHighlights = useMemo(() => {
    if (!view?.player?.card) return null;
    return buildReachHighlights(view.player.card, view.drawnNumbers);
  }, [view?.player?.card, view?.drawnNumbers]);

  const bingoApproval = view?.bingoApproval ?? null;
  const isBingo = Boolean(view?.player?.progress?.isBingo);
  const approvalRequired = view?.bingoApprovalRequired ?? true;
  const needsAck = Boolean(approvalRequired && isBingo && (!bingoApproval || !bingoApproval.acknowledgedAt));
  const canAck = Boolean(needsAck && bingoApproval?.approvedAt);
  const showBingoOverlay = Boolean(needsAck || bingoFx);

  const bingoParticles = useMemo(() => {
    if (!showBingoOverlay) return [];
    const keyBase = bingoFx?.key ?? bingoApproval?.firstBingoAt ?? Date.now();
    const count = 26;
    const list: Array<{ key: string; style: CSSProperties }> = [];
    for (let i = 0; i < count; i += 1) {
      const x = Math.random() * 100;
      const size = 8 + Math.floor(Math.random() * 12);
      const delay = Math.floor(Math.random() * 240);
      const dx = Math.floor(Math.random() * 80) - 40;
      const rot = Math.floor(Math.random() * 360);
      const dur = 1400 + Math.floor(Math.random() * 700);
      list.push({
        key: `${keyBase}:${i}`,
        style: {
          "--x": `${x}%`,
          "--size": `${size}px`,
          "--delay": `${delay}ms`,
          "--dx": `${dx}px`,
          "--rot": `${rot}deg`,
          "--dur": `${dur}ms`,
        } as CSSProperties,
      });
    }
    return list;
  }, [bingoFx, showBingoOverlay, bingoApproval?.firstBingoAt]);

  async function join() {
    setJoining(true);
    setJoinError(null);
    setJoinNotice(null);
    try {
      const res = await fetch(`/api/participant/join?code=${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: joinName, deviceId }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `join failed (${res.status})`);
      }
      const json = (await res.json()) as { ok: true; playerId: string; mode?: "created" | "updated"; warning?: string };
      setPlayerId(json.playerId);
      setDisplayName(joinName);
      const notices: string[] = [];
      if (json.mode === "updated") notices.push("この端末は既に参加していたため、表示名を更新しました（カードは引き継ぎです）。");
      if (json.warning) notices.push(json.warning);
      if (notices.length) setJoinNotice(notices.join(" / "));
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setJoining(false);
    }
  }

  function resetIdentity() {
    if (playerId) {
      const ok = window.confirm("この端末で既に参加しています。名前を変えると参加情報（表示名）が上書きされます。続けますか？");
      if (!ok) return;
    }
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
                {view?.player?.status === "disabled" && <Badge variant="danger">無効</Badge>}
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

        {view?.player?.status === "disabled" && (
          <div className="mt-6">
            <Alert variant="danger">この参加者は無効化されています（判定/統計の対象外です）。</Alert>
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
            {joinNotice && (
              <div className="mt-3">
                <Alert variant="warning">{joinNotice}</Alert>
              </div>
            )}
            <div className="mt-4 text-xs text-neutral-500">※ セッションが未初期化の場合は 404 になります（ローカルはトップで作成）。</div>
          </Card>
        )}

        {playerId && (
          <div className="mt-4 grid gap-4">
            {joinNotice && (
              <Alert variant="warning">{joinNotice}</Alert>
            )}
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
                  <BingoCard card={view.player.card} drawnNumbers={view.drawnNumbers} reachHighlights={reachHighlights ?? undefined} />
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

      {showBingoOverlay && (
        <>
          <div className="pointer-events-none fixed inset-0 z-40">
            {bingoParticles.map((p) => (
              <span key={p.key} className="clover-particle" style={p.style} />
            ))}
          </div>
          <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
            <div className="rounded-xl border border-amber-300/70 bg-black/80 px-6 py-4 text-center shadow-[0_0_30px_rgba(234,179,8,0.4)]">
              <div className="text-[min(18vw,4rem)] font-black tracking-tight text-amber-300 drop-shadow-[0_0_20px_rgba(234,179,8,0.7)]">BINGO!</div>
              <div className="mt-2 text-xs text-neutral-300">おめでとう！</div>
              {needsAck && (
                <div className="mt-3 flex flex-col items-center gap-2">
                  <Button
                    disabled={!canAck || acking}
                    onClick={() => void ackBingo()}
                    size="sm"
                    variant={canAck ? "primary" : "secondary"}
                    className="pointer-events-auto"
                  >
                    {acking ? "送信中..." : canAck ? "了承する" : "承認待ち"}
                  </Button>
                  {ackError && <div className="text-[0.65rem] text-rose-300">{ackError}</div>}
                  {!canAck && <div className="text-[0.65rem] text-neutral-400">Modの承認後に押せます</div>}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
