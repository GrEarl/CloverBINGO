import { useMemo, useState } from "react";

type DevCreateSessionResponse =
  | { ok: false; error?: string }
  | {
      ok: true;
      sessionCode: string;
      adminToken: string;
      modToken: string;
      urls: {
        join: string;
        displayTen: string;
        displayOne: string;
        adminInvite: string;
        modInvite: string;
        admin: string;
        mod: string;
        compatAdmin?: string;
        compatMod?: string;
      };
    };

function abs(path: string): string {
  return new URL(path, window.location.origin).toString();
}

export default function HomePage() {
  const [creating, setCreating] = useState(false);
  const [session, setSession] = useState<DevCreateSessionResponse | null>(null);
  const links = useMemo(() => {
    if (!session || !("ok" in session) || session.ok !== true) return null;
    return {
      join: abs(session.urls.join),
      displayTen: abs(session.urls.displayTen),
      displayOne: abs(session.urls.displayOne),
      adminInvite: abs(session.urls.adminInvite),
      modInvite: abs(session.urls.modInvite),
      admin: abs(session.urls.admin),
      mod: abs(session.urls.mod),
      compatAdmin: session.urls.compatAdmin ? abs(session.urls.compatAdmin) : null,
      compatMod: session.urls.compatMod ? abs(session.urls.compatMod) : null,
    };
  }, [session]);

  async function createSession() {
    setCreating(true);
    setSession(null);
    try {
      const res = await fetch("/api/dev/create-session", { method: "POST" });
      const json = (await res.json()) as DevCreateSessionResponse;
      setSession(json);
    } catch (err) {
      setSession({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">CloverBINGO</h1>
        <p className="mt-2 text-sm text-neutral-300">
          ローカルMVP用の入口です。まずは dev セッションを作って、各画面を開いてください。
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
            disabled={creating}
            onClick={createSession}
            type="button"
          >
            {creating ? "作成中..." : "Dev: セッション作成"}
          </button>
          <a className="text-sm text-neutral-300 underline hover:text-neutral-100" href="/s/demo">
            例: /s/demo（未初期化だと404になります）
          </a>
        </div>

        {session?.ok === false && (
          <div className="mt-6 rounded-lg border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-200">
            作成に失敗: {session.error ?? "unknown"}
          </div>
        )}

        {links && session.ok === true && (
          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">セッション {session.sessionCode}</h2>
            <div className="text-xs text-neutral-400">
                招待リンク（/i/:token）は GET で副作用なし。開いたら「入室」を押してください（POSTでcookie付与）。
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-sm">
            <a className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 hover:bg-neutral-950/70" href={links.join}>
              参加者: {links.join}
            </a>
              <a
                className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 hover:bg-neutral-950/70"
                href={links.displayTen}
                target="_blank"
                rel="noreferrer"
              >
                会場表示（十の位）: {links.displayTen}
              </a>
              <a
                className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 hover:bg-neutral-950/70"
                href={links.displayOne}
                target="_blank"
                rel="noreferrer"
              >
                会場表示（一の位）: {links.displayOne}
              </a>
              <a
                className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 hover:bg-neutral-950/70"
                href={links.adminInvite}
                target="_blank"
                rel="noreferrer"
              >
                Admin招待: {links.adminInvite}
              </a>
              <a className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 hover:bg-neutral-950/70" href={links.modInvite} target="_blank" rel="noreferrer">
                Mod招待: {links.modInvite}
              </a>
              <details className="rounded-md border border-neutral-800 bg-neutral-950/20 px-3 py-2">
                <summary className="cursor-pointer text-xs text-neutral-300">互換リンク（token付き直リンク）</summary>
                <div className="mt-2 grid gap-2 text-xs">
                  <a className="break-all text-neutral-300 underline hover:text-neutral-100" href={links.admin} target="_blank" rel="noreferrer">
                    Admin: {links.admin}
                  </a>
                  <a className="break-all text-neutral-300 underline hover:text-neutral-100" href={links.mod} target="_blank" rel="noreferrer">
                    Mod: {links.mod}
                  </a>
                  {links.compatAdmin && (
                    <a className="break-all text-neutral-400 underline hover:text-neutral-200" href={links.compatAdmin} target="_blank" rel="noreferrer">
                      （旧）/admin: {links.compatAdmin}
                    </a>
                  )}
                  {links.compatMod && (
                    <a className="break-all text-neutral-400 underline hover:text-neutral-200" href={links.compatMod} target="_blank" rel="noreferrer">
                      （旧）/mod: {links.compatMod}
                    </a>
                  )}
                </div>
              </details>
            </div>
          </div>
        )}

        <div className="mt-10 text-xs text-neutral-500">
          API: <code>/api/dev/create-session</code> / WS: <code>/api/ws</code>
        </div>
      </div>
    </main>
  );
}
