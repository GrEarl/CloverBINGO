import * as React from "react";

import { cn } from "../../lib/cn";

type Variant = "neutral" | "success" | "warning" | "danger";

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: Variant;
};

export default function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold",
        variant === "neutral" && "border-neutral-800 bg-neutral-950/40 text-neutral-200",
        variant === "success" && "border-emerald-600/40 bg-emerald-500/15 text-emerald-200",
        variant === "warning" && "border-amber-600/40 bg-amber-500/15 text-amber-200",
        variant === "danger" && "border-red-800/60 bg-red-950/30 text-red-200",
        className,
      )}
      {...props}
    />
  );
}

