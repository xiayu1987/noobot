#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import process from "node:process";
import { validateRequestLogOrder } from "./quality/model-context-convergence/request-log-audit.mjs";

const logPaths = process.argv.slice(2);
if (!logPaths.length) {
  process.stderr.write("usage: npm run audit:model-request-log -- <model-proxy log>...\n");
  process.exit(2);
}

const failures = [];
const passes = [];
for (const logPath of logPaths) {
  validateRequestLogOrder(logPath, {
    fail: (title, detail) => failures.push(detail ? `${title}\n${detail}` : title),
    pass: (title) => passes.push(title),
  });
}

for (const line of passes) process.stdout.write(`[model-request-log] ${line}\n`);
if (failures.length) {
  process.stderr.write(
    `[model-request-log] failed\n${failures.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}
