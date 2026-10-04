#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawn } from "node:child_process";
import { acquireIsolatedTmpDir, buildIsolatedTmpEnv } from "./lib/isolated-tmp.mjs";

const KEEP_TMP_DIRS = 3;
const TMP_PREFIX = "noobot-test-tmp-";

const [command, ...commandArgs] = process.argv.slice(2);
if (!command) {
  process.stderr.write("usage: run-with-isolated-tmp.mjs <command> [...args]\n");
  process.exit(2);
}

const { dir: runTmpDir, created } = acquireIsolatedTmpDir({
  prefix: TMP_PREFIX,
  keep: KEEP_TMP_DIRS,
});

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  env: buildIsolatedTmpEnv(runTmpDir),
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

function finish(exitCode) {
  if (created && exitCode !== 0) {
    process.stderr.write(`[isolated-tmp] FAILED exit=${exitCode} tmp=${runTmpDir}\n`);
  }
  process.exit(exitCode);
}

child.on("error", (error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  finish(1);
});
child.on("close", (code, signal) => finish(code ?? (signal ? 1 : 0)));
