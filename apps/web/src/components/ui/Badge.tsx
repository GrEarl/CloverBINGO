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
        "inline-flex items-center border px-2 py-0.5 text-xs font-bold font-mono tracking-wider",
        variant === "neutral" && "border-pit-border bg-pit-surface text-pit-text-dim",
        variant === "success" && "border-pit-secondary bg-pit-secondary/10 text-pit-secondary shadow-[0_0_5px_rgba(16,185,129,0.2)]",
        variant === "warning" && "border-pit-primary bg-pit-primary/10 text-pit-primary shadow-[0_0_5px_rgba(234,179,8,0.2)]",
        variant === "danger" && "border-pit-danger bg-pit-danger/10 text-pit-danger shadow-[0_0_5px_rgba(239,68,68,0.2)]",
        className,
      )}
      {...props}
    />
  );
}