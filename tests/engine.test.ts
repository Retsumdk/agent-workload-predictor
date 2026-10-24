import { describe, expect, test } from "bun:test";
import { ManualClock } from "../src/clock.js";
import { WorkloadPredictor } from "../src/engine.js";
import { WorkloadError } from "../src/errors.js";
import { buildScenario, runDemo } from "../src/demo.js";
import type { CliInvocation, CliResult } from "../src/cli.js";
import { runCli } from "../src/cli.js";

const HOUR = 3_600_000;

describe("WorkloadPredictor", () => {
  test("end-to-end: record, predict, forecast, snapshot", () => {
    const clock = new ManualClock(10 * HOUR);
    const wp = new WorkloadPredictor(clock);
    for (let i = 0; i < 5; i++) {
      wp.record({ kind: "summarize", startedAt: i * HOUR, durationMs: 1_000 + i * 10 });
    }
    wp.record({ kind: "summarize", startedAt: 5 * HOUR, durationMs: 1_500, success: false });

    expect(wp.kinds()).toEqual(["summarize"]);
    const p = wp.predict("summarize");
    expect(p.expectedDurationMs).toBeGreaterThan(1_000);
    expect(p.confidence).toBeGreaterThan(0);
    const r = wp.predictResources("summarize");
    expect(r.cpuP50Ms).toBeNull();
    expect(wp.snapshot().failures).toBe(1);
    const windows = wp.forecast({ horizon: 2 });
    expect(windows).toHaveLength(2);
    expect(windows[1].startAt).toBeGreaterThan(windows[0].startAt);
  });

  test("requireKind rejects unknown kinds", () => {
    const wp = new WorkloadPredictor(new ManualClock(0));
    expect(() => wp.requireKind("ghost")).toThrow(WorkloadError);
  });

  test("invalid records propagate coded errors", () => {
    const wp = new WorkloadPredictor(new ManualClock(1_000));
    expect(() => wp.record({ kind: "a", startedAt: 2_000, durationMs: 1 })).toThrow(WorkloadError);
  });
});

describe("demo", () => {
  test("deterministic output across runs", () => {
    expect(runDemo()).toBe(runDemo());
  });

  test("scenario is sorted and well-formed", () => {
    const records = buildScenario().records;
    expect(records.length).toBeGreaterThan(1_000);
    for (let i = 1; i < records.length; i++) {
      expect(records[i].startedAt).toBeGreaterThanOrEqual(records[i - 1].startedAt);
      expect(records[i].durationMs).toBeGreaterThan(0);
    }
  });
});

describe("cli", () => {
  function invoke(argv: string[], stdin: string | null = null): { out: string[]; err: string[]; code: number } {
    const out: string[] = [];
    const err: string[] = [];
    const inv: CliInvocation = { argv, stdin, log: (l) => out.push(l), error: (l) => err.push(l) };
    const res: CliResult = undefined as unknown as CliResult;
    void res;
    let code = 0;
    // runCli is async; drive it synchronously through the microtask queue
    let done = false;
    runCli(inv).then((r) => {
      code = r.exitCode;
      done = true;
    });
    if (!done) {
      // flush microtasks deterministically
      void Promise.resolve();
    }
    return { out, err, code: code === 0 && !done ? 0 : code };
  }

  test("help exits 0 and prints usage", async () => {
    const out: string[] = [];
    const r = await runCli({ argv: ["help"], stdin: null, log: (l) => out.push(l), error: () => {} });
    expect(r.exitCode).toBe(0);
    expect(out.join("\n")).toContain("awp forecast");
  });

  test("forecast from stdin JSONL", async () => {
    const lines = [
      JSON.stringify({ kind: "job", startedAt: HOUR, durationMs: 2_000 }),
      JSON.stringify({ kind: "job", startedAt: 2 * HOUR, durationMs: 2_100 }),
      JSON.stringify({ kind: "job", startedAt: 3 * HOUR, durationMs: 1_900 }),
    ].join("\n");
    const out: string[] = [];
    const r = await runCli({
      argv: ["forecast", "--horizon", "2", "--window-minutes", "60"],
      stdin: lines,
      log: (l) => out.push(l),
      error: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(out.join("\n")).toContain("slot");
  });

  test("predict with an explicit kind", async () => {
    const lines = [1_000, 1_100, 1_200]
      .map((d, i) => JSON.stringify({ kind: "job", startedAt: i * HOUR, durationMs: d }))
      .join("\n");
    const out: string[] = [];
    const r = await runCli({
      argv: ["predict", "--kind", "job", "--now", String(4 * HOUR)],
      stdin: lines,
      log: (l) => out.push(l),
      error: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(out.join("\n")).toContain("expected");
  });

  test("missing history exits 5", async () => {
    const err: string[] = [];
    const r = await runCli({ argv: ["forecast"], stdin: null, log: () => {}, error: (l) => err.push(l) });
    expect(r.exitCode).toBe(5);
    expect(err.join("\n")).toContain("no history provided");
  });

  test("unknown kind exits 4", async () => {
    const lines = [1_000, 1_100, 1_200]
      .map((d, i) => JSON.stringify({ kind: "job", startedAt: i * HOUR, durationMs: d }))
      .join("\n");
    const r = await runCli({
      argv: ["predict", "--kind", "ghost", "--now", String(4 * HOUR)],
      stdin: lines,
      log: () => {},
      error: () => {},
    });
    expect(r.exitCode).toBe(4);
  });

  test("bad usage exits 2", async () => {
    const r = await runCli({ argv: ["bogus"], stdin: null, log: () => {}, error: () => {} });
    expect(r.exitCode).toBe(2);
  });
});
