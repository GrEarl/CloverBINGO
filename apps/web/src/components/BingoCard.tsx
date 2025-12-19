import { useMemo } from "react";

import { cn } from "../lib/cn";

type Props = {
  card: number[][];
  drawnNumbers: number[];
  variant?: "default" | "compact";
  showHeaders?: boolean;
  className?: string;
  reachHighlights?: boolean[][];
};

function isFree(cell: number): boolean {
  return cell === 0;
}

export default function BingoCard({
  card,
  drawnNumbers,
  variant = "default",
  showHeaders = true,
  className,
  reachHighlights,
}: Props) {
  const drawn = useMemo(() => new Set(drawnNumbers), [drawnNumbers]);
  const headers = ["B", "I", "N", "G", "O"];
  const isCompact = variant === "compact";

  const gapClass = isCompact ? "gap-px" : "gap-1";

  return (
    <div className={cn("w-full font-mono", variant === "default" && "max-w-md", className)}>
      {showHeaders && (
        <div className={cn("grid grid-cols-5", gapClass)}>
          {headers.map((h) => (
            <div
              key={h}
              className={cn(
                "text-center font-bold text-pit-text-muted bg-pit-surface border border-transparent",
                isCompact ? "text-[0.6rem] tracking-widest py-0.5" : "text-sm tracking-widest py-1",
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
            const shouldHighlight = !marked && Boolean(reachHighlights?.[rIdx]?.[cIdx]);
            return (
              <div
                key={`${rIdx}-${cIdx}`}
                className={[
                  cn(
                    "aspect-square select-none border text-center font-bold leading-[1] flex items-center justify-center transition-all duration-300",
                    isCompact ? "text-xs" : "text-lg",
                    shouldHighlight && "reach-cell border-transparent",
                  ),
                  marked
                    ? "border-pit-primary bg-pit-primary text-black shadow-[0_0_10px_rgba(234,179,8,0.4)] scale-100 z-10"
                    : "border-pit-border bg-pit-bg text-pit-text-dim",
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
                        : "text-xl",
                  )}
                >
                  {marked && !isFree(cell) ? (
                    // Stamp effect for marked numbers (simple X or just bold inverted color as above)
                    <span className="block scale-110">{label}</span>
                  ) : (
                    label
                  )}
                </span>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
