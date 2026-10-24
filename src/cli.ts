/** CLI surface (pure): parse args, load history, render output. */

import { readFileSync } from "node:fs";
import type { TaskRecord } from "./types.js";
import { ManualClock } from "./clock.js";
import { WorkloadPredictor } from "./engine.js";
import { WorkloadError, exitCodeOf } from "./errors.js";
import { runDemo } from "./demo.js";

const HOUR = 3_600_000;

export interface CliInvocation {
  readonly argv: readonly string[];
  readonly stdin: string | null;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

export interface CliResult {
  readonly exitCode: number;
}

export async function runCli(inv: CliInvocation): Promise<CliResult> {
  const [command, ...rest] = inv.argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    inv.log(usage());
    return { exitCode: command ? 0 : 2 };
  }
  if (command === "demo") {
    inv.log(runDemo());
    return { exitCode: 0 };
  }
  if (command !== "forecast" && command !== "predict") {
    inv.error(`unknown command: ${command}`);
    inv.error(usage());
    return { exitCode: 2 };
  }

  try {
    const flags = parseFlags(rest);
    const records = loadRecords(inv, flags.history);
    const clock = flags.now !== null ? new ManualClock(flags.now) : undefined;
    if (clock) clock.set(flags.now as number);
    const wp = new WorkloadPredictor(clock ?? new ManualClock(maxStart(records) + 1), { maxRecords: 1_000_000 });
    for (const r of records) wp.record(r);

    if (command === "predict") {
      const kind = flags.kind ?? wp.kinds()[0];
      wp.requireKind(kind);
      const p = wp.predict(kind);
      const r = wp.predictResources(kind);
      inv.log(`kind            ${p.kind}`);
      inv.log(`samples         ${p.samples}`);
      inv.log(`expected        ${p.expectedDurationMs.toFixed(0)}ms`);
      inv.log(`p10-p90         [${p.interval.low.toFixed(0)}ms, ${p.interval.high.toFixed(0)}ms]`);
      inv.log(`confidence      ${p.confidence.toFixed(2)}`);
      inv.log(`cpu p50/p95     ${fmtNum(r.cpuP50Ms)} / ${fmtNum(r.cpuP95Ms)} ms`);
      inv.log(`mem p50/p95     ${fmtNum(r.memP50Mb)} / ${fmtNum(r.memP95Mb)} MB`);
      return { exitCode: 0 };
    }

    const windowMs = (flags.windowMinutes ?? 60) * 60_000;
    const windows = wp.forecast({ horizon: flags.horizon ?? 6, windowMs });
    inv.log("start(UTC)        slot  arrivals  busy(s)  workers");
    for (const w of windows) {
      inv.log(
        `${new Date(w.startAt).toISOString().slice(0, 16).replace("T", " ")}  ${String(w.hourSlot).padStart(2, "0")}:00` +
          `  ${w.expectedArrivals.toFixed(1).padStart(8)}` +
          `  ${(w.expectedBusyMs / 1000).toFixed(1).padStart(7)}` +
          `  ${String(w.workersNeeded).padStart(7)}`,
      );
    }
    return { exitCode: 0 };
  } catch (e) {
    inv.error(e instanceof Error ? e.message : String(e));
    return { exitCode: exitCodeOf(e) };
  }
}

interface Flags {
  history: string | null;
  kind: string | null;
  horizon: number | null;
  windowMinutes: number | null;
  now: number | null;
}

function parseFlags(args: readonly string[]): Flags {
  const flags: Flags = { history: null, kind: null, horizon: null, windowMinutes: null, now: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = (): string => {
      if (i + 1 >= args.length) throw new Error(`flag ${a} requires a value`);
      return args[++i];
    };
    if (a === "--history") flags.history = next();
    else if (a === "--kind") flags.kind = next();
    else if (a === "--horizon") flags.horizon = parsePositiveInt(a, next());
    else if (a === "--window-minutes") flags.windowMinutes = parsePositiveInt(a, next());
    else if (a === "--now") flags.now = parsePositiveInt(a, next());
    else throw new Error(`unknown flag: ${a}`);
  }
  return flags;
}

function parsePositiveInt(flag: string, raw: string): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) throw new Error(`${flag} expects a positive integer, got "${raw}"`);
  return v;
}

function loadRecords(inv: CliInvocation, historyPath: string | null): TaskRecord[] {
  const raw = historyPath !== null ? readFileSync(historyPath, "utf-8") : (inv.stdin ?? "");
  if (raw.trim().length === 0) {
    throw new WorkloadError("BAD_INPUT", "no history provided: pass --history <file.jsonl> or pipe JSONL on stdin");
  }
  const records: TaskRecord[] = [];
  for (const [i, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      records.push(JSON.parse(trimmed) as TaskRecord);
    } catch {
      throw new WorkloadError("BAD_INPUT", `history line ${i + 1} is not valid JSON: ${trimmed.slice(0, 60)}`);
    }
  }
  if (records.length === 0) throw new WorkloadError("EMPTY_HISTORY", "history file contained no records");
  return records;
}

function maxStart(records: readonly TaskRecord[]): number {
  return Math.max(...records.map((r) => r.startedAt));
}

function fmtNum(v: number | null): string {
  return v === null ? "n/a" : String(Math.round(v));
}

export function usage(): string {
  return [
    "awp - workload prediction for agent task history",
    "",
    "Commands:",
    "  awp demo                        Run the deterministic end-to-end demo",
    "  awp predict [--history f.jsonl] [--kind summarize] [--now <epoch-ms>]",
    "                                  Predict duration + resources for one kind",
    "  awp forecast [--history f.jsonl] [--horizon 6] [--window-minutes 60]",
    "                                  Project arrivals and busy time forward",
    "",
    "History format: JSONL, one TaskRecord per line:",
    '  {"kind":"summarize","startedAt":1792222800000,"durationMs":1850,"cpuMs":420,"memMb":71,"success":true}',
    "",
    "Exit codes: 0 ok | 1 runtime error | 2 usage | 3 insufficient history | 4 unknown kind | 5 bad input",
  ].join("\n");
}
