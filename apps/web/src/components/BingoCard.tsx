import { useMemo } from "react";

import { cn } from "../lib/cn";

type Props = {
  card: number[][];
  drawnNumbers: number[];
  variant?: "default" | "compact";
  showHeaders?: boolean;
  className?: string;
};

function isFree(cell: number): boolean {
  return cell === 0;
}

export default function BingoCard({ card, drawnNumbers, variant = "default", showHeaders = true, className }: Props) {
  const drawn = useMemo(() => new Set(drawnNumbers), [drawnNumbers]);
  const headers = ["B", "I", "N", "G", "O"];
  const isCompact = variant === "compact";

  const gapClass = isCompact ? "gap-1" : "gap-2";

  return (
    <div className={cn("w-full", variant === "default" && "max-w-md", className)}>
      {showHeaders && (
        <div className={cn("grid grid-cols-5", gapClass)}>
          {headers.map((h) => (
            <div
              key={h}
              className={cn(
                "text-center font-semibold text-neutral-300",
                isCompact ? "text-[0.55rem] tracking-[0.25em]" : "text-xs tracking-[0.3em]",
              )}
            >
              {h}
            </div>
          ))}
        </div>
      )}

      <div className={cn("grid grid-cols-5", gapClass, showHeaders ? (isCompact ? "mt-1" : "mt-2") : "")}>
        {card.flatMap((row, rIdx) =>
          row.map((cell, cIdx) => {
            const marked = isFree(cell) || drawn.has(cell);
            const label = isFree(cell) ? "FREE" : String(cell);
            return (
              <div
                key={`${rIdx}-${cIdx}`}
                className={[
                  cn(
                    "aspect-square select-none border text-center font-semibold leading-[1] flex items-center justify-center",
                    isCompact ? "rounded-md" : "rounded-lg",
                  ),
                  marked
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
                    : "border-neutral-800 bg-neutral-950/40 text-neutral-100",
                ].join(" ")}
              >
                <span
                  className={cn(
                    isFree(cell)
                      ? isCompact
                        ? "text-[0.45rem] tracking-[0.18em]"
                        : "text-[0.7rem] tracking-[0.2em]"
                      : isCompact
                        ? "text-xs"
                        : "text-lg",
                  )}
                >
                  {label}
                </span>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
