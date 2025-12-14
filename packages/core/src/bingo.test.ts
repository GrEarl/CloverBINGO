import { describe, expect, it } from "vitest";

import { FREE, type BingoCard, evaluateCard, generate75BallCard } from "./bingo";

describe("generate75BallCard", () => {
  it("generates a 5x5 card with correct ranges and a FREE center", () => {
    const card = generate75BallCard(() => 0.5);
    expect(card).toHaveLength(5);
    for (const row of card) expect(row).toHaveLength(5);
    expect(card[2][2]).toBe(FREE);

    const ranges: Array<[number, number]> = [
      [1, 15],
      [16, 30],
      [31, 45],
      [46, 60],
      [61, 75],
    ];

    const seen = new Set<number>();
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const cell = card[r][c];
        if (r === 2 && c === 2) continue;
        expect(typeof cell).toBe("number");
        const [start, end] = ranges[c];
        expect(cell).toBeGreaterThanOrEqual(start);
        expect(cell).toBeLessThanOrEqual(end);
        expect(seen.has(cell)).toBe(false);
        seen.add(cell as number);
      }
    }
  });
});

describe("evaluateCard", () => {
  const card = [
    [1, 16, 31, 46, 61],
    [2, 17, 32, 47, 62],
    [3, 18, FREE, 48, 63],
    [4, 19, 34, 49, 64],
    [5, 20, 35, 50, 65],
  ] as unknown as BingoCard;

  it("detects a reach line when missing 1", () => {
    const progress = evaluateCard(card, [1, 2, 4, 5]);
    expect(progress.isBingo).toBe(false);
    expect(progress.minMissingToLine).toBe(1);
    expect(progress.reachLines).toBe(1);
  });

  it("detects bingo when a line is complete (FREE counts as marked)", () => {
    const progress = evaluateCard(card, [1, 2, 3, 4, 5]);
    expect(progress.isBingo).toBe(true);
    expect(progress.minMissingToLine).toBe(0);
    expect(progress.bingoLines).toBeGreaterThan(0);
  });
});
