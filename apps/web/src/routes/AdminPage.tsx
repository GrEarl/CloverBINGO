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

// Ducking: reduce BGM while any SFX is active. "75%" here means ~75% reduction (i.e. keep 25% volume).
const DUCKING_GAIN = 0.25;

// Trim trailing silence (measured with ffmpeg silencedetect) to avoid long dead-air at track ends.
const BGM_TRIM: Record<BgmTrackFile, { endSec: number }> = {
  "OstCredits.ogg": { endSec: 94.626009 },
  "OstDemoTrailer.ogg": { endSec: 58.917619 },
  "OstReleaseTrailer.ogg": { endSec: 74.309206 },
};

const SFX_LABELS: Record<keyof AudioRig["sfx"], string> = {
  coinDeposit: "コイン",
  startupJingle: "スタート",
  fanfare: "ファンファーレ",
  scored: "停止",
  scoredWithJackpot: "停止(JACKPOT)",
  spinWin: "解放",
  jackpot: "ビンゴ",
  longStreakEnd: "フィニッシュ",
};

type AudioRig = {
  bgm: HTMLAudioElement;
  bgmPlaylist: readonly BgmTrackFile[];
  bgmIndex: number;
  bgmOnEnded: (() => void) | null;
  bgmTrimTimer: number | null;
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

type ReachIntensity = 0 | 1 | 2 | 3;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function bgmLabel(file: BgmTrackFile): string {
  return BGM_TRACKS.find((t) => t.file === file)?.label ?? file;
}

function reachIntensityFromCount(reachCount: number | null | undefined): ReachIntensity {
  if (typeof reachCount !== "number" || !Number.isFinite(reachCount)) return 0;
  if (reachCount <= 1) return 0;
  if (reachCount <= 4) return 1;
  if (reachCount <= 8) return 2;
  return 3;
}

function spinTimingForIntensity(intensity: ReachIntensity): { totalMaxMs: number; gapMinMs: number; gapMaxMs: number } {
  const totalMaxMs = [3000, 3600, 4200, 4800][intensity];
  const teaseDelayMin = [0, 150, 250, 450][intensity];
  const teaseDelayMax = [0, 250, 450, 650][intensity];
  const holdMin = [0, 120, 220, 380][intensity];
  const holdMax = [0, 220, 380, 520][intensity];
  const baseGapMin = 350;
  const baseGapMax = 700;
  return {
    totalMaxMs,
    gapMinMs: baseGapMin + teaseDelayMin + holdMin,
    gapMaxMs: baseGapMax + teaseDelayMax + holdMax,
  };
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

function countPlayersWithNumber(players: Array<{ card?: number[][]; status?: string }>, n: number): number {
  if (!Number.isFinite(n)) return 0;
  let count = 0;
  for (const p of players) {
    if (p.status === "disabled") continue;
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
  const devMode = search.get("dev") === "1";

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
  const canSendAudioRef = useRef(false);
  useEffect(() => {
    canSendAudioRef.current = Boolean(view);
  }, [view]);

  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [enterToken, setEnterToken] = useState(inviteToken);

  const [bgmVolume, setBgmVolume] = useLocalStorageString("cloverbingo:admin:bgmVolume", "0.75");
  const bgmVolumeValue = useMemo(() => clamp01(Number.parseFloat(bgmVolume)), [bgmVolume]);
  const [sfxVolume, setSfxVolume] = useLocalStorageString("cloverbingo:admin:sfxVolume", "0.75");
  const sfxVolumeValue = useMemo(() => clamp01(Number.parseFloat(sfxVolume)), [sfxVolume]);

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

  const reachPlayers = view?.stats?.reachPlayers ?? null;
  const actualIntensity: ReachIntensity = (view?.fx?.actualReachIntensity ?? reachIntensityFromCount(reachPlayers)) as ReachIntensity;
  const intensityOverride = (view?.fx?.intensityOverride ?? null) as ReachIntensity | null;
  const effectiveIntensity: ReachIntensity = (view?.fx?.effectiveReachIntensity ?? (intensityOverride ?? actualIntensity)) as ReachIntensity;
  const timing = spinTimingForIntensity(effectiveIntensity);
  const willNewBingo = Boolean(view?.pendingDraw && view?.stats && view.pendingDraw.impact.bingoPlayers > view.stats.bingoPlayers);

  const [devBusy, setDevBusy] = useState(false);
  const [devSeedCount, setDevSeedCount] = useState("80");
  const [devSeedPrefix, setDevSeedPrefix] = useState("DEV");
  const [devForceNumber, setDevForceNumber] = useState("");

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

  async function devSeed() {
    setError(null);
    setDevBusy(true);
    setLastAction("dev.seed");
    try {
      await postJson(`/api/admin/dev/seed?code=${encodeURIComponent(code)}`, {
        count: Number.parseInt(devSeedCount, 10),
        prefix: devSeedPrefix,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setDevBusy(false);
    }
  }

  async function devReset() {
    setError(null);
    setDevBusy(true);
    setLastAction("dev.reset");
    try {
      const ok = window.confirm("Dev: 状態をリセットします（参加者/抽選履歴を削除し、必要なら active に戻します）。よろしいですか？");
      if (!ok) return;
      await postJson(`/api/admin/dev/reset?code=${encodeURIComponent(code)}`, { revive: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setDevBusy(false);
    }
  }

  async function devTune(next: ReachIntensity | null) {
    setError(null);
    setDevBusy(true);
    setLastAction("dev.tune");
    try {
      await postJson(`/api/admin/dev/tune?code=${encodeURIComponent(code)}`, { targetIntensity: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setDevBusy(false);
    }
  }

  async function devPrepareNumber() {
    setError(null);
    setDevBusy(true);
    setLastAction("dev.prepare");
    try {
      const num = Number.parseInt(devForceNumber, 10);
      if (!Number.isFinite(num)) {
        setError("Dev: number を入力してください（1..75）");
        return;
      }
      await postJson(`/api/admin/dev/prepare?code=${encodeURIComponent(code)}`, { number: num });
      setDevForceNumber("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setDevBusy(false);
    }
  }

  async function enter(token: string) {
    setEnterError(null);
    setEntering(true);
    try {
      const res = await postJson<InviteEnterResponse>("/api/invite/enter", { token });
      if (!res.ok) throw new Error(res.error ?? "enter failed");
      const next = new URL(res.redirectTo, window.location.origin);
      if (devMode) next.searchParams.set("dev", "1");
      window.location.replace(next.pathname + next.search);
    } catch (err) {
      setEnterError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setEntering(false);
    }
  }

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function onKeyDown(e: KeyboardEvent) {
      const current = viewRef.current;
      if (!current) return;
      if (current.sessionStatus !== "active") return;
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (key === "p") {
        if (current.drawState === "spinning") {
          sendKeyLog({ key, action: "prepare", allowed: false, reason: "spinning" });
          setError("回転中は Prepare できません。停止するまで待ってください。");
          return;
        }
        sendKeyLog({ key, action: "prepare", allowed: true });
        void prepare().catch((err) => setError(err instanceof Error ? err.message : "unknown error"));
        return;
      }
      if (key === "w" || key === "a" || key === "s" || key === "d") {
        const pending = current.pendingDraw;
        if (!pending) {
          sendKeyLog({ key, action: "go", allowed: false, reason: "no-pending" });
          setError("先に P / Prepare を押してください。");
          return;
        }
        if (pending.state !== "prepared" || pending.reel.ten !== "idle" || pending.reel.one !== "idle") {
          sendKeyLog({ key, action: "go", allowed: false, reason: "not-ready" });
          setError("抽選中のため GO できません。");
          return;
        }
        sendKeyLog({ key, action: "go", allowed: true });
        void go().catch((err) => setError(err instanceof Error ? err.message : "unknown error"));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [code]);

  function syncBgmVolume(aud: AudioRig) {
    aud.bgm.volume = aud.duckCount > 0 ? aud.bgmBaseVolume * DUCKING_GAIN : aud.bgmBaseVolume;
  }

  function syncSfxVolume(aud: AudioRig, volume: number) {
    const v = clamp01(volume);
    for (const clip of Object.values(aud.sfx)) {
      clip.volume = v;
    }
  }

  function duckStart(aud: AudioRig) {
    aud.duckCount += 1;
    syncBgmVolume(aud);
  }

  function duckEnd(aud: AudioRig) {
    aud.duckCount = Math.max(0, aud.duckCount - 1);
    syncBgmVolume(aud);
  }

  function sendAudioUpdate(payload: { bgm?: { label: string | null; state: "playing" | "paused" | "stopped" }; sfx?: { label: string | null } }) {
    if (!canSendAudioRef.current) return;
    void postJson(`/api/admin/audio?code=${encodeURIComponent(code)}`, payload).catch(() => {
      // ignore
    });
  }

  function sendKeyLog(payload: { key: string; action?: "prepare" | "go"; allowed?: boolean; reason?: string | null }) {
    void postJson(`/api/admin/key?code=${encodeURIComponent(code)}`, payload).catch(() => {
      // ignore
    });
  }

  function playOneShot(aud: AudioRig, key: keyof AudioRig["sfx"]) {
    const src = aud.sfx[key];
    const clip = src.cloneNode(true) as HTMLAudioElement;
    clip.volume = src.volume;

    sendAudioUpdate({ sfx: { label: SFX_LABELS[key] ?? key } });
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
    sendAudioUpdate({ sfx: { label: SFX_LABELS.fanfare } });
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

  function scheduleBgmTrim(aud: AudioRig) {
    if (aud.bgmTrimTimer) window.clearTimeout(aud.bgmTrimTimer);
    aud.bgmTrimTimer = null;

    const file = aud.bgmPlaylist[aud.bgmIndex];
    const trimEnd = BGM_TRIM[file]?.endSec;
    if (!trimEnd) return;

    const remainingMs = Math.max(0, Math.floor((trimEnd - aud.bgm.currentTime) * 1000));
    aud.bgmTrimTimer = window.setTimeout(() => {
      if (audioRef.current !== aud) return;
      aud.bgmTrimTimer = null;
      if (!aud.bgmOnEnded) return;
      aud.bgmOnEnded();
    }, remainingMs);
  }

  useEffect(() => {
    if (!audioEnabled) return;
    const aud = audioRef.current;
    if (!aud) return;
    aud.bgmBaseVolume = bgmVolumeValue;
    syncBgmVolume(aud);
    syncSfxVolume(aud, sfxVolumeValue);
  }, [audioEnabled, bgmVolumeValue, sfxVolumeValue]);

  useEffect(() => {
    if (!view || !audioEnabled) return;
    const aud = audioRef.current;
    if (!aud) return;
    sendAudioUpdate({ bgm: { label: bgmLabel(aud.bgmPlaylist[aud.bgmIndex]), state: "playing" } });
  }, [view, audioEnabled]);

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
        for (let i = 0; i < 1; i += 1) {
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
      sendAudioUpdate({ bgm: { label: null, state: "stopped" } });
      if (bingoTimerRef.current) window.clearTimeout(bingoTimerRef.current);
      const aud = audioRef.current;
      if (!aud) return;
      stopFanfare(aud);
      if (aud.bgmTrimTimer) window.clearTimeout(aud.bgmTrimTimer);
      aud.bgmTrimTimer = null;
      if (aud.bgmOnEnded) {
        aud.bgm.removeEventListener("ended", aud.bgmOnEnded);
        aud.bgm.removeEventListener("error", aud.bgmOnEnded);
        aud.bgmOnEnded = null;
      }
      safeStop(aud.bgm);
      for (const sfx of Object.values(aud.sfx)) safeStop(sfx);
      audioRef.current = null;
    };
  }, []);

  async function enableAudio() {
    setError(null);
    try {
      const playlist = BGM_TRACKS.map((t) => t.file);
      const bgm = new Audio(`/bgm/${playlist[0]}`);
      bgm.loop = false;
      bgm.preload = "auto";

      const rig: AudioRig = {
        bgm,
        bgmPlaylist: playlist,
        bgmIndex: 0,
        bgmOnEnded: null,
        bgmTrimTimer: null,
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

      syncSfxVolume(rig, sfxVolumeValue);

      rig.bgmOnEnded = () => {
        if (audioRef.current !== rig) return;
        rig.bgmIndex = (rig.bgmIndex + 1) % rig.bgmPlaylist.length;
        rig.bgm.src = `/bgm/${rig.bgmPlaylist[rig.bgmIndex]}`;
        rig.bgm.loop = false;
        syncBgmVolume(rig);
        void rig.bgm.play().catch(() => {
          // ignore
        });
        sendAudioUpdate({ bgm: { label: bgmLabel(rig.bgmPlaylist[rig.bgmIndex]), state: "playing" } });
        scheduleBgmTrim(rig);
      };
      rig.bgm.addEventListener("ended", rig.bgmOnEnded);
      rig.bgm.addEventListener("error", rig.bgmOnEnded);

      audioRef.current = rig;
      setAudioEnabled(true);

      // Unlock audio on user gesture
      syncBgmVolume(rig);
      await rig.bgm.play();
      sendAudioUpdate({ bgm: { label: bgmLabel(rig.bgmPlaylist[rig.bgmIndex]), state: "playing" } });
      scheduleBgmTrim(rig);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to enable audio");
      setAudioEnabled(false);
      audioRef.current = null;
      sendAudioUpdate({ bgm: { label: null, state: "stopped" } });
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
                  <div className="text-neutral-200">3曲ループ（{BGM_TRACKS.map((t) => t.label).join(" → ")}）</div>
                  <div className="flex items-center gap-2">
                    <div className="text-neutral-500">vol</div>
                    <input type="range" min={0} max={1} step={0.05} value={bgmVolumeValue} onChange={(e) => setBgmVolume(e.target.value)} />
                    <div className="w-10 text-right font-mono text-neutral-200">{bgmVolumeValue.toFixed(2)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-neutral-500">SFX</div>
                    <input type="range" min={0} max={1} step={0.05} value={sfxVolumeValue} onChange={(e) => setSfxVolume(e.target.value)} />
                    <div className="w-10 text-right font-mono text-neutral-200">{sfxVolumeValue.toFixed(2)}</div>
                  </div>
                  <div className="text-neutral-500">ducking</div>
                  <div className="font-mono text-neutral-200">75%</div>
                  <div className="text-neutral-500">trim</div>
                  <div className="font-mono text-neutral-200">tail</div>
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
                intensity:{" "}
                <span className="font-mono text-neutral-200">
                  {effectiveIntensity}
                  {intensityOverride !== null ? ` (DEV:${intensityOverride})` : ""}
                </span>{" "}
                / max {timing.totalMaxMs}ms / gap {timing.gapMinMs}..{timing.gapMaxMs}ms
              </div>
              <div>
                audio: <span className={audioEnabled ? "text-emerald-200" : "text-amber-200"}>{audioEnabled ? "enabled" : "disabled"}</span>
              </div>
            </div>

            {view && (
              <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
                <div className="text-xs text-neutral-400">演出プレビュー</div>
                <div className="mt-2 grid gap-1 text-sm text-neutral-300">
                  <div>
                    白熱度（reachPlayers）: <span className="font-mono text-neutral-100">{view.stats.reachPlayers}</span> → intensity{" "}
                    <span className="font-mono text-neutral-100">{effectiveIntensity}</span>
                    {intensityOverride !== null ? <span className="text-amber-200">（DEV override）</span> : null}
                  </div>
                  {view.pendingDraw && (
                    <div className="text-xs text-neutral-400">
                      次番号プレビュー（Adminのみ）: impact reachPlayers={view.pendingDraw.impact.reachPlayers}, bingoPlayers={view.pendingDraw.impact.bingoPlayers}{" "}
                      {willNewBingo ? <span className="text-amber-200">JACKPOT確定</span> : null}
                    </div>
                  )}
                </div>

                {devMode && (
                  <div className="mt-4 border-t border-neutral-800 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-neutral-400">DevTools</div>
                      <a className="text-xs text-neutral-300 underline hover:text-neutral-100" href={`/s/${encodeURIComponent(code)}/dev`} target="_blank" rel="noreferrer">
                        Devデッキを開く
                      </a>
                    </div>

                    <div className="mt-3 grid gap-3">
                      <div>
                        <div className="text-xs text-neutral-500">白熱度 override（演出テンポ/テーマの強制）</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button disabled={devBusy} onClick={() => void devTune(null)} size="sm" variant={intensityOverride === null ? "primary" : "secondary"}>
                            AUTO
                          </Button>
                          {[0, 1, 2, 3].map((v) => (
                            <Button
                              key={v}
                              disabled={devBusy}
                              onClick={() => void devTune(v as ReachIntensity)}
                              size="sm"
                              variant={intensityOverride === v ? "primary" : "secondary"}
                            >
                              {v}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div>
                          <div className="text-xs text-neutral-500">ダミー参加者投入（最大200）</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Input className="w-28" value={devSeedCount} onChange={(e) => setDevSeedCount(e.target.value)} placeholder="count" />
                            <Input className="w-32" value={devSeedPrefix} onChange={(e) => setDevSeedPrefix(e.target.value)} placeholder="prefix" />
                          </div>
                        </div>
                        <Button disabled={devBusy || !canOperate} onClick={() => void devSeed()} size="sm" variant="primary">
                          追加
                        </Button>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div>
                          <div className="text-xs text-neutral-500">次番号を強制 prepare（Adminのみ）</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Input className="w-28" value={devForceNumber} onChange={(e) => setDevForceNumber(e.target.value)} placeholder="1..75" />
                            <div className="text-xs text-neutral-500 self-center">（GOは通常通りW/A/S/D）</div>
                          </div>
                        </div>
                        <Button disabled={devBusy || !canOperate} onClick={() => void devPrepareNumber()} size="sm" variant="primary">
                          強制prepare
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button disabled={devBusy} onClick={() => void devReset()} size="sm" variant="destructive">
                          リセット（参加者/抽選履歴）
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

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
