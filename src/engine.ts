/** Facade tying history, predictors, and forecaster into one API. */

import type {
  DurationPrediction,
  ForecastOptions,
  ForecastWindow,
  HistorySnapshot,
  ResourcePrediction,
  TaskRecord,
} from "./types.js";
import { WorkloadError } from "./errors.js";
import type { Clock } from "./clock.js";
import { ExecutionHistory } from "./store.js";
import { DurationPredictor, ResourcePredictor, type PredictorOptions } from "./predictor.js";
import { WorkloadForecaster, type ForecasterOptions } from "./forecaster.js";

export interface WorkloadPredictorOptions {
  readonly predictor?: PredictorOptions;
  readonly forecaster?: ForecasterOptions;
  readonly maxRecords?: number;
}

export class WorkloadPredictor {
  private readonly clock: Clock;
  private readonly history: ExecutionHistory;
  private readonly durationPredictor: DurationPredictor;
  private readonly resourcePredictor: ResourcePredictor;
  private readonly forecaster: WorkloadForecaster;

  constructor(clock: Clock, options: WorkloadPredictorOptions = {}) {
    this.clock = clock;
    this.history = new ExecutionHistory(clock, { maxRecords: options.maxRecords });
    this.durationPredictor = new DurationPredictor(options.predictor);
    this.resourcePredictor = new ResourcePredictor();
    this.forecaster = new WorkloadForecaster(options.forecaster);
  }

  record(execution: TaskRecord): void {
    this.history.record(execution);
  }

  predict(kind: string): DurationPrediction {
    return this.durationPredictor.predict(kind, this.history.ofKind(kind), this.clock.nowMs());
  }

  predictResources(kind: string): ResourcePrediction {
    return this.resourcePredictor.predict(kind, this.history.ofKind(kind));
  }

  forecast(options?: ForecastOptions): ForecastWindow[] {
    return this.forecaster.forecast(this.history, this.durationPredictor, options ?? { horizon: 6 });
  }

  kinds(): string[] {
    return this.history.kinds();
  }

  snapshot(): HistorySnapshot {
    return this.history.snapshot();
  }

  /** Throws UNKNOWN_KIND when the kind has never been observed. */
  requireKind(kind: string): void {
    if (!this.history.kinds().includes(kind)) {
      throw new WorkloadError("UNKNOWN_KIND", `no history recorded for kind "${kind}"`);
    }
  }
}
