import { describe, expect, it } from "vitest";

import { FREE, type BingoCard, evaluateCard } from "./bingo";
import { computeSessionStats, rebuildDrawnNumbersFromCommits, rebuildStateFromCommits } from "./session";

describe("computeSessionStats", () => {
  it("counts reach/bingo players and histogram buckets", () => {
    const stats = computeSessionStats([
      { reachLines: 1, bingoLines: 0, minMissingToLine: 1, isBingo: false },
      { reachLines: 0, bingoLines: 1, minMissingToLine: 0, isBingo: true },
      { reachLines: 2, bingoLines: 0, minMissingToLine: 2, isBingo: false },
      { reachLines: 0, bingoLines: 0, minMissingToLine: 5, isBingo: false },
    ]);
    expect(stats.reachPlayers).toBe(2);
    expect(stats.bingoPlayers).toBe(1);
    expect(stats.minMissingHistogram).toEqual({ "0": 1, "1": 1, "2": 1, "3plus": 1 });
  });
});

describe("rebuildDrawnNumbersFromCommits", () => {
  it("sorts by seq and returns numbers", () => {
    const drawn = rebuildDrawnNumbersFromCommits([
      { seq: 3, number: 30 },
      { seq: 1, number: 10 },
      { seq: 2, number: 20 },
    ]);
    expect(drawn).toEqual([10, 20, 30]);
  });
});

describe("rebuildStateFromCommits", () => {
  it("reconstructs drawnNumbers, progressById and stats from commit log", () => {
    const cardA: BingoCard = [
      [1, 16, 31, 46, 61],
      [2, 17, 32, 47, 62],
      [3, 18, FREE, 48, 63],
      [4, 19, 34, 49, 64],
      [5, 20, 35, 50, 65],
    ];

    const cardB: BingoCard = [
      [6, 21, 36, 51, 66],
      [7, 22, 37, 52, 67],
      [8, 23, FREE, 53, 68],
      [9, 24, 39, 54, 69],
      [10, 25, 40, 55, 70],
    ];

    const commits = [
      { seq: 2, number: 2 },
      { seq: 1, number: 1 },
      { seq: 5, number: 5 },
      { seq: 4, number: 4 },
      { seq: 3, number: 3 },
    ];

    const rebuilt = rebuildStateFromCommits({ a: cardA, b: cardB }, commits);
    expect(rebuilt.drawnNumbers).toEqual([1, 2, 3, 4, 5]);
    expect(rebuilt.progressById.a).toEqual(evaluateCard(cardA, rebuilt.drawnNumbers));
    expect(rebuilt.progressById.b).toEqual(evaluateCard(cardB, rebuilt.drawnNumbers));

    const expectedStats = computeSessionStats([rebuilt.progressById.a, rebuilt.progressById.b]);
    expect(rebuilt.stats).toEqual(expectedStats);
  });
});

