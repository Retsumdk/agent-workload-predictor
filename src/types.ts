/** Core value types shared across the prediction pipeline. */

/** One completed (or failed) task execution from the operational history. */
export interface TaskRecord {
  /** Task kind, e.g. "summarize", "translate", "tool-call". */
  readonly kind: string;
  /** Epoch ms when the task started. Must not be in the future relative to the clock. */
  readonly startedAt: number;
  /** Wall duration of the execution in milliseconds (> 0). */
  readonly durationMs: number;
  /** CPU time consumed in milliseconds (optional). */
  readonly cpuMs?: number;
  /** Peak memory in MB (optional). */
  readonly memMb?: number;
  /** Whether the execution succeeded. */
  readonly success?: boolean;
}

export interface Interval {
  readonly low: number;
  readonly high: number;
}

export interface DurationPrediction {
  readonly kind: string;
  /** Recency-weighted expected duration in ms. */
  readonly expectedDurationMs: number;
  /** Weighted p10..p90 interval over the observed samples. */
  readonly interval: Interval;
  /** 0..1 — grows with sample count, shrinks with dispersion. */
  readonly confidence: number;
  /** Samples that fed the prediction. */
  readonly samples: number;
}

export interface ResourcePrediction {
  readonly kind: string;
  readonly cpuP50Ms: number | null;
  readonly cpuP95Ms: number | null;
  readonly memP50Mb: number | null;
  readonly memP95Mb: number | null;
}

export interface ForecastOptions {
  /** Number of future windows to project (>= 1). */
  readonly horizon: number;
  /** Window length in ms (default: one hour). */
  readonly windowMs?: number;
}

export interface ForecastWindow {
  /** Epoch ms of the window start. */
  readonly startAt: number;
  /** Hour-of-day slot (UTC 0-23) used for the seasonality adjustment. */
  readonly hourSlot: number;
  /** Projected task arrivals in this window. */
  readonly expectedArrivals: number;
  /** Projected total busy time in ms (arrivals x expected duration, mix-weighted). */
  readonly expectedBusyMs: number;
  /** ceil(expectedBusyMs / windowMs) — sequential single-worker equivalents. */
  readonly workersNeeded: number;
}

export interface HistorySnapshot {
  readonly records: number;
  readonly kinds: readonly string[];
  readonly failures: number;
  readonly firstAt: number | null;
  readonly lastAt: number | null;
}
