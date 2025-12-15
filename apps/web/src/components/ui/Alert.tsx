import * as React from "react";

import { cn } from "../../lib/cn";

type Variant = "info" | "success" | "warning" | "danger";

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: Variant;
};

export default function Alert({ className, variant = "info", ...props }: AlertProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 text-sm",
        variant === "info" && "border-neutral-800 bg-neutral-950/40 text-neutral-200",
        variant === "success" && "border-emerald-700/40 bg-emerald-950/30 text-emerald-200",
        variant === "warning" && "border-amber-800/60 bg-amber-950/30 text-amber-200",
        variant === "danger" && "border-red-800/60 bg-red-950/30 text-red-200",
        className,
      )}
      {...props}
    />
  );
}

