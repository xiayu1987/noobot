#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const [command, ...commandArgs] = process.argv.slice(2);
if (!command) {
  process.stderr.write("usage: run-with-failure-log.mjs <command> [...args]\n");
  process.exit(2);
}

const logDir = path.resolve(process.cwd(), "test-results");
mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = path.join(logDir, `${path.basename(command)}-${stamp}.log`);
const logStream = createWriteStream(logPath);

const child = spawn(command, commandArgs, { stdio: ["inherit", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  logStream.write(chunk);
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  logStream.write(chunk);
});

child.on("error", (error) => {
  logStream.end(`${error.stack || error.message}\n`);
  process.stderr.write(`failure log kept: ${logPath}\n`);
  process.exit(1);
});

child.on("close", (code, signal) => {
  const exitCode = code ?? (signal ? 1 : 0);
  logStream.end(() => {
    if (exitCode === 0) {
      rmSync(logPath, { force: true });
    } else {
      process.stderr.write(`failure log kept: ${logPath}\n`);
    }
    process.exit(exitCode);
  });
});
