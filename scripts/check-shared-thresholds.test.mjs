/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findScatteredThresholds } from "./check-shared-thresholds.mjs";

function findings(source) {
  return findScatteredThresholds(source).map(({ line, name, rule }) => [line, name, rule.category]);
}

test("classifies constant declarations and properties by threshold category", () => {
  assert.deepEqual(
    findings(
      [
        "const MAX_PREVIEW_CHARS = 2000;",
        "export const REQUEST_TIMEOUT_MS = 30 * 1000;",
        "const options = { maxItems: 50, maxTurns: 8 };",
      ].join("\n"),
    ),
    [
      [1, "MAX_PREVIEW_CHARS", "length"],
      [2, "REQUEST_TIMEOUT_MS", "time"],
      [3, "maxItems", "quantity"],
      [3, "maxTurns", "turn"],
    ],
  );
});

test("accepts shared threshold references, zero, and MAX_SAFE_INTEGER", () => {
  assert.deepEqual(
    findings(
      [
        "const MAX_PREVIEW_CHARS = LENGTH_THRESHOLDS.previewChars;",
        "const RETRY_COUNT = 0;",
        "const options = { limit: Number.MAX_SAFE_INTEGER };",
      ].join("\n"),
    ),
    [],
  );
});

test("ignores thresholds inside comments and strings, and unrelated names", () => {
  assert.deepEqual(
    findings(
      [
        "// const MAX_PREVIEW_CHARS = 2000;",
        'const label = "maxItems: 50";',
        "const PORT_OFFSET = 3;",
      ].join("\n"),
    ),
    [],
  );
});
