import { useMemo, useState } from "react";

import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Alert from "../components/ui/Alert";

type DevCreateSessionResponse =
  | { ok: false; error?: string }
  | {
      ok: true;
      sessionCode: string;
      adminToken: string;
      modToken: string;
      observerToken: string;
      urls: {
        join: string;
        displayTen: string;
        displayOne: string;
        adminInvite: string;
        modInvite: string;
        observerInvite: string;
        admin: string;
        mod: string;
        observer: string;
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
  const [copied, setCopied] = useState<string | null>(null);
  const links = useMemo(() => {
    if (!session || !("ok" in session) || session.ok !== true) return null;
    return {
      join: abs(session.urls.join),
      displayTen: abs(session.urls.displayTen),
      displayOne: abs(session.urls.displayOne),
      adminInvite: abs(session.urls.adminInvite),
      modInvite: abs(session.urls.modInvite),
      observerInvite: abs(session.urls.observerInvite),
      admin: abs(session.urls.admin),
      mod: abs(session.urls.mod),
      observer: abs(session.urls.observer),
      compatAdmin: session.urls.compatAdmin ? abs(session.urls.compatAdmin) : null,
      compatMod: session.urls.compatMod ? abs(session.urls.compatMod) : null,
    };
  }, [session]);

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 1200);
    } catch {
      // ignore
    }
  }

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
        <p className="mt-2 text-sm text-neutral-300">ローカル開発用の入口です。まずは Dev セッションを作って、各画面を開いてください。</p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button disabled={creating} onClick={createSession} variant="primary">
            {creating ? "作成中..." : "Dev: セッション作成"}
          </Button>
          <a className="text-sm text-neutral-300 underline hover:text-neutral-100" href="/s/demo">
            例: /s/demo（未初期化だと404になります）
          </a>
        </div>

        {session?.ok === false && (
          <div className="mt-6">
            <Alert variant="danger">作成に失敗: {session.error ?? "unknown"}</Alert>
          </div>
        )}

        {links && session && session.ok === true && (
          <Card className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">セッション {session.sessionCode}</h2>
              <div className="text-xs text-neutral-400">
                招待リンク（/i/:token）は GET で副作用なし。開いたら「入室」を押してください（POSTでcookie付与）。
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-sm">
              {(
                [
                  { key: "join", label: "参加者", href: links.join, newTab: false },
                  { key: "displayTen", label: "会場表示（十の位）", href: links.displayTen, newTab: true },
                  { key: "displayOne", label: "会場表示（一の位）", href: links.displayOne, newTab: true },
                  { key: "adminInvite", label: "Admin招待", href: links.adminInvite, newTab: true },
                  { key: "modInvite", label: "Mod招待", href: links.modInvite, newTab: true },
                  { key: "observerInvite", label: "Observer招待", href: links.observerInvite, newTab: true },
                ] as const
              ).map((row) => (
                <div key={row.key} className="flex items-stretch gap-2">
                  <a
                    className="flex-1 rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 hover:bg-neutral-950/70"
                    href={row.href}
                    target={row.newTab ? "_blank" : undefined}
                    rel={row.newTab ? "noreferrer" : undefined}
                  >
                    <div className="text-xs text-neutral-400">{row.label}</div>
                    <div className="mt-1 break-all font-mono text-xs text-neutral-200">{row.href}</div>
                  </a>
                  <Button
                    className="shrink-0"
                    onClick={() => void copyToClipboard(row.href, row.key)}
                    size="sm"
                    variant="secondary"
                    title="コピー"
                    type="button"
                  >
                    {copied === row.key ? "コピー済" : "コピー"}
                  </Button>
                </div>
              ))}
              <details className="rounded-md border border-neutral-800 bg-neutral-950/20 px-3 py-2">
                <summary className="cursor-pointer text-xs text-neutral-300">互換リンク（token付き直リンク）</summary>
                <div className="mt-2 grid gap-2 text-xs">
                  <a className="break-all text-neutral-300 underline hover:text-neutral-100" href={links.admin} target="_blank" rel="noreferrer">
                    Admin: {links.admin}
                  </a>
                  <a className="break-all text-neutral-300 underline hover:text-neutral-100" href={links.mod} target="_blank" rel="noreferrer">
                    Mod: {links.mod}
                  </a>
                  <a className="break-all text-neutral-300 underline hover:text-neutral-100" href={links.observer} target="_blank" rel="noreferrer">
                    Observer: {links.observer}
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
          </Card>
        )}

        <div className="mt-10 text-xs text-neutral-500">
          API: <code>/api/dev/create-session</code> / WS: <code>/api/ws</code>
        </div>
      </div>
    </main>
  );
}
