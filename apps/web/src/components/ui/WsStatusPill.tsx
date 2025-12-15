import * as React from "react";

import { cn } from "../../lib/cn";

export type WsStatus = "connected" | "reconnecting" | "offline";

const labelByStatus: Record<WsStatus, string> = {
  connected: "接続中",
  reconnecting: "再接続中",
  offline: "オフライン",
};

export type WsStatusPillProps = {
  status: WsStatus;
  className?: string;
};

export default function WsStatusPill({ status, className }: WsStatusPillProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        "bg-neutral-950/40",
        status === "connected" && "border-emerald-700/40 text-emerald-200",
        status === "reconnecting" && "border-amber-700/40 text-amber-200",
        status === "offline" && "border-red-800/60 text-red-200",
        className,
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "connected" && "bg-emerald-400",
          status === "reconnecting" && "bg-amber-400",
          status === "offline" && "bg-red-400",
        )}
      />
      <span className="text-neutral-50">{labelByStatus[status]}</span>
    </div>
  );
}

