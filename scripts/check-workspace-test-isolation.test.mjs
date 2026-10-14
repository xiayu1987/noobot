/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findTestIsolationViolations } from "./check-workspace-test-isolation.mjs";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function fixture(t, workspaceTests) {
  const root = mkdtempSync(path.join(os.tmpdir(), "noobot-test-isolation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(root, "package.json"), { workspaces: Object.keys(workspaceTests) });
  for (const [workspacePath, testScript] of Object.entries(workspaceTests)) {
    const scripts = testScript ? { test: testScript } : {};
    writeJson(path.join(root, workspacePath, "package.json"), { scripts });
  }
  return root;
}

test("accepts test scripts wrapped by the isolated tmp runner at any depth", (t) => {
  const root = fixture(t, {
    shallow: "node ../scripts/run-with-isolated-tmp.mjs node --test",
    "client/deep": "NODE_OPTIONS=--x node ../../scripts/run-with-isolated-tmp.mjs vitest run",
    "no-tests": "",
  });
  assert.deepEqual(findTestIsolationViolations(root), []);
});

test("reports unwrapped test scripts and runners referenced with the wrong depth", (t) => {
  const root = fixture(t, {
    bare: "node --test __tests__/*.test.js",
    "client/deep": "node ../scripts/run-with-isolated-tmp.mjs vitest run",
  });
  assert.deepEqual(
    findTestIsolationViolations(root).map(({ workspacePath }) => workspacePath),
    ["bare", "client/deep"],
  );
});
