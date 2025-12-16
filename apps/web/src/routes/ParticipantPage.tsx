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
import { cn } from "../lib/cn";

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
    if (confirm("Reset ID? This cannot be undone.")) {
        setPlayerId("");
        setDisplayName("");
        setJoinName("");
    }
  }

  return (
    <main className="min-h-dvh bg-pit-bg font-mono text-pit-text-main selection:bg-pit-primary selection:text-pit-bg">
      <div className="mx-auto max-w-md p-4">
        {/* Device Header */}
        <div className="mb-6 flex items-center justify-between border-b-2 border-pit-border pb-2">
          <div>
            {!playerId ? (
              <h1 className="text-xl font-black uppercase tracking-widest text-pit-primary">Login</h1>
            ) : (
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                   <div className="text-lg font-bold text-pit-text-main">{displayName || "UNKNOWN"}</div>
                   {view?.player?.progress?.isBingo && <Badge variant="success" className="animate-pulse shadow-glow">WINNER</Badge>}
                </div>
                <div className="text-[0.6rem] uppercase text-pit-text-muted">ID: {playerId.slice(0, 8)}...</div>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
             <div className="flex items-center gap-1 text-[0.6rem] text-pit-text-muted uppercase">
               <span>Signal:</span>
               <WsStatusPill status={status} />
             </div>
             <div className="text-[0.6rem] text-pit-text-dim">Code: <span className="font-bold text-pit-primary">{code}</span></div>
          </div>
        </div>

        {view?.sessionStatus === "ended" && (
          <div className="mb-6 border-2 border-pit-danger bg-pit-danger/10 p-4 text-center">
             <div className="text-lg font-bold text-pit-danger uppercase tracking-widest animate-pulse">Session Terminated</div>
             {view.endedAt && <div className="mt-1 text-xs text-pit-danger/70">{view.endedAt}</div>}
          </div>
        )}

        {!playerId && (
          <div className="rounded-xl border-2 border-pit-border bg-pit-surface p-6 shadow-xl">
            <h2 className="text-sm font-bold uppercase tracking-wider text-pit-text-muted mb-4">Identity Registration</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-pit-text-dim block mb-1">Display Name</label>
                <input 
                  className="w-full rounded-none border-b-2 border-pit-text-muted bg-pit-bg px-3 py-2 text-pit-text-main placeholder-pit-text-muted/50 focus:border-pit-primary focus:outline-none"
                  placeholder="ENTER NAME..." 
                  value={joinName} 
                  onChange={(e) => setJoinName(e.target.value)} 
                />
              </div>
              <button
                disabled={joining || joinName.trim().length === 0 || view?.sessionStatus === "ended"}
                onClick={join}
                className="w-full rounded-sm bg-pit-primary px-4 py-3 text-sm font-bold text-pit-bg uppercase tracking-widest hover:bg-pit-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {joining ? "Processing..." : "Confirm Identity"}
              </button>
            </div>
            {joinError && (
              <div className="mt-4 border border-pit-danger bg-pit-danger/10 p-2 text-xs text-pit-danger">
                ERROR: {joinError}
              </div>
            )}
             <div className="mt-4 text-[0.6rem] text-pit-text-muted text-center">
                WARNING: Unauthorized access is prohibited.
            </div>
          </div>
        )}

        {playerId && (
          <div className="grid gap-6">
            {view && view.player === null && (
              <div className="border border-pit-primary bg-pit-primary/10 p-4 text-sm text-pit-primary">
                Identity Mismatch. Please re-register.
              </div>
            )}

            <div className="rounded-xl border-none bg-transparent">
              {view?.player?.card ? (
                <div className="transform transition-all">
                  <BingoCard card={view.player.card} drawnNumbers={view.drawnNumbers} />
                </div>
              ) : view && view.player === null ? null : (
                <div className="flex h-64 items-center justify-center border-2 border-dashed border-pit-border text-sm text-pit-text-muted animate-pulse">
                  Acquiring Ticket...
                </div>
              )}

              {/* Stats Bar */}
              <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="rounded-sm border border-pit-border bg-pit-surface p-2 text-center">
                      <div className="text-[0.6rem] uppercase text-pit-text-muted">Last Draw</div>
                      <div className="text-2xl font-black text-pit-primary">{view?.lastNumber ?? "—"}</div>
                  </div>
                   <div className="rounded-sm border border-pit-border bg-pit-surface p-2 text-center">
                      <div className="text-[0.6rem] uppercase text-pit-text-muted">Progress</div>
                      <div className="text-2xl font-black text-pit-text-main">{view?.drawCount ?? "—"}<span className="text-sm text-pit-text-muted">/75</span></div>
                  </div>
              </div>

              {/* History Log */}
              <div className="mt-4">
                 <details className="group">
                    <summary className="cursor-pointer list-none rounded-sm border border-pit-border bg-pit-surface px-4 py-2 text-xs font-bold uppercase tracking-wider text-pit-text-muted hover:bg-pit-border transition-colors flex justify-between items-center">
                        <span>View Draw Log</span>
                        <span className="group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-2 p-2 border border-pit-border bg-pit-bg/50">
                      {(view?.lastNumbers ?? []).slice().reverse().map((n, idx) => (
                        <div key={idx} className="flex h-8 w-8 items-center justify-center rounded-sm bg-pit-surface border border-pit-border text-xs font-bold text-pit-text-dim">
                          {n}
                        </div>
                      ))}
                      {!view?.lastNumbers?.length && <div className="text-xs text-pit-text-muted">NO DATA</div>}
                    </div>
                 </details>
              </div>

               <div className="mt-8 text-center">
                <button onClick={resetIdentity} className="text-[0.6rem] uppercase text-pit-text-muted hover:text-pit-danger transition-colors underline decoration-dashed">
                  Reset Terminal Identity
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
