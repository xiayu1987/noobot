/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("full E2E declares the complete non-performance project without grep filters", async () => {
  const clientRoot = path.resolve(import.meta.dirname, "../client/noobot-chat");
  const { stdout } = await execFileAsync(
    process.execPath,
    ["tests/e2e/protocol/run-suite.js", "full", "--list", "--reporter=json"],
    { cwd: clientRoot, maxBuffer: 4 * 1024 * 1024 },
  );
  const report = JSON.parse(stdout);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    report.config.projects.map((project) => project.name),
    ["chromium-protocol"],
  );
  const [project] = report.config.projects;
  assert.ok(!report.config.argv.some((argument) => argument.startsWith("--grep")));
  assert.equal(report.config.grepInvert, null);
  const ignored = project.testIgnore.map((pattern) => new RegExp(pattern.slice(1, -1)));
  const expectedFiles = (await readdir(path.join(clientRoot, "tests/e2e/protocol/specs")))
    .filter((file) => file.endsWith(".spec.js") && !ignored.some((pattern) => pattern.test(file)))
    .sort();
  assert.ok(expectedFiles.length > 0);
  assert.deepEqual(report.suites.map((suite) => path.basename(suite.file)).sort(), expectedFiles);
});
