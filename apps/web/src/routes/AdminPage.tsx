import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import Alert from "../components/ui/Alert";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Kbd from "../components/ui/Kbd";
import WsStatusPill from "../components/ui/WsStatusPill";
import { useLocalStorageString } from "../lib/useLocalStorage";
import { useSessionSocket, type AdminSnapshot, type ReelStatus, type ServerEvent } from "../lib/useSessionSocket";

type InviteEnterResponse =
  | { ok: false; error?: string }
  | { ok: true; role: "admin" | "mod"; sessionCode: string; redirectTo: string };

const BGM_TRACKS = [
  { label: "Credits", file: "OstCredits.ogg" },
  { label: "DemoTrailer", file: "OstDemoTrailer.ogg" },
  { label: "ReleaseTrailer", file: "OstReleaseTrailer.ogg" },
] as const;
type BgmTrackFile = (typeof BGM_TRACKS)[number]["file"];

type AudioRig = {
  bgm: HTMLAudioElement;
  bgmTrack: BgmTrackFile;
  bgmBaseVolume: number;
  duckCount: number;
  fanfareLoopTimer: number | null;
  fanfareActive: boolean;
  prepareSeqId: number;
  sfx: {
    coinDeposit: HTMLAudioElement;
    startupJingle: HTMLAudioElement;
    fanfare: HTMLAudioElement;
    scored: HTMLAudioElement;
    scoredWithJackpot: HTMLAudioElement;
    spinWin: HTMLAudioElement;
    jackpot: HTMLAudioElement;
    longStreakEnd: HTMLAudioElement;
  };
};

type CommitSummary = {
  seq: number;
  number: number;
  openedPlayers: number;
  newBingoNames: string[];
};

type BingoAnnounce = {
  names: string[];
  index: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function safeBgmTrack(input: string): BgmTrackFile {
  const found = BGM_TRACKS.find((t) => t.file === input)?.file;
  return found ?? BGM_TRACKS[1].file;
}

function safeStop(audio: HTMLAudioElement): void {
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // ignore
  }
}

function playToEnd(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", finish);
      resolve();
    };
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    try {
      audio.currentTime = 0;
      const p = audio.play();
      if (p) p.catch(finish);
    } catch {
      finish();
    }
  });
}

function countPlayersWithNumber(players: Array<{ card?: number[][] }>, n: number): number {
  if (!Number.isFinite(n)) return 0;
  let count = 0;
  for (const p of players) {
    const card = p.card;
    if (!card) continue;
    let found = false;
    for (const row of card) {
      if (row.includes(n)) {
        found = true;
        break;
      }
    }
    if (found) count += 1;
  }
  return count;
}

type DrawPreparedEvent = {
  type: "draw.prepared";
  preparedAt: number;
};

type DrawCommittedEvent = {
  type: "draw.committed";
  seq: number;
  number: number;
  newBingoIds?: string[];
};

function isDrawPreparedEvent(ev: ServerEvent | null): ev is DrawPreparedEvent {
  if (!ev) return false;
  if (ev.type !== "draw.prepared") return false;
  return typeof (ev as { preparedAt?: unknown }).preparedAt === "number";
}

function isDrawCommittedEvent(ev: ServerEvent | null): ev is DrawCommittedEvent {
  if (!ev) return false;
  if (ev.type !== "draw.committed") return false;
  const maybe = ev as { seq?: unknown; number?: unknown; newBingoIds?: unknown };
  if (typeof maybe.seq !== "number") return false;
  if (typeof maybe.number !== "number") return false;
  if (typeof maybe.newBingoIds !== "undefined" && !Array.isArray(maybe.newBingoIds)) return false;
  return true;
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

export default function AdminPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const code = params.code ?? "";
  const inviteToken = search.get("token") ?? "";

  const { snapshot, status, lastEvent } = useSessionSocket({ role: "admin", code });
  const view = useMemo(() => {
    if (!snapshot || snapshot.type !== "snapshot" || snapshot.ok !== true) return null;
    if ((snapshot as AdminSnapshot).role !== "admin") return null;
    return snapshot as AdminSnapshot;
  }, [snapshot]);
  const viewRef = useRef<AdminSnapshot | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [enterToken, setEnterToken] = useState(inviteToken);

  const [bgmTrack, setBgmTrack] = useLocalStorageString("cloverbingo:admin:bgmTrack", BGM_TRACKS[1].file);
  const [bgmVolume, setBgmVolume] = useLocalStorageString("cloverbingo:admin:bgmVolume", "0.35");
  const bgmVolumeValue = useMemo(() => clamp01(Number.parseFloat(bgmVolume)), [bgmVolume]);
  const bgmTrackFile = useMemo(() => safeBgmTrack(bgmTrack), [bgmTrack]);

  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioRef = useRef<AudioRig | null>(null);
  const prevReelRef = useRef<{ ten: ReelStatus; one: ReelStatus } | null>(null);
  const prevPreparedAtRef = useRef<number | null>(null);
  const bingoSeqRef = useRef(0);
  const bingoTimerRef = useRef<number | null>(null);
  const [lastCommit, setLastCommit] = useState<CommitSummary | null>(null);
  const [bingoAnnounce, setBingoAnnounce] = useState<BingoAnnounce | null>(null);
  useEffect(() => {
    prevPreparedAtRef.current = null;
    bingoSeqRef.current += 1;
    if (bingoTimerRef.current) window.clearTimeout(bingoTimerRef.current);
    bingoTimerRef.current = null;
    setLastCommit(null);
    setBingoAnnounce(null);
  }, [code]);
  const nextHint = useMemo(() => {
    if (!view) return "認証が必要（招待URLで入室）";
    if (view.sessionStatus !== "active") return "セッション終了";
    if (!view.pendingDraw) return "P (prepare)";
    const ten = view.pendingDraw.reel.ten;
    const one = view.pendingDraw.reel.one;
    if (ten === "idle" && one === "idle") return "W / A / S / D (GO)";
    if (ten === "spinning" || one === "spinning") return "自動停止中…";
    if (ten === "stopped" && one === "stopped") return "確定中…";
    return "P (prepare)";
  }, [view]);

  const tenReel = view?.pendingDraw?.reel.ten ?? "idle";
  const oneReel = view?.pendingDraw?.reel.one ?? "idle";
  const canOperate = Boolean(view && view.sessionStatus === "active");
  const canPrepare = Boolean(canOperate && view?.drawState !== "spinning");
  const canGo = Boolean(canOperate && view?.pendingDraw && tenReel === "idle" && oneReel === "idle");

  async function prepare() {
    setError(null);
    setLastAction("prepare");
    await postJson(`/api/admin/prepare?code=${encodeURIComponent(code)}`, {});
  }

  async function go() {
    setError(null);
    setLastAction("go");
    await postJson(`/api/admin/reel?code=${encodeURIComponent(code)}`, { action: "go" });
  }

  async function enter(token: string) {
    setEnterError(null);
    setEntering(true);
    try {
      const res = await postJson<InviteEnterResponse>("/api/invite/enter", { token });
      if (!res.ok) throw new Error(res.error ?? "enter failed");
      window.location.replace(res.redirectTo);
    } catch (err) {
      setEnterError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setEntering(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const current = viewRef.current;
      if (!current) return;
      if (current.sessionStatus !== "active") return;
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === "p") void prepare().catch((err) => setError(err instanceof Error ? err.message : "unknown error"));
      if (key === "w" || key === "a" || key === "s" || key === "d") {
        void go().catch((err) => setError(err instanceof Error ? err.message : "unknown error"));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [code]);

  function syncBgmVolume(aud: AudioRig) {
    aud.bgm.volume = aud.duckCount > 0 ? aud.bgmBaseVolume * 0.5 : aud.bgmBaseVolume;
  }

  function duckStart(aud: AudioRig) {
    aud.duckCount += 1;
    syncBgmVolume(aud);
  }

  function duckEnd(aud: AudioRig) {
    aud.duckCount = Math.max(0, aud.duckCount - 1);
    syncBgmVolume(aud);
  }

  function playOneShot(aud: AudioRig, key: keyof AudioRig["sfx"]) {
    const src = aud.sfx[key];
    const clip = src.cloneNode(true) as HTMLAudioElement;
    clip.volume = src.volume;

    duckStart(aud);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clip.removeEventListener("ended", finish);
      clip.removeEventListener("error", finish);
      duckEnd(aud);
    };
    clip.addEventListener("ended", finish);
    clip.addEventListener("error", finish);
    try {
      clip.currentTime = 0;
      const p = clip.play();
      if (p) p.catch(finish);
    } catch {
      finish();
    }
  }

  function cancelPrepareSequence(aud: AudioRig) {
    aud.prepareSeqId += 1;
    safeStop(aud.sfx.coinDeposit);
    safeStop(aud.sfx.startupJingle);
  }

  function stopFanfare(aud: AudioRig) {
    if (!aud.fanfareActive) return;
    aud.fanfareActive = false;
    if (aud.fanfareLoopTimer) window.clearInterval(aud.fanfareLoopTimer);
    aud.fanfareLoopTimer = null;
    safeStop(aud.sfx.fanfare);
    duckEnd(aud);
  }

  function startFanfare(aud: AudioRig) {
    if (aud.fanfareActive) return;
    aud.fanfareActive = true;
    duckStart(aud);
    try {
      aud.sfx.fanfare.currentTime = 0;
      void aud.sfx.fanfare.play();
    } catch {
      // ignore
    }
    aud.fanfareLoopTimer = window.setInterval(() => {
      try {
        if (aud.sfx.fanfare.paused) return;
        if (aud.sfx.fanfare.currentTime >= 7) aud.sfx.fanfare.currentTime = 0;
      } catch {
        // ignore
      }
    }, 120);
  }

  useEffect(() => {
    if (!audioEnabled) return;
    const aud = audioRef.current;
    if (!aud) return;
    aud.bgmBaseVolume = bgmVolumeValue;
    syncBgmVolume(aud);
  }, [audioEnabled, bgmVolumeValue]);

  useEffect(() => {
    if (!audioEnabled) return;
    const aud = audioRef.current;
    if (!aud) return;
    if (aud.bgmTrack === bgmTrackFile) return;
    aud.bgmTrack = bgmTrackFile;
    try {
      aud.bgm.pause();
    } catch {
      // ignore
    }
    aud.bgm.src = `/bgm/${bgmTrackFile}`;
    aud.bgm.loop = true;
    syncBgmVolume(aud);
    void aud.bgm.play().catch(() => {
      // ignore
    });
  }, [audioEnabled, bgmTrackFile]);

  useEffect(() => {
    if (!audioEnabled) return;
    const aud = audioRef.current;
    if (!aud) return;
    const ev = lastEvent as ServerEvent | null;
    if (!isDrawPreparedEvent(ev)) return;
    if (prevPreparedAtRef.current === ev.preparedAt) return;
    prevPreparedAtRef.current = ev.preparedAt;

    void (async () => {
      cancelPrepareSequence(aud);
      const seqId = aud.prepareSeqId;
      duckStart(aud);
      try {
        for (let i = 0; i < 3; i += 1) {
          if (audioRef.current !== aud) return;
          if (aud.prepareSeqId !== seqId) return;
          await playToEnd(aud.sfx.coinDeposit);
        }
        if (audioRef.current !== aud) return;
        if (aud.prepareSeqId !== seqId) return;
        await playToEnd(aud.sfx.startupJingle);
      } finally {
        duckEnd(aud);
      }
    })();
  }, [audioEnabled, lastEvent]);

  useEffect(() => {
    const aud = audioRef.current;
    const current = view?.pendingDraw?.reel ?? null;
    const prev = prevReelRef.current;

    const spinning = Boolean(current && (current.ten === "spinning" || current.one === "spinning"));
    const wasSpinning = Boolean(prev && (prev.ten === "spinning" || prev.one === "spinning"));

    if (!audioEnabled || !aud) {
      if (aud) stopFanfare(aud);
      prevReelRef.current = current ? { ten: current.ten, one: current.one } : null;
      return;
    }

    if (!wasSpinning && spinning) cancelPrepareSequence(aud);

    if (spinning) startFanfare(aud);
    else stopFanfare(aud);

    const willNewBingo = Boolean(view?.pendingDraw && view?.stats && view.pendingDraw.impact.bingoPlayers > view.stats.bingoPlayers);
    const scoredKey = willNewBingo ? "scoredWithJackpot" : "scored";

    if (prev && current) {
      if (prev.ten === "spinning" && current.ten === "stopped") playOneShot(aud, scoredKey);
      if (prev.one === "spinning" && current.one === "stopped") playOneShot(aud, scoredKey);
    }

    prevReelRef.current = current ? { ten: current.ten, one: current.one } : null;
  }, [audioEnabled, view?.pendingDraw?.reel.ten, view?.pendingDraw?.reel.one, view?.pendingDraw?.impact.bingoPlayers, view?.stats?.bingoPlayers]);

  useEffect(() => {
    const ev = lastEvent as ServerEvent | null;
    if (!isDrawCommittedEvent(ev)) return;

    const currentView = viewRef.current;
    const openedPlayers = countPlayersWithNumber(currentView?.players ?? [], ev.number);
    const newBingoNames = Array.isArray(ev.newBingoIds)
      ? ev.newBingoIds.map((id) => currentView?.players?.find((p) => p.id === id)?.displayName ?? id)
      : [];

    setLastCommit({ seq: ev.seq, number: ev.number, openedPlayers, newBingoNames });

    bingoSeqRef.current += 1;
    const seqId = bingoSeqRef.current;
    if (bingoTimerRef.current) window.clearTimeout(bingoTimerRef.current);
    bingoTimerRef.current = null;
    setBingoAnnounce(newBingoNames.length ? { names: newBingoNames, index: 0 } : null);

    const aud = audioRef.current;
    if (aud) {
      playOneShot(aud, "spinWin");
      if (newBingoNames.length > 0) playOneShot(aud, "jackpot");
    }

    if (newBingoNames.length > 0) {
      const stepMs = 1400;
      const showIndex = (idx: number) => {
        if (bingoSeqRef.current !== seqId) return;
        setBingoAnnounce({ names: newBingoNames, index: idx });
        if (idx >= newBingoNames.length - 1) {
          bingoTimerRef.current = window.setTimeout(() => {
            if (bingoSeqRef.current !== seqId) return;
            setBingoAnnounce(null);
            if (newBingoNames.length >= 2) {
              const nextAud = audioRef.current;
              if (nextAud) playOneShot(nextAud, "longStreakEnd");
            }
          }, stepMs);
          return;
        }
        bingoTimerRef.current = window.setTimeout(() => showIndex(idx + 1), stepMs);
      };
      bingoTimerRef.current = window.setTimeout(() => showIndex(0), 0);
    }
  }, [lastEvent]);

  useEffect(() => {
    return () => {
      if (bingoTimerRef.current) window.clearTimeout(bingoTimerRef.current);
      const aud = audioRef.current;
      if (!aud) return;
      stopFanfare(aud);
      safeStop(aud.bgm);
      for (const sfx of Object.values(aud.sfx)) safeStop(sfx);
      audioRef.current = null;
    };
  }, []);

  async function enableAudio() {
    setError(null);
    try {
      const bgm = new Audio(`/bgm/${bgmTrackFile}`);
      bgm.loop = true;

      const rig: AudioRig = {
        bgm,
        bgmTrack: bgmTrackFile,
        bgmBaseVolume: bgmVolumeValue,
        duckCount: 0,
        fanfareLoopTimer: null,
        fanfareActive: false,
        prepareSeqId: 0,
        sfx: {
          coinDeposit: new Audio("/sfx/SoundCoinDeposit.ogg"),
          startupJingle: new Audio("/sfx/SoundSlotMachineStartupJingle.ogg"),
          fanfare: new Audio("/sfx/SoundSlotMachineFanfare.ogg"),
          scored: new Audio("/sfx/SoundSlotMachineScored.ogg"),
          scoredWithJackpot: new Audio("/sfx/SoundSlotMachineScoredWithJackpot.ogg"),
          spinWin: new Audio("/sfx/SoundSlotMachineSpinWin.ogg"),
          jackpot: new Audio("/sfx/SoundSlotMachineJackpot.ogg"),
          longStreakEnd: new Audio("/sfx/SoundSlotMachineLongStreakEndAnticipation.ogg"),
        },
      };

      rig.sfx.coinDeposit.volume = 1.0;
      rig.sfx.startupJingle.volume = 1.0;
      rig.sfx.fanfare.volume = 0.95;
      rig.sfx.scored.volume = 1.0;
      rig.sfx.scoredWithJackpot.volume = 1.0;
      rig.sfx.spinWin.volume = 0.95;
      rig.sfx.jackpot.volume = 1.0;
      rig.sfx.longStreakEnd.volume = 1.0;

      audioRef.current = rig;
      setAudioEnabled(true);

      // Unlock audio on user gesture
      syncBgmVolume(rig);
      await rig.bgm.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to enable audio");
      setAudioEnabled(false);
      audioRef.current = null;
    }
  }

  async function endSession() {
    setError(null);
    try {
      if (!window.confirm("セッションを終了します。以後、全操作は無効になります。よろしいですか？")) return;
      setLastAction("end");
      await postJson(`/api/admin/end?code=${encodeURIComponent(code)}`, {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
            <div className="mt-1 text-sm text-neutral-400">
              セッション: <span className="font-mono text-neutral-200">{code}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <div className="flex flex-wrap items-center gap-1">
                <Kbd>P</Kbd> <span>prepare</span>
              </div>
              <span className="text-neutral-700">/</span>
              <div className="flex flex-wrap items-center gap-1">
                <Kbd>W</Kbd> <Kbd>A</Kbd> <Kbd>S</Kbd> <Kbd>D</Kbd> <span>GO</span>
              </div>
            </div>
            <div className="mt-2">
              <Badge variant="warning">next: {nextHint}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <WsStatusPill status={status} />
            <Badge>last: {view?.lastNumber ?? "—"}</Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          {!view && (
            <Card>
              <h2 className="text-base font-semibold">入室（認証）</h2>
              <p className="mt-2 text-sm text-neutral-300">
                招待リンクの token を使って入室してください（cookieに保存します）。入室後は URL から token を外しても動きます。
              </p>
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

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">抽選操作</h2>
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <span>lastAction:</span>
                <span className="font-mono text-neutral-200">{lastAction ?? "—"}</span>
              </div>
            </div>

            {!audioEnabled && (
              <div className="mt-4">
                <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-3">
                  <div>音を出すには「音を有効化」を一度押してください（ブラウザの自動再生制限のため）。</div>
                  <Button onClick={() => void enableAudio()} size="sm" variant="primary">
                    音を有効化
                  </Button>
                </Alert>
              </div>
            )}

            {audioEnabled && (
              <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-300">
                  <div className="text-neutral-500">BGM</div>
                  <select
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
                    value={bgmTrackFile}
                    onChange={(e) => setBgmTrack(e.target.value)}
                  >
                    {BGM_TRACKS.map((t) => (
                      <option key={t.file} value={t.file}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <div className="text-neutral-500">vol</div>
                    <input type="range" min={0} max={1} step={0.05} value={bgmVolumeValue} onChange={(e) => setBgmVolume(e.target.value)} />
                    <div className="w-10 text-right font-mono text-neutral-200">{bgmVolumeValue.toFixed(2)}</div>
                  </div>
                  <div className="text-neutral-500">ducking</div>
                  <div className="font-mono text-neutral-200">50%</div>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={() => void prepare().catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!canPrepare}
                variant="primary"
              >
                P / Prepare
              </Button>
              <Button
                onClick={() => void go().catch((err) => setError(err instanceof Error ? err.message : "unknown error"))}
                disabled={!canGo}
                variant="secondary"
              >
                W/A/S/D / GO
              </Button>
              <Button
                onClick={() => void endSession()}
                disabled={!canOperate}
                variant="destructive"
              >
                セッション終了
              </Button>
            </div>

            {error && (
              <div className="mt-3">
                <Alert variant="danger">error: {error}</Alert>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
              <div>
                status: <span className="text-neutral-200">{view?.sessionStatus ?? "—"}</span>
                {view?.endedAt ? <span> / endedAt: {view.endedAt}</span> : null}
              </div>
              <div>
                drawState: <span className="text-neutral-200">{view?.drawState ?? "—"}</span>
              </div>
              <div>
                stats: reach <span className="text-neutral-200">{view?.stats?.reachPlayers ?? "—"}</span> / bingo{" "}
                <span className="text-neutral-200">{view?.stats?.bingoPlayers ?? "—"}</span>
              </div>
              <div>
                audio: <span className={audioEnabled ? "text-emerald-200" : "text-amber-200"}>{audioEnabled ? "enabled" : "disabled"}</span>
              </div>
            </div>

            {lastCommit && (
              <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
                <div className="text-xs text-neutral-500">直近確定</div>
                <div className="mt-2 flex flex-wrap items-baseline gap-4">
                  <div className="font-mono text-3xl text-neutral-50">{lastCommit.number}</div>
                  <div className="text-sm text-neutral-300">
                    解放: <span className="font-mono text-neutral-200">{lastCommit.openedPlayers}</span>人
                  </div>
                  {lastCommit.newBingoNames.length > 0 && (
                    <div className="text-sm text-amber-200">NEW BINGO: {lastCommit.newBingoNames.length}人</div>
                  )}
                </div>
                {bingoAnnounce && (
                  <div className="mt-3 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
                    <div className="text-xs text-amber-200">BINGO</div>
                    <div className="mt-1 text-xl font-semibold text-amber-100">{bingoAnnounce.names[bingoAnnounce.index] ?? "?"}</div>
                    <div className="mt-1 text-xs text-amber-200/80">
                      {bingoAnnounce.index + 1} / {bingoAnnounce.names.length}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
              <div className="text-xs text-neutral-400">pendingDraw</div>
              {view?.pendingDraw ? (
                <div className="mt-2 grid gap-1 text-sm">
                  <div>
                    次番号（Adminのみ）: <span className="font-mono text-2xl text-neutral-50">{view.pendingDraw.number}</span>
                  </div>
                  <div className="text-xs text-neutral-400">
                    impact: reachPlayers={view.pendingDraw.impact.reachPlayers}, bingoPlayers={view.pendingDraw.impact.bingoPlayers}
                  </div>
                  <div className="text-xs text-neutral-400">
                    reel: ten={view.pendingDraw.reel.ten}, one={view.pendingDraw.reel.one}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-neutral-400">（未prepare）</div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
