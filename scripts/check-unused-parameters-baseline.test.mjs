/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  createUnusedParameterLinter,
  measureLintResults,
} from "./check-unused-parameters-baseline.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const fixturePath = path.join(repositoryRoot, "scripts/quality/unused-parameter-fixture.js");
const eslint = createUnusedParameterLinter(repositoryRoot);

async function countSource(source) {
  const results = await eslint.lintText(source, { filePath: fixturePath });
  return measureLintResults(results, repositoryRoot).total;
}

test("counts leading positional parameters regardless of underscore prefix", async () => {
  assert.equal(await countSource("export const f = (_runManager, config) => config;\n"), 1);
  assert.equal(await countSource("export const f = (event, value) => value;\n"), 1);
});

test("counts unused catch bindings and ignores used parameters", async () => {
  assert.equal(
    await countSource("export function f(x) { try { return x(); } catch (_) { return 0; } }\n"),
    1,
  );
  assert.equal(await countSource("export const f = (a, b) => a + b;\n"), 0);
});

test("records per-file counts under the repository-relative path", async () => {
  const results = await eslint.lintText("export const f = (a, b) => 1;\n", {
    filePath: fixturePath,
  });
  assert.deepEqual(measureLintResults(results, repositoryRoot), {
    total: 2,
    files: { "scripts/quality/unused-parameter-fixture.js": 2 },
    samples: [
      "scripts/quality/unused-parameter-fixture.js:1 'a' is defined but never used.",
      "scripts/quality/unused-parameter-fixture.js:1 'b' is defined but never used.",
    ],
  });
});
