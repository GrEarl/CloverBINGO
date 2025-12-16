import { useMemo } from "react";

import type { BingoCard as BingoCardType } from "@cloverbingo/core";

import { cn } from "../lib/cn";

type Props = {
  card: BingoCardType;
  drawnNumbers: number[];
  variant?: "default" | "compact";
  showHeaders?: boolean;
  className?: string;
};

type Cell = BingoCardType[number][number];

function isFree(cell: Cell): boolean {
  return cell === 0;
}

export default function BingoCard({ card, drawnNumbers, variant = "default", showHeaders = true, className }: Props) {
  const drawnSet = useMemo(() => new Set(drawnNumbers), [drawnNumbers]);
  const isCompact = variant === "compact";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border-4 border-pit-border bg-pit-wall shadow-2xl",
        isCompact ? "p-1" : "p-2",
        className,
      )}
    >
      {!isCompact && (
        <>
          <div className="absolute left-0 top-0 h-8 w-8 -translate-x-4 -translate-y-4 rotate-45 border-4 border-pit-border bg-pit-bg" />
          <div className="absolute right-0 top-0 h-8 w-8 translate-x-4 -translate-y-4 rotate-45 border-4 border-pit-border bg-pit-bg" />
          <div className="absolute bottom-0 left-0 h-8 w-8 -translate-x-4 translate-y-4 rotate-45 border-4 border-pit-border bg-pit-bg" />
          <div className="absolute bottom-0 right-0 h-8 w-8 translate-x-4 translate-y-4 rotate-45 border-4 border-pit-border bg-pit-bg" />
        </>
      )}

      {showHeaders && (
        <div
          className={cn(
            "mb-2 flex justify-between px-2 font-mono font-black tracking-[0.5em] text-pit-text-muted",
            isCompact ? "text-xs" : "text-lg",
          )}
        >
          <span>B</span>
          <span>I</span>
          <span>N</span>
          <span>G</span>
          <span>O</span>
        </div>
      )}

      <div className={cn("grid grid-cols-5", isCompact ? "gap-1" : "gap-2", showHeaders ? "" : isCompact ? "" : "mt-1")}>
        {card.flatMap((row, rIdx) =>
          row.map((cell, cIdx) => {
            const free = isFree(cell);
            const hit = !free && drawnSet.has(cell);
            const marked = free || hit;

            return (
              <div
                key={`${rIdx}-${cIdx}`}
                className={cn(
                  "aspect-square select-none flex items-center justify-center rounded-md border-2 font-black transition-all duration-300",
                  isCompact ? "text-sm" : "text-xl",
                  marked ? "border-pit-primary bg-pit-primary text-pit-bg" : "border-pit-border bg-pit-surface text-pit-text-dim opacity-90",
                  free && "border-pit-secondary bg-pit-secondary/20 text-pit-secondary",
                  marked && !isCompact && "shadow-glow scale-105 z-10",
                )}
              >
                {free ? <span className={cn(isCompact ? "text-base" : "text-2xl", "text-pit-secondary")}>★</span> : cell}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
