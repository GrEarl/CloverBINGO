import { useEffect, useMemo, useRef, useState } from "react";

export type ReelStatus = "idle" | "spinning" | "stopped";
export type DisplayScreen = "ten" | "one";

export type BingoProgress = {
  reachLines: number;
  bingoLines: number;
  minMissingToLine: number;
  isBingo: boolean;
};

export type Player = {
  id: string;
  displayName: string;
  joinedAt: number;
  card?: number[][];
  progress: BingoProgress;
};

export type SpotlightSnapshot = {
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
  updatedAt: number;
  drawCount: number;
  lastNumber: number | null;
  lastNumbers: number[];
  drawnNumbers: number[];
  spotlight: SpotlightSnapshot;
  player: (Player & { card: number[][] }) | null;
};

export type DisplaySnapshot = {
  type: "snapshot";
  ok: true;
  role: "display";
  sessionCode: string;
  updatedAt: number;
  drawCount: number;
  lastNumber: number | null;
  lastNumbers: number[];
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
  updatedAt: number;
  drawCount: number;
  lastNumber: number | null;
  lastNumbers: number[];
  spotlight: SpotlightSnapshot;
  players: Array<Player & { card: number[][] }>;
};

export type AdminSnapshot = {
  type: "snapshot";
  ok: true;
  role: "admin";
  sessionCode: string;
  updatedAt: number;
  drawCount: number;
  lastNumber: number | null;
  lastNumbers: number[];
  spotlight: SpotlightSnapshot;
  players: Array<Player & { card: number[][] }>;
  pendingDraw: null | {
    preparedAt: number;
    number: number;
    impact: { reachPlayers: number; bingoPlayers: number };
    reel: { ten: ReelStatus; one: ReelStatus };
    stoppedDigits: { ten: number | null; one: number | null };
  };
  bagRemaining: number;
};

export type Snapshot =
  | ParticipantSnapshot
  | DisplaySnapshot
  | ModSnapshot
  | AdminSnapshot
  | { type: "snapshot"; ok: false; error: string };

type SocketParams =
  | { role: "participant"; code: string; playerId?: string }
  | { role: "display"; code: string; screen: DisplayScreen }
  | { role: "admin"; code: string; token: string }
  | { role: "mod"; code: string; token: string };

function buildWebSocketUrl(params: SocketParams): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${proto}//${window.location.host}/api/ws`);
  url.searchParams.set("code", params.code);
  url.searchParams.set("role", params.role);

  if (params.role === "participant" && params.playerId) url.searchParams.set("playerId", params.playerId);
  if (params.role === "display") url.searchParams.set("screen", params.screen);
  if (params.role === "admin") url.searchParams.set("token", params.token);
  if (params.role === "mod") url.searchParams.set("token", params.token);

  return url.toString();
}

export function useSessionSocket(params: SocketParams) {
  const url = useMemo(() => buildWebSocketUrl(params), [params]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const retryRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setConnected(false);

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (disposed) return;
        retryRef.current = window.setTimeout(connect, 700);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        try {
          const next = JSON.parse(ev.data) as Snapshot;
          if (next?.type === "snapshot") setSnapshot(next);
        } catch {
          // ignore
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [url]);

  return { snapshot, connected };
}

