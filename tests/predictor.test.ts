import { describe, expect, test } from "bun:test";
import { DurationPredictor, ResourcePredictor } from "../src/predictor.js";
import { WorkloadError } from "../src/errors.js";
import type { TaskRecord } from "../src/types.js";

const HOUR = 3_600_000;
const NOW = 10 * 24 * HOUR;

function samples(durations: number[], spacedHours = 1): TaskRecord[] {
  return durations.map((d, i) => ({
    kind: "k",
    startedAt: NOW - (durations.length - i) * spacedHours * HOUR,
    durationMs: d,
  }));
}

describe("DurationPredictor", () => {
  const p = new DurationPredictor({ minSamples: 3, halfLifeMs: 24 * HOUR });

  test("constant history predicts exactly, with tight interval and high confidence", () => {
    const d = p.predict("k", samples([100, 100, 100, 100]), NOW);
    expect(d.expectedDurationMs).toBeCloseTo(100, 9);
    expect(d.interval).toEqual({ low: 100, high: 100 });
    expect(d.confidence).toBeCloseTo((4 / 9) * 1, 12);
  });

  test("recency weighting reacts to drift faster than a plain mean", () => {
    // 9 old samples at 100ms, 1 fresh sample at 200ms (all inside one half-life).
    const d = p.predict("k", samples([100, 100, 100, 100, 100, 100, 100, 100, 100, 200]), NOW);
    expect(d.expectedDurationMs).toBeGreaterThan(105);
    expect(d.expectedDurationMs).toBeLessThan(200);
  });

  test("interval brackets the sample spread", () => {
    const d = p.predict("k", samples([90, 95, 100, 105, 110]), NOW);
    expect(d.interval.low).toBeLessThanOrEqual(100);
    expect(d.interval.high).toBeGreaterThanOrEqual(100);
  });

  test("dispersion lowers confidence", () => {
    const tight = p.predict("k", samples([100, 100, 101]), NOW);
    const wild = p.predict("k", samples([50, 100, 150]), NOW);
    expect(wild.confidence).toBeLessThan(tight.confidence);
  });

  test("insufficient history is a coded error", () => {
    expect(() => p.predict("k", samples([100, 100]), NOW)).toThrow(WorkloadError);
  });
});

describe("ResourcePredictor", () => {
  const r = new ResourcePredictor();

  test("p50/p95 of cpu and mem; null when unrecorded", () => {
    const out = r.predict("k", [
      { kind: "k", startedAt: 0, durationMs: 100, cpuMs: 200, memMb: 128 },
      { kind: "k", startedAt: 1, durationMs: 100, cpuMs: 200, memMb: 128 },
      ...Array.from({ length: 20 }, (_, i) => ({
        kind: "k",
        startedAt: 10 + i,
        durationMs: 100,
        cpuMs: 100,
        memMb: 64,
      })),
    ]);
    expect(out.cpuP50Ms).toBe(100);
    expect(out.cpuP95Ms).toBeGreaterThan(150);
    expect(out.memP95Mb).toBeGreaterThan(64);

    const bare = r.predict("j", samples([1, 2, 3]));
    expect(bare.cpuP50Ms).toBeNull();
    expect(bare.memP50Mb).toBeNull();
  });

  test("cpuShare is the mean wall-time share", () => {
    const share = r.cpuShare("k", [
      { kind: "k", startedAt: 0, durationMs: 100, cpuMs: 50 },
      { kind: "k", startedAt: 1, durationMs: 200, cpuMs: 100 },
    ]);
    expect(share).toBeCloseTo(0.5, 12);
    expect(r.cpuShare("k", samples([1, 2, 3]))).toBeNull();
  });
});
