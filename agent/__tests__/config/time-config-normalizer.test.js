/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTimeMs,
  resolveTimeMs,
} from "@noobot/agent-config-protocol";

test("normalizeTimeMs: 非法值应回退 fallback", () => {
  assert.equal(normalizeTimeMs(undefined, { fallback: 30000, min: 1000 }), 30000);
  assert.equal(normalizeTimeMs("NaN", { fallback: 30000, min: 1000 }), 30000);
});

test("normalizeTimeMs: 应应用 min/max clamp", () => {
  assert.equal(normalizeTimeMs(500, { fallback: 30000, min: 1000, max: 60000 }), 1000);
  assert.equal(normalizeTimeMs(120000, { fallback: 30000, min: 1000, max: 60000 }), 60000);
});

test("normalizeTimeMs: min=0 时可允许 0", () => {
  assert.equal(normalizeTimeMs(0, { fallback: 30000, min: 0, allowZero: true }), 0);
});

test("resolveTimeMs: reads only the canonical field", () => {
  const source = {
    runTimeoutMs: 20000,
    run_timeout_ms: 30000,
  };
  assert.equal(
    resolveTimeMs(source, {
      key: "runTimeoutMs",
      fallback: 10000,
      min: 1000,
      max: 60000,
    }),
    20000,
  );

  const nonCanonicalOnly = { run_timeout_ms: 30000 };
  assert.equal(
    resolveTimeMs(nonCanonicalOnly, {
      key: "runTimeoutMs",
      fallback: 10000,
      min: 1000,
      max: 60000,
    }),
    10000,
  );
});
