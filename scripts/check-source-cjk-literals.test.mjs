/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCjkLiterals, isExemptPath } from "./check-source-cjk-literals.mjs";

function run(sources, options) {
  return evaluateCjkLiterals(Object.keys(sources), (file) => sources[file], options);
}

test("reports CJK literals in non-exempt source files", () => {
  const { violations } = run(
    { "agent/src/a.js": 'const label = "你好";\nconst ok = 1;', "agent/src/b.js": "const b = 1;" },
    { allowedFiles: {}, allowedDirs: {} },
  );
  assert.deepEqual(
    violations.map((item) => [item.file, item.hits.map((hit) => hit.line)]),
    [["agent/src/a.js", [1]]],
  );
});

test("skips catalogs, tests, scripts and non-source files", () => {
  for (const file of [
    "i18n/src/client/locales/zh-CN.js",
    "plugin/x/frontend/i18n/zh.js",
    "plugin/x/src/i18n.js",
    "agent/__tests__/a.test.js",
    "client/noobot-chat/tests/unit/a.spec.js",
    "scripts/check-a.mjs",
    "workflow/examples/a.js",
  ]) {
    assert.equal(isExemptPath(file), true, file);
  }
  const { violations } = run(
    { "docs/readme.md": "中文", "agent/src/style.css": "/* 中文 */" },
    { allowedFiles: {}, allowedDirs: {} },
  );
  assert.deepEqual(violations, []);
});

test("accepts allowlisted files", () => {
  const { violations, staleEntries } = run(
    { "sanitize/src/index.js": '"护照"' },
    { allowedFiles: { "sanitize/src/index.js": "pii" } },
  );
  assert.deepEqual(violations, []);
  assert.deepEqual(staleEntries, []);
});

test("fails stale allowlist entries without CJK content", () => {
  const { staleEntries } = run(
    { "sanitize/src/index.js": "const a = 1;" },
    { allowedFiles: { "sanitize/src/index.js": "pii", "gone.js": "removed" } },
  );
  assert.deepEqual(staleEntries, ["sanitize/src/index.js", "gone.js"]);
});
