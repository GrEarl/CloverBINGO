import { useMemo } from "react";

type Props = {
  card: number[][];
  drawnNumbers: number[];
};

function isFree(cell: number): boolean {
  return cell === 0;
}

export default function BingoCard({ card, drawnNumbers }: Props) {
  const drawn = useMemo(() => new Set(drawnNumbers), [drawnNumbers]);
  const headers = ["B", "I", "N", "G", "O"];

  return (
    <div className="w-full max-w-md">
      <div className="grid grid-cols-5 gap-2">
        {headers.map((h) => (
          <div key={h} className="text-center text-xs font-semibold tracking-[0.3em] text-neutral-300">
            {h}
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-5 gap-2">
        {card.flatMap((row, rIdx) =>
          row.map((cell, cIdx) => {
            const marked = isFree(cell) || drawn.has(cell);
            const label = isFree(cell) ? "FREE" : String(cell);
            return (
              <div
                key={`${rIdx}-${cIdx}`}
                className={[
                  "aspect-square select-none rounded-lg border text-center font-semibold leading-[1] flex items-center justify-center",
                  marked
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
                    : "border-neutral-800 bg-neutral-950/40 text-neutral-100",
                ].join(" ")}
              >
                <span className={isFree(cell) ? "text-[0.7rem] tracking-[0.2em]" : "text-lg"}>{label}</span>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

