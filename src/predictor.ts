/** Duration and resource estimators over execution history. */

import type { DurationPrediction, ResourcePrediction, TaskRecord } from "./types.js";
import { WorkloadError } from "./errors.js";
import { dispersionOf, mean, quantile, recencyWeight, weightedMean, weightedQuantile } from "./stats.js";

export interface PredictorOptions {
  /** Half-life for recency weighting (ms). Older samples matter less. Default: 7 days. */
  readonly halfLifeMs?: number;
  /** Minimum samples before a prediction is offered. Default: 3. */
  readonly minSamples?: number;
}

/** Recency-weighted duration estimator for one task kind. */
export class DurationPredictor {
  private readonly halfLifeMs: number;
  private readonly minSamples: number;

  constructor(options: PredictorOptions = {}) {
    this.halfLifeMs = options.halfLifeMs ?? 7 * 24 * 3600 * 1000;
    this.minSamples = options.minSamples ?? 3;
    if (this.halfLifeMs <= 0) throw new WorkloadError("BAD_INPUT", "halfLifeMs must be positive");
    if (!Number.isInteger(this.minSamples) || this.minSamples < 1) {
      throw new WorkloadError("BAD_INPUT", "minSamples must be a positive integer");
    }
  }

  predict(kind: string, samples: readonly TaskRecord[], nowMs: number): DurationPrediction {
    if (samples.length < this.minSamples) {
      throw new WorkloadError(
        "INSUFFICIENT_HISTORY",
        `kind "${kind}" has ${samples.length} sample(s), need >= ${this.minSamples}`,
      );
    }
    const pairs = samples.map(
      (s) => [s.durationMs, recencyWeight(Math.max(0, nowMs - s.startedAt), this.halfLifeMs)] as const,
    );
    const expected = weightedMean(pairs);
    const durations = samples.map((s) => s.durationMs);
    const interval = {
      low: weightedQuantile(pairs, 0.1),
      high: weightedQuantile(pairs, 0.9),
    };
    const sampleConfidence = samples.length / (samples.length + 5);
    const cv = dispersionOf(durations);
    const confidence = sampleConfidence * (1 - 0.5 * Math.min(1, cv));
    return { kind, expectedDurationMs: expected, interval, confidence, samples: samples.length };
  }
}

/** Percentile estimates of CPU and memory demand per task kind. */
export class ResourcePredictor {
  predict(kind: string, samples: readonly TaskRecord[]): ResourcePrediction {
    const withCpu = samples.filter((s) => s.cpuMs !== undefined).map((s) => s.cpuMs as number);
    const withMem = samples.filter((s) => s.memMb !== undefined).map((s) => s.memMb as number);
    return {
      kind,
      cpuP50Ms: withCpu.length > 0 ? quantile(withCpu, 0.5) : null,
      cpuP95Ms: withCpu.length > 0 ? quantile(withCpu, 0.95) : null,
      memP50Mb: withMem.length > 0 ? quantile(withMem, 0.5) : null,
      memP95Mb: withMem.length > 0 ? quantile(withMem, 0.95) : null,
    };
  }

  /** Kind-level mean CPU share of wall time, or null when CPU was never recorded. */
  cpuShare(kind: string, samples: readonly TaskRecord[]): number | null {
    const paired = samples.filter((s) => s.cpuMs !== undefined);
    if (paired.length === 0) return null;
    const shares = paired.map((s) => (s.cpuMs as number) / s.durationMs);
    return mean(shares);
  }
}
