import { describe, expect, test } from "bun:test";
import { ManualClock } from "../src/clock.js";
import { ExecutionHistory } from "../src/store.js";
import { WorkloadError } from "../src/errors.js";
import type { TaskRecord } from "../src/types.js";

const HOUR = 3_600_000;

describe("ExecutionHistory", () => {
  test("records, filters, and snapshots", () => {
    const clock = new ManualClock(1_000);
    const h = new ExecutionHistory(clock);
    h.record({ kind: "a", startedAt: 100, durationMs: 10 });
    h.record({ kind: "b", startedAt: 200, durationMs: 20, success: false });
    h.record({ kind: "a", startedAt: 300, durationMs: 30 });
    expect(h.kinds()).toEqual(["a", "b"]);
    expect(h.ofKind("a").map((r) => r.durationMs)).toEqual([10, 30]);
    expect(h.snapshot()).toEqual({
      records: 3,
      kinds: ["a", "b"],
      failures: 1,
      firstAt: 100,
      lastAt: 300,
    });
    // defensive copies
    h.all().pop();
    expect(h.snapshot().records).toBe(3);
  });

  test("rejects future records, bad durations, empty kinds", () => {
    const clock = new ManualClock(1_000);
    const h = new ExecutionHistory(clock);
    expect(() => h.record({ kind: "a", startedAt: 1_001, durationMs: 1 })).toThrow(WorkloadError);
    expect(() => h.record({ kind: "a", startedAt: 0, durationMs: 0 })).toThrow(WorkloadError);
    expect(() => h.record({ kind: "  ", startedAt: 0, durationMs: 1 })).toThrow(WorkloadError);
    expect(() => h.record({ kind: "a", startedAt: 0, durationMs: 1, cpuMs: -1 })).toThrow(WorkloadError);
  });

  test("evicts oldest at capacity and keeps the failure count consistent", () => {
    const clock = new ManualClock(10_000);
    const h = new ExecutionHistory(clock, { maxRecords: 2 });
    const rec = (startedAt: number, success?: boolean): TaskRecord => ({
      kind: "a",
      startedAt,
      durationMs: 10,
      success,
    });
    h.record(rec(1));
    h.record(rec(2, false));
    expect(h.snapshot().failures).toBe(1);
    h.record(rec(3));
    // FIFO evicted rec(1); the failure record is still in the window
    expect(h.snapshot()).toMatchObject({ records: 2, failures: 1, firstAt: 2, lastAt: 3 });
    h.record(rec(4));
    // now the failure record itself was evicted; the count drops back to 0
    expect(h.snapshot()).toMatchObject({ records: 2, failures: 0, firstAt: 3, lastAt: 4 });
  });

  test("bad constructor options fail fast", () => {
    const clock = new ManualClock(0);
    expect(() => new ExecutionHistory(clock, { maxRecords: 0 })).toThrow(WorkloadError);
  });
});
