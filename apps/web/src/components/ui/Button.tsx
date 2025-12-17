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
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold font-mono tracking-wide transition-all",
        "disabled:pointer-events-none disabled:opacity-60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pit-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        size === "sm" && "px-3 py-2 text-xs",
        size === "md" && "px-5 py-2 text-sm",
        size === "lg" && "px-6 py-3 text-base",
        variant === "primary" && "bg-pit-primary text-black hover:bg-pit-primary/80 shadow-[0_0_10px_rgba(234,179,8,0.3)]",
        variant === "secondary" && "border border-pit-border bg-pit-surface text-pit-text-main hover:border-pit-primary hover:text-pit-primary",
        variant === "outline" && "border border-pit-border bg-transparent text-pit-text-main hover:border-pit-primary hover:text-pit-primary",
        variant === "ghost" && "bg-transparent text-pit-text-dim hover:text-pit-primary hover:bg-pit-surface",
        variant === "destructive" && "border border-pit-danger/60 bg-pit-danger/10 text-pit-danger hover:bg-pit-danger/20 hover:shadow-[0_0_10px_rgba(239,68,68,0.3)]",
        className,
      )}
      type={type}
      {...props}
    />
  );
}