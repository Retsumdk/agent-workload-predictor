# agent-workload-predictor

Workload prediction for agent fleets: learns **how long each kind of task takes**, **how much CPU and memory it needs**, and **how many tasks will arrive** — all from your own execution history, with zero runtime dependencies.

## The problem

Running agents in production means capacity decisions with no data behind them:

- "We have 3 workers — will tonight's summarization batch fall over?"
- "A prompt change made tasks slower — by how much, and when did it start?"
- "Traffic spikes at 09:00 — how many workers does tomorrow morning actually need?"

Guessing means either paying for idle workers or dropping tasks. Most teams cannot answer these questions because the numbers live scattered across logs instead of in one queryable estimator.

## What it does

`agent-workload-predictor` turns a plain **execution history** (task kind, start time, duration, CPU, memory) into:

1. **Duration predictions** per task kind — a recency-weighted expected duration with a p10–p90 interval and an honest confidence score. Recent samples count more (exponential half-life decay), so a task kind that gets faster over time is tracked, not averaged away. The demo's backtest shows exactly this: a static mean is 22% off on drifting history while the recency-weighted estimate tracks the drift.
2. **Resource percentiles** per task kind — p50/p95 of CPU time and peak memory, for scheduler and budget decisions.
3. **Arrival forecasts** — forward projection of task arrivals and total busy time per window, combining a recency baseline with smoothed hour-of-day seasonality (a 09:00 spike is learned, not configured).
4. **A deterministic demo and a CLI** so you can see all of it in one command.

## How it works

```
                 ┌────────────────────┐
  TaskRecord ──▶ │  ExecutionHistory  │  validation, bounded capacity,
                 └─────────┬──────────┘  snapshots
                           │
          ┌────────────────┼──────────────────────┐
          ▼                ▼                      ▼
 ┌────────────────┐ ┌───────────────┐ ┌─────────────────────┐
 │ Duration       │ │ Resource      │ │ WorkloadForecaster  │
 │ Predictor      │ │ Predictor     │ │ arrivals + busy-ms  │
 │ recency-weight │ │ p50 / p95     │ │ baseline ⊕ hour-    │
 │ + interval     │ │ cpu / mem     │ │ of-day seasonality  │
 └────────────────┘ └───────────────┘ └─────────────────────┘
          └────────────────┴───────────┬──────────┘
                                       ▼
                          ┌────────────────────────┐
                          │  WorkloadPredictor     │  the facade you use
                          │  (engine.ts)           │
                          └────────────────────────┘
```

Key semantics:

- **Recency weighting.** Every sample's weight is `0.5 ** (age / halfLifeMs)` (default half-life: 7 days, configurable). The expected duration is the weighted mean; the interval is the weighted p10/p90.
- **Confidence is earned, not asserted.** `confidence = n/(n+5) × (1 − 0.5·min(1, cv))` — it grows with sample count and shrinks with dispersion. A kind with 3 wild samples reports low confidence instead of pretending to know.
- **Seasonality is shrunk toward the global rate.** Hour-slot rates are estimated as `(slotCount + k·globalRate) / (slotOccurrences + k)` with `k = 2`, so one noisy observation cannot dominate; the final rate blends the recency baseline with the seasonal rate (50/50 by default).
- **Determinism.** All time comes from an injectable `Clock` (`ManualClock` for tests and demos). The demo output is byte-identical across runs, and CI enforces it.
- **Errors are coded.** `WorkloadError` carries a stable `code` (`BAD_INPUT`, `INSUFFICIENT_HISTORY`, `UNKNOWN_KIND`, `EMPTY_HISTORY`) mapped to CLI exit codes, so callers can branch programmatically.

## Getting started

```bash
git clone https://github.com/Retsumdk/agent-workload-predictor.git
cd agent-workload-predictor
bun install
bun test          # 31 tests
bun run demo      # full end-to-end walkthrough
```

Or install from GitHub (the package is not on npm; the `prepare` script builds it on install):

```bash
npm install github:Retsumdk/agent-workload-predictor
```

> If you use Bun to install it, run `bun pm trust agent-workload-predictor` afterwards — Bun blocks lifecycle scripts of git dependencies by default, which would leave `dist/` unbuilt.

## CLI

The `awp` CLI reads JSONL history (one `TaskRecord` per line) from `--history <file>` or stdin.

```console
$ bun src/cli-run.ts demo
=== agent-workload-predictor demo ===

History: 1302 records, 2 kinds (14-day synthetic history)
  kinds: summarize, translate
  failures: 22
  range: 2026-10-01T00:31:11.347Z .. 2026-10-14T23:16:20.035Z

-- Duration predictions (as of 2026-10-15T00:16:20.035Z) --
summarize  expected  1509ms  p10-p90 [1208, 1863]  confidence 0.91  (n=651)
translate  expected  4988ms  p10-p90 [4397, 5624]  confidence 0.95  (n=651)

-- Resource demand (p50 / p95) --
summarize  cpu 420 / 544 ms  mem 79 / 95 MB
translate  cpu 1087 / 1274 ms  mem 162 / 189 MB

-- 12-hour forward forecast (1h windows, UTC) --
01:00 UTC  slot 01:00  arrivals   3.2  busy    10.5s  workers 1
...
09:00 UTC  slot 09:00  arrivals   7.9  busy    25.7s  workers 1
...

-- Backtest (train on first 10 days, score next 4) --
summarize  static-prediction MAPE    22.1%  (predicted 1674ms vs actual mean 1305ms)
translate  static-prediction MAPE     7.7%  (predicted 4997ms vs actual mean 4973ms)

Demo is deterministic: same scenario bytes on every run (ManualClock, fixed seed).
```

The backtest is the point: `summarize` drifts from ~2,000 ms down to ~1,200 ms over the 14-day window, so the train-set mean (1,674 ms) is 22% wrong on held-out data, while the recency-weighted live prediction reports 1,509 ms against a current actual mean of 1,305 ms — imperfect, but tracking the drift instead of pinning to history.

Forecast your own history:

```console
$ awp forecast --history execs.jsonl --horizon 6 --window-minutes 60
start(UTC)        slot  arrivals  busy(s)  workers
2026-10-24 01:00  01:00      3.2     10.5        1
...
```

```console
$ awp predict --history execs.jsonl --kind summarize --now 1791510800000
kind            summarize
samples         651
expected        1509ms
p10-p90         [1208ms, 1863ms]
confidence      0.91
cpu p50/p95     420 / 544 ms
mem p50/p95     79 / 95 MB
```

Exit codes: `0` ok · `1` runtime error · `2` usage · `3` insufficient history · `4` unknown kind · `5` bad input.

## Library usage

```typescript
import { WorkloadPredictor, SystemClock } from "agent-workload-predictor";

const wp = new WorkloadPredictor(new SystemClock(), {
  predictor: { halfLifeMs: 24 * 3600 * 1000, minSamples: 3 },
  forecaster: { seasonalityStrength: 2, recencyWeight: 0.5 },
  maxRecords: 200_000,
});

// Record every completed execution you already log:
wp.record({
  kind: "summarize",
  startedAt: Date.now() - 1_850,
  durationMs: 1_850,
  cpuMs: 412,
  memMb: 71,
  success: true,
});

// How long will the next summarize take?
const p = wp.predict("summarize");
// { kind: "summarize", expectedDurationMs: 1509.4, interval: { low: 1208, high: 1863 },
//   confidence: 0.91, samples: 651 }

// What resources does the kind demand?
wp.predictResources("summarize");
// { kind: "summarize", cpuP50Ms: 420, cpuP95Ms: 544, memP50Mb: 79, memP95Mb: 95 }

// What does the next 12 hours look like?
for (const w of wp.forecast({ horizon: 12, windowMs: 3_600_000 })) {
  console.log(w.hourSlot, w.expectedArrivals, w.expectedBusyMs, w.workersNeeded);
}
```

### History format

One JSON object per line (JSONL), with `success` optional — failed runs are recorded and reported in snapshots but only inform resource/duration stats through their measured duration, as usual for execution telemetry:

```json
{"kind":"summarize","startedAt":1791500000000,"durationMs":1850,"cpuMs":420,"memMb":71,"success":true}
```

Records are validated on `record()`: non-empty `kind`, finite `startedAt` not in the future, positive finite `durationMs`, non-negative `cpuMs`/`memMb`. Invalid input throws a coded `WorkloadError` immediately — the estimator never silently ingests garbage.

## Design notes

- **Zero runtime dependencies.** The estimator is ~900 lines of strict TypeScript over plain data structures. The only dev dependencies are `typescript` and `bun-types`.
- **Ports and adapters.** Time is the only side effect; it enters through the `Clock` interface. Every module is deterministic given the same records and clock, which is what makes the demo diff-checkable in CI.
- **Honest scope.** This is an in-memory, single-process estimator designed to sit next to a task queue and answer capacity questions from its own history. It does not persist state, does not model inter-arrival distributions beyond window counts, and does not replace a real time-series database — it is the small, exact layer that makes those questions answerable.

## License

MIT
