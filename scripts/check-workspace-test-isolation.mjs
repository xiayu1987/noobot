#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ISOLATED_TMP_RUNNER = "scripts/run-with-isolated-tmp.mjs";

function readPackageJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function expectedRunnerPath(workspacePath) {
  return path.posix.relative(workspacePath.split(path.sep).join("/"), ISOLATED_TMP_RUNNER);
}

export function findTestIsolationViolations(root) {
  const rootPackage = readPackageJson(path.join(root, "package.json"));
  const workspacePaths = Array.isArray(rootPackage.workspaces)
    ? rootPackage.workspaces
    : rootPackage.workspaces?.packages || [];
  const violations = [];
  for (const workspacePath of workspacePaths) {
    const workspacePackage = readPackageJson(path.join(root, workspacePath, "package.json"));
    const testScript = workspacePackage.scripts?.test;
    if (!testScript) continue;
    const runner = `node ${expectedRunnerPath(workspacePath)} `;
    if (!testScript.includes(runner)) violations.push({ workspacePath, runner, testScript });
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = findTestIsolationViolations(process.cwd());
  if (violations.length) {
    console.error(`Workspace test scripts must run through ${ISOLATED_TMP_RUNNER}:`);
    for (const { workspacePath, runner, testScript } of violations) {
      console.error(`- ${workspacePath}: expected "${runner.trim()}" in "${testScript}"`);
    }
    process.exit(1);
  }
}
