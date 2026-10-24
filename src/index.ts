/** Public API for agent-workload-predictor. */

export type {
  DurationPrediction,
  ForecastOptions,
  ForecastWindow,
  HistorySnapshot,
  ResourcePrediction,
  TaskRecord,
} from "./types.js";
export { WorkloadError, exitCodeOf, type ErrorCode } from "./errors.js";
export { SystemClock, ManualClock, type Clock } from "./clock.js";
export { ExecutionHistory } from "./store.js";
export { DurationPredictor, ResourcePredictor, type PredictorOptions } from "./predictor.js";
export { mape, mean, quantile, weightedMean, weightedQuantile, recencyWeight } from "./stats.js";
export { WorkloadForecaster, type ForecasterOptions } from "./forecaster.js";
export { WorkloadPredictor, type WorkloadPredictorOptions } from "./engine.js";
export { runDemo, buildScenario } from "./demo.js";
export { runCli, usage, type CliInvocation, type CliResult } from "./cli.js";
