#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import {
  getFirstPartyCodeFiles,
  isTestFilePath,
  readPackageJson,
  readRootWorkspacePaths,
} from "./quality/source-inventory.mjs";

const ISOLATED_TMP_RUNNER = "scripts/run-with-isolated-tmp.mjs";
const QUOTED_RECURSIVE_GLOB = /(["'])[^"']*\*\*[^"']*\1/;

function isolatedRunnerCommand(workspacePath) {
  return `node ${path.posix.relative(workspacePath, ISOLATED_TMP_RUNNER)} `;
}

function hasUnquotedRecursiveNodeTestGlob(testScript) {
  return (
    testScript.includes("node --test") &&
    testScript.includes("**") &&
    !QUOTED_RECURSIVE_GLOB.test(testScript)
  );
}

export async function measureWorkspaceTestIsolation(root) {
  const measured = emptyRuleMeasurements(CHECK);
  const workspacePaths = await readRootWorkspacePaths(root);
  const testFiles = (await getFirstPartyCodeFiles({ repositoryRoot: root })).filter(isTestFilePath);
  for (const workspacePath of workspacePaths) {
    const file = `${workspacePath}/package.json`;
    const { scripts } = await readPackageJson(path.join(root, file));
    const testScript = scripts?.test;
    if (!testScript) {
      const ownsTests = testFiles.some((testFile) => testFile.startsWith(`${workspacePath}/`));
      if (ownsTests)
        addHit(measured.missingTestScript, { file, message: "has tests but no test script" });
      continue;
    }
    const runner = isolatedRunnerCommand(workspacePath);
    if (!testScript.includes(runner)) {
      addHit(measured.unisolatedTestScript, {
        file,
        message: `expected "${runner.trim()}" in "${testScript}"`,
      });
    }
    if (hasUnquotedRecursiveNodeTestGlob(testScript)) {
      addHit(measured.unquotedRecursiveGlob, { file, message: `unquoted ** in "${testScript}"` });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "workspace-test-isolation",
  description: "Workspace test scripts exist, run through the isolated tmp runner and quote globs",
  rules: {
    missingTestScript: {
      description: "A workspace that owns test files declares no test script",
      hint: "add a test script so npm test --workspaces runs those tests",
    },
    unisolatedTestScript: {
      description: "A workspace test script bypasses the isolated tmp runner",
      hint: `prefix the test command with node <relative>/${ISOLATED_TMP_RUNNER}`,
    },
    unquotedRecursiveGlob: {
      description: "A node --test command passes an unquoted ** glob",
      hint: 'quote the glob, e.g. node --test "__tests__/**/*.test.js", for cross-shell discovery',
    },
  },
  exemptions: [],
  baseline: {
    missingTestScript: 0,
    unisolatedTestScript: 0,
    unquotedRecursiveGlob: 0,
    exemptions: 0,
  },
  measure: () => measureWorkspaceTestIsolation(repositoryRoot),
});

await runCheckWhenMain(CHECK, import.meta.url);
