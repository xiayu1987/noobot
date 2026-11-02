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

test("detects inline timers, waiting calls, default arguments and environment defaults", () => {
  const results = findings(
    [
      "setTimeout(() => {}, 1500);",
      "globalThis.setInterval(work, 3000);",
      "await page.waitForTimeout(500);",
      "function load({ timeoutMs = 4000 } = {}) {}",
      "const delay = Number(process.env.REQUEST_TIMEOUT_MS || 6000);",
      "const ttl = envTimeMs('API_TTL_MS', 7000);",
      "const limit = envNumber('MAX_CONNECTIONS', 'maxConnections', 80, 1);",
      "const HTTP_REQUEST_TIMEOUT_MS = 5000;",
      "const deadline = Date.now() + 180000;",
    ].join("\n"),
  );
  assert.deepEqual(
    results.map((result) => result[2]),
    ["time", "time", "time", "time", "time", "time", "quantity", "time", "time"],
  );
});

test("ports and fixed status enumerations are not thresholds", () => {
  assert.deepEqual(
    findings(
      [
        "const config = { port: envNumber('AGENT_PROXY_PORT', 'proxyPort', 12345, 1) };",
        "const EXIT_CODES = Object.freeze({ timeout: 1, failed: 2 });",
        "const HTTP_TOO_MANY_REQUESTS = 429;",
      ].join("\n"),
    ),
    [],
  );
});

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

test("preserves locations after multiline comments and escaped string delimiters", () => {
  const source = [
    "/* maxItems: 50,",
    "*/ const MAX_COUNT = 12;",
    'const label = "escaped \\" maxItems: 50";',
    "const options = { maxTurns: 8 };",
  ].join("\r\n");
  assert.deepEqual(
    findScatteredThresholds(source).map(({ line, column, name, expr, rule }) => ({
      line,
      column,
      name,
      expr,
      category: rule.category,
    })),
    [
      { line: 2, column: 4, name: "MAX_COUNT", expr: "12", category: "quantity" },
      { line: 4, column: 19, name: "maxTurns", expr: "8", category: "turn" },
    ],
  );
});
