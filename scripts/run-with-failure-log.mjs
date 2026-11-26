#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { acquireIsolatedTmpDir, buildIsolatedTmpEnv, pruneOldest } from "./lib/isolated-tmp.mjs";

const KEEP_LOGS = 10;
const KEEP_TMP_DIRS = 3;
const TMP_PREFIX = "noobot-test-run-";

const [script, ...scriptArgs] = process.argv.slice(2);
const npmCli = process.env.npm_execpath;
if (!script || !npmCli) {
  process.stderr.write("usage: run-with-failure-log.mjs <npm script> [...args] (via npm run)\n");
  process.exit(2);
}

const logDir = path.resolve(process.cwd(), "test-results", "test-runs");
mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runName = `npm-${stamp}`;
const logPath = path.join(logDir, `${runName}.log`);
const logStream = createWriteStream(logPath);

const { dir: runTmpDir } = await acquireIsolatedTmpDir({ prefix: TMP_PREFIX, keep: KEEP_TMP_DIRS });

const child = spawn(process.execPath, [npmCli, "run", "-s", script, "--", ...scriptArgs], {
  stdio: ["inherit", "pipe", "pipe"],
  env: buildIsolatedTmpEnv(runTmpDir),
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  logStream.write(chunk);
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  logStream.write(chunk);
});

function finish(exitCode, trailer = "") {
  const passed = exitCode === 0;
  const status = passed
    ? `[run] PASSED exit=0 log=${logPath} tmp=${runTmpDir}\n`
    : `[run] FAILED exit=${exitCode} log=${logPath} tmp=${runTmpDir}\n`;
  logStream.end(`${trailer}${status}`, () => {
    pruneOldest(logDir, (name) => name.endsWith(".log"), KEEP_LOGS)
      .then(() => {
        process.stderr.write(status);
        process.exit(exitCode);
      })
      .catch((error) => {
        process.stderr.write(
          `${status}${inspect(error, { colors: false, customInspect: false })}\n`,
        );
        process.exit(1);
      });
  });
}

let launchError;
child.once("error", (error) => {
  launchError = error;
});
child.once("close", (code) => {
  if (launchError) {
    finish(1, `${inspect(launchError, { colors: false, customInspect: false })}\n`);
    return;
  }
  finish(code ?? 1);
});
