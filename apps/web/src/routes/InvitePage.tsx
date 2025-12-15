import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

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
        <p className="mt-2 text-sm text-neutral-300">
          招待URLの GET では副作用（cookie付与）を起こしません。入室するには、下の「入室」ボタンを押してください（POSTで cookie を付与します）。
        </p>

        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
          <div className="text-xs text-neutral-500">token</div>
          <div className="mt-1 break-all font-mono text-xs text-neutral-200">{token || "（空）"}</div>

          {loading && <div className="mt-4 text-sm text-neutral-400">読み込み中...</div>}

          {info?.ok === false && (
            <div className="mt-4 rounded-lg border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-200">
              招待情報の取得に失敗: {info.error}
            </div>
          )}

          {info?.ok === true && (
            <div className="mt-4 grid gap-1 text-sm text-neutral-200">
              <div>
                role: <span className="font-semibold">{info.role}</span> {info.label ? <span className="text-xs text-neutral-400">({info.label})</span> : null}
              </div>
              <div>
                session: <span className="font-mono">{info.sessionCode}</span>
              </div>
              <div className="text-xs text-neutral-400">
                status: <span className="text-neutral-200">{info.sessionStatus}</span>
                {info.endedAt ? <span> / endedAt: {info.endedAt}</span> : null}
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
              disabled={entering || !token || info?.ok !== true || info.sessionStatus !== "active"}
              onClick={() => void enter()}
              type="button"
            >
              {entering ? "入室中..." : "入室"}
            </button>
            {info?.ok === true && info.sessionStatus !== "active" && <span className="text-sm text-amber-200">このセッションは終了しています。</span>}
          </div>

          {error && <div className="mt-3 text-sm text-red-200">error: {error}</div>}
        </div>
      </div>
    </main>
  );
}

