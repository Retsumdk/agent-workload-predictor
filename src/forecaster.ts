/** Arrival-rate forecasting: recency baseline blended with hour-of-day seasonality. */

import { WorkloadError } from "./errors.js";
import type { DurationPredictor } from "./predictor.js";
import type { ForecastOptions, ForecastWindow, TaskRecord } from "./types.js";
import type { ExecutionHistory } from "./store.js";

export interface ForecasterOptions {
  /** Smoothing strength for hour-slot rates (pseudo-count added). Default: 2. */
  readonly seasonalityStrength?: number;
  /** Weight of the recency baseline vs the seasonal rate. Default: 0.5. */
  readonly recencyWeight?: number;
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

export class WorkloadForecaster {
  private readonly seasonalityStrength: number;
  private readonly recencyShare: number;

  constructor(options: ForecasterOptions = {}) {
    this.seasonalityStrength = options.seasonalityStrength ?? 2;
    this.recencyShare = options.recencyWeight ?? 0.5;
    if (this.seasonalityStrength < 0) {
      throw new WorkloadError("BAD_INPUT", "seasonalityStrength must be non-negative");
    }
    if (this.recencyShare < 0 || this.recencyShare > 1) {
      throw new WorkloadError("BAD_INPUT", "recencyWeight must be in [0,1]");
    }
  }

  /**
   * Project arrivals and busy time for the next `horizon` windows.
   *
   * - The recency baseline is the arrival count per window across the covered
   *   span (empty windows count as zero), which reacts to ramps and lulls.
   * - Hour-slot rates are shrunk toward the global rate with a pseudo-count so
   *   slots with one noisy observation do not dominate.
   * - Busy time uses the mix of kinds and each kind's predicted duration.
   */
  forecast(
    history: ExecutionHistory,
    predictor: DurationPredictor,
    options: ForecastOptions,
  ): ForecastWindow[] {
    const records = history.all();
    if (records.length === 0) throw new WorkloadError("EMPTY_HISTORY", "cannot forecast from an empty history");
    if (!Number.isInteger(options.horizon) || options.horizon < 1) {
      throw new WorkloadError("BAD_INPUT", `horizon must be a positive integer, got ${options.horizon}`);
    }
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new WorkloadError("BAD_INPUT", `windowMs must be positive, got ${windowMs}`);
    }

    const now = history.nowMs();
    const t0 = alignDown(records[0].startedAt, windowMs);

    // Count arrivals per window across the full covered span.
    const windowCount = Math.max(1, Math.floor((now - t0) / windowMs) + 1);
    const counts = new Array<number>(windowCount).fill(0);
    for (const r of records) {
      const idx = Math.floor((r.startedAt - t0) / windowMs);
      counts[Math.min(windowCount - 1, idx)] += 1;
    }
    const globalRate = records.length / windowCount;

    // Recency baseline: uniform mean over the covered span (empty windows count 0).
    const baseline = globalRate;

    // Hour-slot totals and how many windows of each slot the span covered.
    const slotTotals = new Map<number, { count: number; occurrences: number }>();
    for (let i = 0; i < windowCount; i++) {
      const slot = hourOf(t0 + i * windowMs);
      const entry = slotTotals.get(slot) ?? { count: 0, occurrences: 0 };
      entry.count += counts[i];
      entry.occurrences += 1;
      slotTotals.set(slot, entry);
    }

    const kindMix = kindMixOf(records);
    const windows: ForecastWindow[] = [];
    for (let h = 1; h <= options.horizon; h++) {
      const startAt = alignDown(now, windowMs) + h * windowMs;
      const slot = hourOf(startAt);
      const seasonal = slotRate(slotTotals.get(slot), globalRate, this.seasonalityStrength);
      const arrivals = this.recencyShare * baseline + (1 - this.recencyShare) * seasonal;
      const busyMs = [...kindMix.entries()].reduce((acc, [kind, share]) => {
        let expected = 0;
        try {
          expected = predictor.predict(kind, history.ofKind(kind), now).expectedDurationMs;
        } catch {
          expected = meanKindDuration(records, kind);
        }
        return acc + share * expected;
      }, 0);
      const expectedBusyMs = arrivals * busyMs;
      windows.push({
        startAt,
        hourSlot: slot,
        expectedArrivals: round(arrivals, 3),
        expectedBusyMs: Math.round(expectedBusyMs),
        workersNeeded: Math.max(1, Math.ceil(expectedBusyMs / windowMs)),
      });
    }
    return windows;
  }
}

function weightedRate(counts: readonly number[], weight: number): number {
  const pairs = counts.map((c) => [c, weight] as const);
  let acc = 0;
  for (const [v, w] of pairs) acc += v * w;
  return acc;
}

function slotRate(
  entry: { count: number; occurrences: number } | undefined,
  globalRate: number,
  strength: number,
): number {
  const count = entry?.count ?? 0;
  const occurrences = entry?.occurrences ?? 0;
  return (count + strength * globalRate) / (occurrences + strength);
}

function kindMixOf(records: readonly TaskRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const total = records.length;
  for (const [kind, n] of counts) counts.set(kind, n / total);
  return counts;
}

function meanKindDuration(records: readonly TaskRecord[], kind: string): number {
  const durations = records.filter((r) => r.kind === kind).map((r) => r.durationMs);
  if (durations.length === 0) return 0;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

function alignDown(ms: number, windowMs: number): number {
  return Math.floor(ms / windowMs) * windowMs;
}

function hourOf(ms: number): number {
  return new Date(ms).getUTCHours();
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
