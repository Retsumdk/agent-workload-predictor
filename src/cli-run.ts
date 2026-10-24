#!/usr/bin/env bun
/** Executable entry point for the `awp` CLI. */

import { runCli } from "./cli.js";

const exitCode = await runCli({
  argv: process.argv.slice(2),
  stdin: null,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
process.exit(exitCode.exitCode);
