#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawnSync } from "node:child_process";
import { QUALITY_STEPS } from "./quality/quality-steps.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";

function runStep(step) {
  const result = spawnSync("npm", ["run", "-s", step], {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const failures = [];
for (const step of QUALITY_STEPS) {
  const exitCode = runStep(step);
  if (exitCode !== 0) failures.push({ step, exitCode });
}

if (failures.length === 0) {
  process.stdout.write(`[quality] passed ${QUALITY_STEPS.length}/${QUALITY_STEPS.length}\n`);
} else {
  process.stderr.write(`[quality] failed ${failures.length}/${QUALITY_STEPS.length}\n`);
  for (const { step, exitCode } of failures) {
    process.stderr.write(`[quality] failed step ${step} exit=${exitCode}\n`);
  }
  process.exitCode = 1;
}
