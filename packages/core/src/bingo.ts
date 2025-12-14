export const FREE = 0 as const;

export type BingoCardCell = number | typeof FREE;
export type BingoCard = BingoCardCell[][];

export type BingoProgress = {
  reachLines: number;
  bingoLines: number;
  minMissingToLine: number;
  isBingo: boolean;
};

function shuffleInPlace<T>(array: T[], rng: () => number): void {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function sampleNumbersInRange(
  startInclusive: number,
  endInclusive: number,
  count: number,
  rng: () => number,
): number[] {
  if (count < 0) throw new Error("count must be >= 0");
  const size = endInclusive - startInclusive + 1;
  if (count > size) throw new Error("count exceeds range size");
  const pool = Array.from({ length: size }, (_, idx) => startInclusive + idx);
  shuffleInPlace(pool, rng);
  return pool.slice(0, count);
}

export function generate75BallCard(rng: () => number = Math.random): BingoCard {
  const columnRanges: Array<[start: number, end: number]> = [
    [1, 15], // B
    [16, 30], // I
    [31, 45], // N
    [46, 60], // G
    [61, 75], // O
  ];

  const columns: number[][] = columnRanges.map(([start, end], colIdx) =>
    sampleNumbersInRange(start, end, colIdx === 2 ? 4 : 5, rng),
  );

  const card: BingoCard = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => FREE));

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      if (row === 2 && col === 2) {
        card[row][col] = FREE;
        continue;
      }
      card[row][col] = columns[col].shift()!;
    }
  }

  return card;
}

function isMarked(cell: BingoCardCell, drawn: Set<number>): boolean {
  return cell === FREE || drawn.has(cell);
}

function countMissingInLine(cells: BingoCardCell[], drawn: Set<number>): number {
  let missing = 0;
  for (const cell of cells) {
    if (!isMarked(cell, drawn)) missing += 1;
  }
  return missing;
}

export function evaluateCard(card: BingoCard, drawnNumbers: Iterable<number>): BingoProgress {
  const drawn = new Set<number>(drawnNumbers);

  const lines: BingoCardCell[][] = [];

  // Rows
  for (let r = 0; r < 5; r += 1) lines.push(card[r]);

  // Columns
  for (let c = 0; c < 5; c += 1) lines.push([card[0][c], card[1][c], card[2][c], card[3][c], card[4][c]]);

  // Diagonals
  lines.push([card[0][0], card[1][1], card[2][2], card[3][3], card[4][4]]);
  lines.push([card[0][4], card[1][3], card[2][2], card[3][1], card[4][0]]);

  let reachLines = 0;
  let bingoLines = 0;
  let minMissingToLine = 5;

  for (const line of lines) {
    const missing = countMissingInLine(line, drawn);
    if (missing === 0) bingoLines += 1;
    if (missing === 1) reachLines += 1;
    if (missing < minMissingToLine) minMissingToLine = missing;
  }

  return {
    reachLines,
    bingoLines,
    minMissingToLine,
    isBingo: bingoLines > 0,
  };
}

