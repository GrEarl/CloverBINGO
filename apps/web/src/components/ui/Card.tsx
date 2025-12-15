import * as React from "react";

import { cn } from "../../lib/cn";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

export default function Card({ className, ...props }: CardProps) {
  return <div className={cn("rounded-xl border border-neutral-800 bg-neutral-900/40 p-5", className)} {...props} />;
}

