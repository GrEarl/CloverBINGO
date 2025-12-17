import * as React from "react";

import { cn } from "../../lib/cn";

export type WsStatus = "connected" | "reconnecting" | "offline";

const labelByStatus: Record<WsStatus, string> = {
  connected: "ONLINE",
  reconnecting: "RECONNECTING",
  offline: "OFFLINE",
};

export type WsStatusPillProps = {
  status: WsStatus;
  className?: string;
};

export default function WsStatusPill({ status, className }: WsStatusPillProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 border px-3 py-1 text-xs font-bold font-mono tracking-wider",
        "bg-pit-bg",
        status === "connected" && "border-pit-secondary/60 text-pit-secondary",
        status === "reconnecting" && "border-pit-primary/60 text-pit-primary animate-pulse",
        status === "offline" && "border-pit-danger/60 text-pit-danger",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5",
          status === "connected" && "bg-pit-secondary shadow-[0_0_5px_rgba(16,185,129,0.8)]",
          status === "reconnecting" && "bg-pit-primary shadow-[0_0_5px_rgba(234,179,8,0.8)]",
          status === "offline" && "bg-pit-danger shadow-[0_0_5px_rgba(239,68,68,0.8)]",
        )}
      />
      <span className="">{labelByStatus[status]}</span>
    </div>
  );
}