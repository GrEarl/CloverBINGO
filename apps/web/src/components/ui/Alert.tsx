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
        "border px-4 py-3 text-sm font-bold tracking-wide",
        variant === "info" && "border-pit-border bg-pit-surface text-pit-text-main",
        variant === "success" && "border-pit-secondary/60 bg-pit-secondary/10 text-pit-secondary",
        variant === "warning" && "border-pit-primary/60 bg-pit-primary/10 text-pit-primary",
        variant === "danger" && "border-pit-danger/60 bg-pit-danger/10 text-pit-danger",
        className,
      )}
      {...props}
    />
  );
}