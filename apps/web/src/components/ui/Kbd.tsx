import * as React from "react";

import { cn } from "../../lib/cn";

export type KbdProps = React.HTMLAttributes<HTMLElement>;

export default function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-7 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950/50 px-2 py-1 font-mono text-[0.7rem] text-neutral-200",
        className,
      )}
      {...props}
    />
  );
}

