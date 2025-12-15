import { useEffect, useMemo, useRef, useState } from "react";

export type ReelStatus = "idle" | "spinning" | "stopped";
export type DisplayScreen = "ten" | "one";
export type SessionStatus = "active" | "ended";
export type DrawState = "idle" | "prepared" | "spinning";

export type BingoProgress = {
  reachLines: number;
  bingoLines: number;
  minMissingToLine: number;
  isBingo: boolean;
};

export type SessionStats = {
  reachPlayers: number;
  bingoPlayers: number;
  minMissingHistogram: { "0": number; "1": number; "2": number; "3plus": number };
};

export type Player = {
  id: string;
  displayName: string;
  joinedAt: number;
  card?: number[][];
  progress: BingoProgress;
};

export type SpotlightSnapshot = {
  version: number;
  ids: string[];
  updatedAt: number;
  updatedBy: string | null;
  players: Array<Pick<Player, "id" | "displayName" | "progress">>;
};

export type ParticipantSnapshot = {
  type: "snapshot";
  ok: true;
  role: "participant";
  sessionCode: string;
  sessionStatus: SessionStatus;
  endedAt: string | null;
  updatedAt: number;
  drawCount: number;
  drawState: DrawState;
  lastNumber: number | null;
  lastNumbers: number[];
  drawnNumbers: number[];
  stats: SessionStats;
  spotlight: SpotlightSnapshot;
  player: (Player & { card: number[][] }) | null;
};

export type DisplaySnapshot = {
  type: "snapshot";
  ok: true;
  role: "display";
  sessionCode: string;
  sessionStatus: SessionStatus;
  endedAt: string | null;
  updatedAt: number;
  drawCount: number;
  drawState: DrawState;
  lastNumber: number | null;
  lastNumbers: number[];
  stats: SessionStats;
  spotlight: SpotlightSnapshot;
  screen: DisplayScreen;
  reel: {
    status: ReelStatus;
    digit: number | null;
  };
};

export type ModSnapshot = {
  type: "snapshot";
  ok: true;
  role: "mod";
  sessionCode: string;
  sessionStatus: SessionStatus;
  endedAt: string | null;
  updatedAt: number;
  drawCount: number;
  drawState: DrawState;
  lastNumber: number | null;
  lastNumbers: number[];
  stats: SessionStats;
  spotlight: SpotlightSnapshot;
  drawnNumbers?: number[];
  players: Array<Player & { card: number[][] }>;
};

export type AdminSnapshot = {
  type: "snapshot";
  ok: true;
  role: "admin";
  sessionCode: string;
  sessionStatus: SessionStatus;
  endedAt: string | null;
  updatedAt: number;
  drawCount: number;
  drawState: DrawState;
  lastNumber: number | null;
  lastNumbers: number[];
  stats: SessionStats;
  spotlight: SpotlightSnapshot;
  drawnNumbers?: number[];
  players: Array<Player & { card: number[][] }>;
  pendingDraw: null | {
    preparedAt: number;
    number: number;
    impact: { reachPlayers: number; bingoPlayers: number };
    reel: { ten: ReelStatus; one: ReelStatus };
    stoppedDigits: { ten: number | null; one: number | null };
    state?: DrawState;
  };
};

export type Snapshot =
  | ParticipantSnapshot
  | DisplaySnapshot
  | ModSnapshot
  | AdminSnapshot
  | { type: "snapshot"; ok: false; error: string };

export type ServerEvent =
  | { type: "draw.prepared"; number: number; preparedAt: number; impact: { reachPlayers: number; bingoPlayers: number } }
  | { type: "draw.spin"; action: "start" | "stop"; digit: "ten" | "one"; at: number; digitValue?: number }
  | { type: "draw.committed"; seq: number; number: number; committedAt: string; stats: SessionStats; newBingoIds?: string[] }
  | { type: "spotlight.changed"; spotlight: SpotlightSnapshot }
  | { type: "pong"; t: number }
  | { type: string; [k: string]: unknown };

type SocketParams =
  | { role: "participant"; code: string; playerId?: string }
  | { role: "display"; code: string; screen: DisplayScreen }
  | { role: "admin"; code: string }
  | { role: "mod"; code: string };

function buildWebSocketUrl(params: SocketParams): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${proto}//${window.location.host}/api/ws`);
  url.searchParams.set("code", params.code);
  url.searchParams.set("role", params.role);

  if (params.role === "participant" && params.playerId) url.searchParams.set("playerId", params.playerId);
  if (params.role === "display") url.searchParams.set("screen", params.screen);

  return url.toString();
}

export function useSessionSocket(params: SocketParams) {
  const url = useMemo(() => buildWebSocketUrl(params), [
    params.role,
    params.code,
    params.role === "participant" ? params.playerId ?? "" : "",
    params.role === "display" ? params.screen : "",
  ]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<"connected" | "reconnecting" | "offline">("reconnecting");
  const [lastEvent, setLastEvent] = useState<ServerEvent | null>(null);
  const retryRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const disconnectedAtRef = useRef<number | null>(null);
  const offlineTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus("reconnecting");

      ws.onopen = () => {
        disconnectedAtRef.current = null;
        if (offlineTimerRef.current) window.clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
        setStatus("connected");
      };
      ws.onclose = () => {
        setStatus("reconnecting");
        if (!disconnectedAtRef.current) disconnectedAtRef.current = Date.now();
        if (!offlineTimerRef.current) {
          offlineTimerRef.current = window.setTimeout(() => {
            if (disposed) return;
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) setStatus("offline");
          }, 4000);
        }
        if (disposed) return;
        retryRef.current = window.setTimeout(connect, 700);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        try {
          const next = JSON.parse(ev.data) as Snapshot | ServerEvent;
          if ((next as { type?: unknown })?.type === "snapshot") setSnapshot(next as Snapshot);
          else setLastEvent(next as ServerEvent);
        } catch {
          // ignore
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      if (offlineTimerRef.current) window.clearTimeout(offlineTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [url]);

  return { snapshot, status, lastEvent };
}
