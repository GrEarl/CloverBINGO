import * as React from "react";

import { cn } from "../../lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export default function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm text-neutral-100",
        "placeholder:text-neutral-500",
        "outline-none transition-colors",
        "focus:border-emerald-600 focus:ring-2 focus:ring-emerald-400/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

