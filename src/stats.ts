/** Numeric primitives: recency weighting, quantiles, dispersion. */

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("mean() of empty array");
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Unbiased sample standard deviation; 0 for n < 2. */
export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const ss = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

/**
 * Linear-interpolated quantile of an unsorted array.
 * q=0.5 is the median; q must be in [0, 1].
 */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new RangeError("quantile() of empty array");
  if (q < 0 || q > 1) throw new RangeError(`quantile q must be in [0,1], got ${q}`);
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

/** Weighted mean; weights must be non-negative and sum > 0. */
export function weightedMean(pairs: ReadonlyArray<readonly [value: number, weight: number]>): number {
  let wsum = 0;
  let acc = 0;
  for (const [value, weight] of pairs) {
    if (weight < 0) throw new RangeError("weights must be non-negative");
    wsum += weight;
    acc += value * weight;
  }
  if (wsum <= 0) throw new RangeError("weightedMean() requires positive total weight");
  return acc / wsum;
}

/**
 * Recency weight: an exponential decay with the given half-life.
 * A sample exactly halfLifeMs old weighs 0.5; two half-lives old weighs 0.25.
 */
export function recencyWeight(ageMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) throw new RangeError("halfLifeMs must be positive");
  return 0.5 ** (ageMs / halfLifeMs);
}

/** Weighted quantile: sort by value, walk accumulated normalized weights. */
export function weightedQuantile(
  pairs: ReadonlyArray<readonly [value: number, weight: number]>,
  q: number,
): number {
  if (pairs.length === 0) throw new RangeError("weightedQuantile() of empty list");
  if (q < 0 || q > 1) throw new RangeError(`quantile q must be in [0,1], got ${q}`);
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((acc, [, w]) => acc + w, 0);
  if (total <= 0) throw new RangeError("weightedQuantile() requires positive total weight");
  const target = q * total;
  let acc = 0;
  for (const [value, w] of sorted) {
    acc += w;
    if (acc >= target) return value;
  }
  return sorted[sorted.length - 1][0];
}

/** Coefficient of variation (stdev / mean). 0 for n < 2. */
export function dispersionOf(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  if (m === 0) return 0;
  return stdev(values) / m;
}

/**
 * Mean absolute percentage error between predictions and actuals.
 * Returns null when there is nothing to score or every actual is zero.
 */
export function mape(actual: readonly number[], predicted: readonly number[]): number | null {
  if (actual.length === 0 || actual.length !== predicted.length) return null;
  let total = 0;
  let usable = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === 0) continue;
    total += Math.abs((actual[i] - predicted[i]) / actual[i]);
    usable += 1;
  }
  return usable === 0 ? null : total / usable;
}
