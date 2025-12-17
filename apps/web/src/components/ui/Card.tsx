import * as React from "react";

import { cn } from "../../lib/cn";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

export default function Card({ className, ...props }: CardProps) {
  return <div className={cn("border border-pit-border bg-pit-surface p-5 shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]", className)} {...props} />;
}