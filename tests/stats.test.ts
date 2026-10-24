import { describe, expect, test } from "bun:test";
import { quantile, recencyWeight, stdev, weightedMean, weightedQuantile } from "../src/stats.js";

describe("stats", () => {
  test("mean and stdev basics", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(stdev([5, 5, 5])).toBe(0);
    expect(stdev([2, 4])).toBeCloseTo(Math.SQRT2, 12);
  });

  test("quantile is exact at 0 and 1", () => {
    expect(quantile([3, 1, 2], 0)).toBe(1);
    expect(quantile([3, 1, 2], 1)).toBe(3);
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(() => quantile([1], 1.5)).toThrow(RangeError);
  });

  test("weightedMean honors weights", () => {
    expect(weightedMean([[10, 1], [20, 3]])).toBeCloseTo(17.5, 12);
    expect(() => weightedMean([[1, 0], [2, 0]])).toThrow(RangeError);
  });

  test("recencyWeight halves per half-life", () => {
    expect(recencyWeight(0, 100)).toBe(1);
    expect(recencyWeight(100, 100)).toBe(0.5);
    expect(recencyWeight(300, 100)).toBeCloseTo(0.125, 12);
  });

  test("weightedQuantile sorts by value, walks weight mass", () => {
    // values 1..4 with equal weights: target = 2 of 4 mass, boundary lands on value 2
    expect(weightedQuantile([[1, 1], [2, 1], [3, 1], [4, 1]], 0.5)).toBe(2);
    // a heavy weight on the small value pulls the quantile down
    expect(weightedQuantile([[1, 9], [100, 1]], 0.5)).toBe(1);
  });
});
