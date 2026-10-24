/** Deterministic end-to-end demo: seed history, predict, forecast, backtest. */

import { ManualClock } from "./clock.js";
import { WorkloadPredictor } from "./engine.js";
import type { TaskRecord } from "./types.js";
import { mape } from "./stats.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Scenario {
  readonly name: string;
  readonly records: TaskRecord[];
}

/**
 * 14 days of synthetic execution history, generated with a fixed seed and no
 * wall-clock reads:
 *  - "summarize" starts at ~2,000ms and drifts steadily down to ~1,200ms
 *    (model got faster over the window);
 *  - "translate" is stable at ~5,000ms with more variance;
 *  - arrivals spike in the 09:00 UTC hour every day.
 */
export function buildScenario(): Scenario {
  const records: TaskRecord[] = [];
  const base = Date.UTC(2026, 9, 1, 0, 0, 0);
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let day = 0; day < 14; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const spike = hour === 9 ? 5 : hour === 10 ? 3 : hour >= 8 && hour <= 18 ? 2 : 1;
      const count = Math.max(1, Math.round(spike * 0.7 + rand() * spike));
      for (let n = 0; n < count; n++) {
        const startedAt = base + day * DAY + hour * HOUR + Math.floor(rand() * HOUR);
        const driftFactor = 1 - (day * DAY + hour * HOUR) / (14 * DAY) * 0.4;
        records.push({
          kind: "summarize",
          startedAt,
          durationMs: Math.round(2000 * driftFactor + (rand() - 0.5) * 300),
          cpuMs: Math.round(400 * driftFactor + rand() * 200),
          memMb: Math.round(64 + rand() * 32),
          success: rand() > 0.02,
        });
        records.push({
          kind: "translate",
          startedAt: startedAt + 17,
          durationMs: Math.round(5000 + (rand() - 0.5) * 1500),
          cpuMs: Math.round(900 + rand() * 400),
          memMb: Math.round(128 + rand() * 64),
          success: rand() > 0.01,
        });
      }
    }
  }
  records.sort((a, b) => a.startedAt - b.startedAt);
  return { name: "14-day synthetic history", records };
}

export function runDemo(): string {
  const scenario = buildScenario();
  const lastAt = scenario.records[scenario.records.length - 1].startedAt;
  const clock = new ManualClock(lastAt + HOUR);
  const wp = new WorkloadPredictor(clock, {
    maxRecords: 1_000_000,
  });
  for (const r of scenario.records) wp.record(r);

  const lines: string[] = [];
  const snap = wp.snapshot();
  lines.push("=== agent-workload-predictor demo ===");
  lines.push("");
  lines.push(`History: ${snap.records} records, ${snap.kinds.length} kinds (${scenario.name})`);
  lines.push(`  kinds: ${snap.kinds.join(", ")}`);
  lines.push(`  failures: ${snap.failures}`);
  lines.push(`  range: ${new Date(snap.firstAt as number).toISOString()} .. ${new Date(snap.lastAt as number).toISOString()}`);
  lines.push("");

  lines.push("-- Duration predictions (as of " + new Date(clock.nowMs()).toISOString() + ") --");
  for (const kind of wp.kinds()) {
    const p = wp.predict(kind);
    lines.push(
      `${kind.padEnd(10)} expected ${p.expectedDurationMs.toFixed(0).padStart(5)}ms` +
        `  p10-p90 [${p.interval.low.toFixed(0)}, ${p.interval.high.toFixed(0)}]` +
        `  confidence ${p.confidence.toFixed(2)}  (n=${p.samples})`,
    );
  }
  lines.push("");

  lines.push("-- Resource demand (p50 / p95) --");
  for (const kind of wp.kinds()) {
    const r = wp.predictResources(kind);
    lines.push(
      `${kind.padEnd(10)} cpu ${fmt(r.cpuP50Ms)} / ${fmt(r.cpuP95Ms)} ms` +
        `  mem ${fmt(r.memP50Mb)} / ${fmt(r.memP95Mb)} MB`,
    );
  }
  lines.push("");

  lines.push("-- 12-hour forward forecast (1h windows, UTC) --");
  for (const w of wp.forecast({ horizon: 12 })) {
    lines.push(
      `${new Date(w.startAt).toISOString().slice(11, 16)} UTC  slot ${String(w.hourSlot).padStart(2, "0")}:00` +
        `  arrivals ${w.expectedArrivals.toFixed(1).padStart(5)}` +
        `  busy ${(w.expectedBusyMs / 1000).toFixed(1).padStart(7)}s` +
        `  workers ${w.workersNeeded}`,
    );
  }
  lines.push("");

  lines.push("-- Backtest (train on first 10 days, score next 4) --");
  const splitAt = Date.UTC(2026, 9, 11, 0, 0, 0);
  const train = scenario.records.filter((r) => r.startedAt < splitAt);
  const test = scenario.records.filter((r) => r.startedAt >= splitAt);
  const backClock = new ManualClock(splitAt);
  const backWp = new WorkloadPredictor(backClock);
  for (const r of train) backWp.record(r);
  for (const kind of backWp.kinds()) {
    const predicted = backWp.predict(kind);
    const actuals = test.filter((r) => r.kind === kind).map((r) => r.durationMs);
    const err = mape(
      actuals.map(() => predicted.expectedDurationMs),
      actuals,
    );
    lines.push(
      `${kind.padEnd(10)} static-prediction MAPE ${(err === null ? "n/a" : (err * 100).toFixed(1) + "%").padStart(8)}` +
        `  (predicted ${predicted.expectedDurationMs.toFixed(0)}ms vs actual mean ` +
        `${(actuals.reduce((a, b) => a + b, 0) / actuals.length).toFixed(0)}ms)`,
    );
  }
  lines.push("");
  lines.push("Demo is deterministic: same scenario bytes on every run (ManualClock, fixed seed).");
  return lines.join("\n");
}

function fmt(v: number | null): string {
  return v === null ? "n/a" : String(Math.round(v));
}
