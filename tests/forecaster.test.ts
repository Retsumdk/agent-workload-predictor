import { describe, expect, test } from "bun:test";
import { ManualClock } from "../src/clock.js";
import { ExecutionHistory } from "../src/store.js";
import { DurationPredictor } from "../src/predictor.js";
import { WorkloadForecaster } from "../src/forecaster.js";
import { WorkloadError } from "../src/errors.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 5 arrivals in the 09:00 UTC slot of every day, 1 elsewhere. */
function build(nowMs: number, days: number): ExecutionHistory {
  const clock = new ManualClock(nowMs);
  const h = new ExecutionHistory(clock);
  for (let d = 0; d < days; d++) {
    for (let hour = 0; hour < 24; hour++) {
      const n = hour === 9 ? 5 : 1;
      for (let i = 0; i < n; i++) {
        h.record({
          kind: "job",
          startedAt: nowMs - (days - d) * DAY + hour * HOUR + i * 60_000,
          durationMs: 1_000,
        });
      }
    }
  }
  return h;
}

describe("WorkloadForecaster", () => {
  test("flat traffic forecasts flat hourly arrivals", () => {
    const now = 10 * DAY;
    const h = build(now, 7);
    const fc = new WorkloadForecaster();
    const [w] = fc.forecast(h, new DurationPredictor({ minSamples: 3 }), { horizon: 1 });
    // global rate is 28 tasks/day = 1.17/hour; the quiet 01:00 slot stays near it
    expect(w.expectedArrivals).toBeGreaterThan(0.8);
    expect(w.expectedArrivals).toBeLessThan(1.5);
    expect(w.hourSlot).toBe(1);
    expect(w.expectedBusyMs).toBeCloseTo(w.expectedArrivals * 1000, 0);
    expect(w.workersNeeded).toBe(1);
  });

  test("the 09:00 slot projects a spike, quiet slots stay low", () => {
    const now = 10 * DAY;
    const h = build(now, 7);
    const fc = new WorkloadForecaster();
    const windows = fc.forecast(h, new DurationPredictor({ minSamples: 3 }), {
      horizon: 24,
    });
    const bySlot = new Map(windows.map((w) => [w.hourSlot, w.expectedArrivals]));
    expect(bySlot.get(9)!).toBeGreaterThan(bySlot.get(3)! * 2);
  });

  test("validation and empty history errors", () => {
    const clock = new ManualClock(1_000);
    const empty = new ExecutionHistory(clock);
    const fc = new WorkloadForecaster();
    const dp = new DurationPredictor({ minSamples: 1 });
    expect(() => fc.forecast(empty, dp, { horizon: 1 })).toThrow(WorkloadError);
    const h = build(2 * DAY, 2);
    expect(() => fc.forecast(h, dp, { horizon: 0 })).toThrow(WorkloadError);
    expect(() => fc.forecast(h, dp, { horizon: 1, windowMs: 0 })).toThrow(WorkloadError);
  });

  test("forecaster options are validated", () => {
    expect(() => new WorkloadForecaster({ recencyWeight: 1.5 })).toThrow(WorkloadError);
    expect(() => new WorkloadForecaster({ seasonalityStrength: -1 })).toThrow(WorkloadError);
  });
});
