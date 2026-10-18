/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { measureWorkspaceTestIsolation } from "./check-workspace-test-isolation.mjs";

function writeFile(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function fixture(t, workspaces) {
  const root = mkdtempSync(path.join(os.tmpdir(), "noobot-test-isolation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ workspaces: Object.keys(workspaces) }),
  );
  for (const [workspacePath, { test: testScript, testFile }] of Object.entries(workspaces)) {
    const scripts = testScript ? { test: testScript } : {};
    writeFile(path.join(root, workspacePath, "package.json"), JSON.stringify({ scripts }));
    if (testFile) writeFile(path.join(root, workspacePath, testFile), "");
  }
  return root;
}

function hitFiles(measured) {
  return Object.fromEntries(
    Object.entries(measured).map(([rule, { files }]) => [rule, Object.keys(files)]),
  );
}

test("accepts isolated, quoted test scripts at any depth and test-free workspaces", async (t) => {
  const root = fixture(t, {
    shallow: {
      test: 'node ../scripts/run-with-isolated-tmp.mjs node --test "__tests__/**/*.test.js"',
    },
    "client/deep": {
      test: "NODE_OPTIONS=--x node ../../scripts/run-with-isolated-tmp.mjs vitest run",
    },
    "no-tests": {},
  });
  assert.deepEqual(hitFiles(await measureWorkspaceTestIsolation(root)), {
    missingTestScript: [],
    unisolatedTestScript: [],
    unquotedRecursiveGlob: [],
  });
});

test("reports missing scripts, bypassed runners, wrong depth and unquoted globs", async (t) => {
  const root = fixture(t, {
    bare: { test: "node --test __tests__/**/*.test.js" },
    "client/deep": { test: "node ../scripts/run-with-isolated-tmp.mjs vitest run" },
    silent: { testFile: "__tests__/a.test.js" },
  });
  assert.deepEqual(hitFiles(await measureWorkspaceTestIsolation(root)), {
    missingTestScript: ["silent/package.json"],
    unisolatedTestScript: ["bare/package.json", "client/deep/package.json"],
    unquotedRecursiveGlob: ["bare/package.json"],
  });
});
