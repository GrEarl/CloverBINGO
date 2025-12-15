import { type BingoCard, type BingoProgress, evaluateCard } from "./bingo";

export type MinMissingHistogram = {
  "0": number;
  "1": number;
  "2": number;
  "3plus": number;
};

export type SessionStats = {
  reachPlayers: number;
  bingoPlayers: number;
  minMissingHistogram: MinMissingHistogram;
};

export type DrawCommit = {
  seq: number;
  number: number;
};

export function computeSessionStats(progressList: Iterable<BingoProgress>): SessionStats {
  let reachPlayers = 0;
  let bingoPlayers = 0;
  const histogram: MinMissingHistogram = { "0": 0, "1": 0, "2": 0, "3plus": 0 };

  for (const progress of progressList) {
    if (progress.reachLines > 0) reachPlayers += 1;
    if (progress.isBingo) bingoPlayers += 1;

    const m = progress.minMissingToLine;
    if (m <= 0) histogram["0"] += 1;
    else if (m === 1) histogram["1"] += 1;
    else if (m === 2) histogram["2"] += 1;
    else histogram["3plus"] += 1;
  }

  return { reachPlayers, bingoPlayers, minMissingHistogram: histogram };
}

export function rebuildDrawnNumbersFromCommits(commits: DrawCommit[]): number[] {
  const sorted = [...commits].sort((a, b) => a.seq - b.seq);
  return sorted.map((c) => c.number);
}

export function rebuildProgressById(cardsById: Record<string, BingoCard>, drawnNumbers: Iterable<number>): Record<string, BingoProgress> {
  const progressById: Record<string, BingoProgress> = {};
  for (const [id, card] of Object.entries(cardsById)) {
    progressById[id] = evaluateCard(card, drawnNumbers);
  }
  return progressById;
}

export function rebuildStateFromCommits(cardsById: Record<string, BingoCard>, commits: DrawCommit[]): {
  drawnNumbers: number[];
  progressById: Record<string, BingoProgress>;
  stats: SessionStats;
} {
  const drawnNumbers = rebuildDrawnNumbersFromCommits(commits);
  const progressById = rebuildProgressById(cardsById, drawnNumbers);
  const stats = computeSessionStats(Object.values(progressById));
  return { drawnNumbers, progressById, stats };
}

