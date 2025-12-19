import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import Alert from "../components/ui/Alert";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import WsStatusPill from "../components/ui/WsStatusPill";
import {
  useSessionSocket,
  type ConnectionInfo,
  type ObserverError,
  type ObserverEvent,
  type ObserverSnapshot,
} from "../lib/useSessionSocket";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `request failed (${res.status})`);
  return (await res.json()) as T;
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

function renderEvent(ev: ObserverEvent): string {
  const parts: string[] = [];
  if (ev.role) parts.push(ev.role);
  if (ev.by) parts.push(`by:${ev.by}`);
  if (ev.detail) parts.push(ev.detail);
  return parts.join(" ");
}

function connectionLabel(conn: ConnectionInfo): string {
  const parts: string[] = [conn.role];
  if (conn.screen) parts.push(`screen=${conn.screen}`);
  if (conn.playerId) parts.push(`player=${conn.playerId.slice(0, 8)}`);
  return parts.join(" ");
}

export default function DebugPage() {
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

  async function enter(token: string) {
    setEnterError(null);
    setEntering(true);
    try {
      const res = await postJson<{ ok: true; redirectTo: string }>("/api/invite/enter", { token });
      window.location.replace(res.redirectTo.replace("/observer", "/debug"));
    } catch (err) {
      setEnterError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setEntering(false);
    }
  }

  const eventCounts = useMemo(() => {
    const entries = Object.entries(view?.eventCounts ?? {});
    entries.sort((a, b) => b[1] - a[1]);
    return entries;
  }, [view?.eventCounts]);

  const connections = useMemo(() => {
    const list = view?.connections ? [...view.connections] : [];
    list.sort((a, b) => a.role.localeCompare(b.role, "en"));
    return list;
  }, [view?.connections]);

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Debug</h1>
            <div className="mt-1 text-sm text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <WsStatusPill status={status} />
              <Badge variant={view?.sessionStatus === "ended" ? "danger" : "neutral"}>{view?.sessionStatus ?? "—"}</Badge>
            </div>
          </div>
          <div className="text-xs text-neutral-500">
            updated: {relativeFromNow(view?.updatedAt)}
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
          <div className="mt-6 grid gap-4">
            <Card>
              <div className="text-xs text-neutral-500">イベント送信カウント</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {eventCounts.length === 0 && <div className="text-neutral-600">—</div>}
                {eventCounts.map(([key, value]) => (
                  <Badge key={key}>{key}:{value}</Badge>
                ))}
              </div>
            </Card>

            <Card>
              <div className="text-xs text-neutral-500">接続端末</div>
              <div className="mt-3 grid gap-2 text-xs text-neutral-300">
                {connections.length === 0 && <div className="text-neutral-600">—</div>}
                {connections.map((conn) => (
                  <div key={conn.id} className="flex items-center justify-between gap-3">
                    <div className="font-mono text-neutral-200">{connectionLabel(conn)}</div>
                    <div className="text-neutral-500">{relativeFromNow(conn.connectedAt)}</div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <div className="text-xs text-neutral-500">イベントログ</div>
                <div className="mt-3 grid gap-2 text-xs text-neutral-300">
                  {view.eventLog.length === 0 && <div className="text-neutral-600">—</div>}
                  {[...view.eventLog].slice(-40).reverse().map((ev) => (
                    <div key={ev.id} className="flex items-start justify-between gap-3">
                      <div>
                        <span className="font-mono text-neutral-200">{ev.type}</span>
                        {renderEvent(ev) && <span className="ml-2 text-neutral-500">{renderEvent(ev)}</span>}
                      </div>
                      <div className="text-neutral-600">{relativeFromNow(ev.at)}</div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div className="text-xs text-neutral-500">エラーログ</div>
                <div className="mt-3 grid gap-2 text-xs text-neutral-300">
                  {view.errorLog.length === 0 && <div className="text-neutral-600">—</div>}
                  {[...view.errorLog].slice(-40).reverse().map((err: ObserverError) => (
                    <div key={err.id}>
                      <div className="font-mono text-rose-300">{err.scope}: {err.message}</div>
                      <div className="text-neutral-600">{relativeFromNow(err.at)}</div>
                      {err.detail ? <div className="text-neutral-500">{err.detail}</div> : null}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
