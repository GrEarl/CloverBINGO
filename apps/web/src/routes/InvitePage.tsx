import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

type InviteInfoResponse =
  | { ok: false; error: string }
  | {
      ok: true;
      role: "admin" | "mod";
      label: string | null;
      sessionCode: string;
      sessionStatus: "active" | "ended";
      endedAt: string | null;
    };

type InviteEnterResponse =
  | { ok: false; error?: string }
  | { ok: true; role: "admin" | "mod"; sessionCode: string; redirectTo: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `request failed (${res.status})`);
  return (await res.json()) as T;
}

export default function InvitePage() {
  const params = useParams();
  const token = params.token ?? "";

  const [info, setInfo] = useState<InviteInfoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const okInfo = useMemo(() => {
    if (!info || info.ok !== true) return null;
    return info;
  }, [info]);

  useEffect(() => {
    let disposed = false;
    async function run() {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/invite/info?token=${encodeURIComponent(token)}`);
        const json = (await res.json()) as InviteInfoResponse;
        if (disposed) return;
        setInfo(json);
      } catch (err) {
        if (disposed) return;
        setInfo({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void run();
    return () => {
      disposed = true;
    };
  }, [token]);

  const title = useMemo(() => {
    if (!info || info.ok !== true) return "招待";
    const roleLabel = info.role === "admin" ? "Admin" : "Mod";
    return `${roleLabel} 招待`;
  }, [info]);

  async function enter() {
    setEntering(true);
    setError(null);
    try {
      const res = await postJson<InviteEnterResponse>("/api/invite/enter", { token });
      if (!res.ok) throw new Error(res.error ?? "enter failed");
      window.location.replace(res.redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setEntering(false);
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-neutral-300">招待URLの GET では副作用（cookie付与）を起こしません。入室するには「入室」を押してください。</p>

        <Card className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500">token</div>
              <div className="mt-1 break-all font-mono text-xs text-neutral-200">{token || "（空）"}</div>
            </div>
            {info?.ok === true && (
              <div className="text-right text-xs text-neutral-400">
                <div>
                  role: <span className="font-semibold text-neutral-200">{info.role}</span> {info.label ? <span>({info.label})</span> : null}
                </div>
                <div>
                  session: <span className="font-mono text-neutral-200">{info.sessionCode}</span>
                </div>
              </div>
            )}
          </div>

          {loading && <div className="mt-4 text-sm text-neutral-400">読み込み中...</div>}

          {info?.ok === false && (
            <div className="mt-4">
              <Alert variant="danger">招待情報の取得に失敗: {info.error}</Alert>
            </div>
          )}

          {info?.ok === true && (
            <div className="mt-4 grid gap-1 text-sm text-neutral-200">
              <div className="text-xs text-neutral-400">
                status: <span className="text-neutral-200">{info.sessionStatus}</span>
                {info.endedAt ? <span> / endedAt: {info.endedAt}</span> : null}
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              disabled={entering || !token || !okInfo || okInfo.sessionStatus !== "active"}
              onClick={() => void enter()}
              variant="primary"
            >
              {entering ? "入室中..." : "入室"}
            </Button>
            {okInfo && okInfo.sessionStatus !== "active" && (
              <Alert variant="warning">このセッションは終了しています（入室できません）。</Alert>
            )}
          </div>

          {error && (
            <div className="mt-3">
              <Alert variant="danger">error: {error}</Alert>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
