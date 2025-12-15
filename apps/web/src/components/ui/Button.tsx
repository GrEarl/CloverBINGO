import * as React from "react";

import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export default function Button({ className, variant = "secondary", size = "md", type = "button", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold",
        "transition-colors disabled:pointer-events-none disabled:opacity-60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950",
        size === "sm" && "px-3 py-2 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-5 py-3 text-base",
        variant === "primary" && "bg-emerald-500 text-emerald-950 hover:bg-emerald-400",
        variant === "secondary" && "border border-neutral-800 bg-neutral-950/40 text-neutral-200 hover:bg-neutral-950/70",
        variant === "outline" && "border border-neutral-700 bg-transparent text-neutral-100 hover:bg-neutral-950/60",
        variant === "ghost" && "bg-transparent text-neutral-200 hover:bg-neutral-950/60",
        variant === "destructive" && "border border-red-800/60 bg-red-950/20 text-red-200 hover:bg-red-950/40",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

