import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import { cn } from "../lib/cn";

type InviteEnterResponse =
  | { ok: false; error?: string }
  | { ok: true; role: "admin" | "mod" | "observer"; sessionCode: string; redirectTo: string };

function toggleParam(searchParams: URLSearchParams, key: string, onValue: string, offValue: string) {
  const next = new URLSearchParams(searchParams);
  const current = next.get(key);
  next.set(key, current === onValue ? offValue : onValue);
  return next;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `request failed (${res.status})`);
  return (await res.json()) as T;
}

export default function DevDeckPage() {
  const params = useParams();
  const code = params.code ?? "";
  const [searchParams, setSearchParams] = useSearchParams();

  const safe = searchParams.get("safe") === "1";
  const fx = searchParams.get("fx") !== "0";

  const [enterToken, setEnterToken] = useState("");
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [frameNonce, setFrameNonce] = useState(0);

  const urls = useMemo(() => {
    const codeEnc = encodeURIComponent(code);
    const displayQuery = `?fx=${fx ? "1" : "0"}&safe=${safe ? "1" : "0"}`;
    return {
      ten: `/s/${codeEnc}/display/ten${displayQuery}`,
      one: `/s/${codeEnc}/display/one${displayQuery}`,
      admin: `/s/${codeEnc}/admin?dev=1`,
      mod: `/s/${codeEnc}/mod`,
      observer: `/s/${codeEnc}/observer`,
      participant: `/s/${codeEnc}`,
    };
  }, [code, fx, safe]);

  async function enter() {
    const token = enterToken.trim();
    if (!token) return;
    setEntering(true);
    setEnterError(null);
    try {
      const res = await postJson<InviteEnterResponse>("/api/invite/enter", { token });
      if (!res.ok) throw new Error(res.error ?? "enter failed");
      setFrameNonce((n) => n + 1);
      setEnterToken("");
    } catch (err) {
      setEnterError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setEntering(false);
    }
  }

  if (!code.trim()) {
    return (
      <main className="min-h-dvh bg-neutral-950 text-neutral-50">
        <div className="mx-auto max-w-xl px-6 py-10">
          <h1 className="text-2xl font-semibold tracking-tight">Devデッキ</h1>
          <p className="mt-2 text-sm text-neutral-300">URLが不正です（/s/:code/dev）。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Devデッキ</h1>
            <div className="mt-1 text-sm text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span>
            </div>
            <div className="mt-2 text-xs text-neutral-500">1画面で display ten/one + admin を検証するためのページです。</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setSearchParams(toggleParam(searchParams, "safe", "1", "0"))} size="sm" variant={safe ? "primary" : "secondary"}>
              safe={safe ? "1" : "0"}
            </Button>
            <Button onClick={() => setSearchParams(toggleParam(searchParams, "fx", "0", "1"))} size="sm" variant={!fx ? "primary" : "secondary"}>
              fx={fx ? "1" : "0"}
            </Button>
            <a className="text-xs text-neutral-300 underline hover:text-neutral-100" href="/showcase" target="_blank" rel="noreferrer">
              演出ショーケース
            </a>
          </div>
        </div>

        <div className="mt-4">
          <Card className="p-3">
            <div className="text-sm font-semibold">入室（招待token）</div>
            <div className="mt-1 text-xs text-neutral-500">Admin/Mod 招待リンク（/i/:token）の token を貼り付けて入室（cookie付与）します。</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input className="min-w-[280px] flex-1" value={enterToken} onChange={(e) => setEnterToken(e.target.value)} placeholder="token を貼り付け" />
              <Button disabled={entering || enterToken.trim().length === 0} onClick={() => void enter()} size="sm" variant="primary">
                {entering ? "入室中..." : "入室してデッキ更新"}
              </Button>
            </div>
            {enterError && <div className="mt-2 text-xs text-red-300">入室に失敗: {enterError}</div>}
          </Card>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Display（十の位）</div>
              <a className="text-xs text-neutral-300 underline hover:text-neutral-100" href={urls.ten} target="_blank" rel="noreferrer">
                別タブで開く
              </a>
            </div>
            <div className="mt-3 aspect-[16/9] w-full overflow-hidden rounded-md border border-neutral-800 bg-black">
              <iframe key={`ten:${frameNonce}`} className="h-full w-full" src={urls.ten} title="display-ten" />
            </div>
          </Card>

          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Display（一の位）</div>
              <a className="text-xs text-neutral-300 underline hover:text-neutral-100" href={urls.one} target="_blank" rel="noreferrer">
                別タブで開く
              </a>
            </div>
            <div className="mt-3 aspect-[16/9] w-full overflow-hidden rounded-md border border-neutral-800 bg-black">
              <iframe key={`one:${frameNonce}`} className="h-full w-full" src={urls.one} title="display-one" />
            </div>
          </Card>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_360px] lg:items-start">
          <Card className={cn("p-3", "lg:order-1")}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Admin（音響/DevTools）</div>
              <a className="text-xs text-neutral-300 underline hover:text-neutral-100" href={urls.admin} target="_blank" rel="noreferrer">
                別タブで開く
              </a>
            </div>
            <div className="mt-3 h-[44vh] min-h-[420px] w-full overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
              <iframe key={`admin:${frameNonce}`} className="h-full w-full" src={urls.admin} title="admin" />
            </div>
            <div className="mt-2 text-xs text-neutral-500">音を出すには、上のAdmin内で「音を有効化」をクリックしてください（ブラウザ制約）。</div>
          </Card>

          <Card className={cn("p-3", "lg:order-2")}>
            <div className="text-sm font-semibold">リンク</div>
            <div className="mt-3 grid gap-2 text-xs">
              <a className="break-all text-neutral-300 underline hover:text-neutral-100" href={urls.participant} target="_blank" rel="noreferrer">
                参加者: {urls.participant}
              </a>
              <a className="break-all text-neutral-300 underline hover:text-neutral-100" href={urls.mod} target="_blank" rel="noreferrer">
                Mod: {urls.mod}
              </a>
              <a className="break-all text-neutral-300 underline hover:text-neutral-100" href={urls.observer} target="_blank" rel="noreferrer">
                Observer: {urls.observer}
              </a>
              <div className="rounded-md border border-neutral-800 bg-neutral-950/40 p-2 text-neutral-400">
                Tips: Adminで <span className="font-mono text-neutral-200">?dev=1</span> を付けると DevTools が表示されます。
              </div>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
