/** Append-only execution history with validation and bounded capacity. */

import type { Clock } from "./clock.js";
import { WorkloadError } from "./errors.js";
import type { HistorySnapshot, TaskRecord } from "./types.js";

export class ExecutionHistory {
  private readonly records: TaskRecord[] = [];
  private failures = 0;
  private readonly maxRecords: number;

  constructor(
    private readonly clock: Clock,
    options: { maxRecords?: number } = {},
  ) {
    this.maxRecords = options.maxRecords ?? 200_000;
    if (!Number.isInteger(this.maxRecords) || this.maxRecords < 1) {
      throw new WorkloadError("BAD_INPUT", "maxRecords must be a positive integer");
    }
  }

  /** Validate and append one execution record. Oldest records are evicted at capacity. */
  record(raw: TaskRecord): void {
    const record = validated(raw, this.clock.nowMs());
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      const dropped = this.records.shift();
      if (dropped && dropped.success === false) this.failures -= 1;
    }
    if (record.success === false) this.failures += 1;
  }

  /** Current time from the injected clock. */
  nowMs(): number {
    return this.clock.nowMs();
  }

  /** All records in arrival order. The array is a defensive copy. */
  all(): TaskRecord[] {
    return [...this.records];
  }

  /** Records of one kind, oldest first, defensive copy. */
  ofKind(kind: string): TaskRecord[] {
    return this.records.filter((r) => r.kind === kind);
  }

  kinds(): string[] {
    const seen = new Set<string>();
    for (const r of this.records) seen.add(r.kind);
    return [...seen].sort();
  }

  snapshot(): HistorySnapshot {
    const first = this.records[0];
    const last = this.records[this.records.length - 1];
    return {
      records: this.records.length,
      kinds: this.kinds(),
      failures: this.failures,
      firstAt: first ? first.startedAt : null,
      lastAt: last ? last.startedAt : null,
    };
  }
}

function validated(raw: TaskRecord, nowMs: number): TaskRecord {
  if (typeof raw.kind !== "string" || raw.kind.trim().length === 0) {
    throw new WorkloadError("BAD_INPUT", `record kind must be a non-empty string, got ${JSON.stringify(raw.kind)}`);
  }
  if (!Number.isFinite(raw.startedAt)) {
    throw new WorkloadError("BAD_INPUT", `record startedAt must be a finite epoch ms, got ${raw.startedAt}`);
  }
  if (raw.startedAt > nowMs) {
    throw new WorkloadError("BAD_INPUT", `record startedAt ${raw.startedAt} is in the future (now ${nowMs})`);
  }
  if (!Number.isFinite(raw.durationMs) || raw.durationMs <= 0) {
    throw new WorkloadError("BAD_INPUT", `record durationMs must be a positive finite number, got ${raw.durationMs}`);
  }
  if (raw.cpuMs !== undefined && (!Number.isFinite(raw.cpuMs) || raw.cpuMs < 0)) {
    throw new WorkloadError("BAD_INPUT", `record cpuMs must be a non-negative finite number, got ${raw.cpuMs}`);
  }
  if (raw.memMb !== undefined && (!Number.isFinite(raw.memMb) || raw.memMb < 0)) {
    throw new WorkloadError("BAD_INPUT", `record memMb must be a non-negative finite number, got ${raw.memMb}`);
  }
  return { ...raw, kind: raw.kind.trim() };
}
