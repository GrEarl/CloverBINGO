import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { cn } from "../lib/cn";

function toggleParam(searchParams: URLSearchParams, key: string, onValue: string, offValue: string) {
  const next = new URLSearchParams(searchParams);
  const current = next.get(key);
  next.set(key, current === onValue ? offValue : onValue);
  return next;
}

export default function DevDeckPage() {
  const params = useParams();
  const code = params.code ?? "";
  const [searchParams, setSearchParams] = useSearchParams();

  const safe = searchParams.get("safe") === "1";
  const fx = searchParams.get("fx") !== "0";

  const urls = useMemo(() => {
    const codeEnc = encodeURIComponent(code);
    const displayQuery = `?fx=${fx ? "1" : "0"}&safe=${safe ? "1" : "0"}`;
    return {
      ten: `/s/${codeEnc}/display/ten${displayQuery}`,
      one: `/s/${codeEnc}/display/one${displayQuery}`,
      admin: `/s/${codeEnc}/admin?dev=1`,
      mod: `/s/${codeEnc}/mod`,
      participant: `/s/${codeEnc}`,
    };
  }, [code, fx, safe]);

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

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Display（十の位）</div>
              <a className="text-xs text-neutral-300 underline hover:text-neutral-100" href={urls.ten} target="_blank" rel="noreferrer">
                別タブで開く
              </a>
            </div>
            <div className="mt-3 aspect-[16/9] w-full overflow-hidden rounded-md border border-neutral-800 bg-black">
              <iframe className="h-full w-full" src={urls.ten} title="display-ten" />
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
              <iframe className="h-full w-full" src={urls.one} title="display-one" />
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
              <iframe className="h-full w-full" src={urls.admin} title="admin" />
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

