/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TIME_THRESHOLDS, resolveUserInteractionTimeoutMs } from "../time-thresholds.js";

function collectLeafPaths(source, prefix = "") {
  const paths = [];
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      paths.push(...collectLeafPaths(value, path));
      continue;
    }
    paths.push([path, value]);
  }
  return paths;
}

test("every time threshold leaf is a finite non-negative number", () => {
  const leaves = collectLeafPaths(TIME_THRESHOLDS);
  assert.ok(leaves.length > 0);
  for (const [path, value] of leaves) {
    assert.equal(typeof value, "number", `${path} must be a number`);
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    assert.ok(value >= 0, `${path} must not be negative`);
  }
});

test("time thresholds are deeply frozen", () => {
  assert.ok(Object.isFrozen(TIME_THRESHOLDS));
  for (const group of Object.values(TIME_THRESHOLDS)) {
    assert.ok(Object.isFrozen(group));
  }
});

test("time threshold groups are non-empty owning scopes", () => {
  for (const [group, values] of Object.entries(TIME_THRESHOLDS)) {
    assert.ok(Object.keys(values).length > 0, `${group} must own at least one key`);
  }
});

test("user interaction timeout resolves from env with a threshold fallback", () => {
  const fallback = TIME_THRESHOLDS.service.userInteractionTimeoutMs;
  assert.equal(typeof fallback, "number");
  assert.equal(resolveUserInteractionTimeoutMs({}), fallback);
  assert.equal(resolveUserInteractionTimeoutMs({ NOOBOT_USER_INTERACTION_TIMEOUT_MS: "not-a-number" }), fallback);
  assert.equal(resolveUserInteractionTimeoutMs({ NOOBOT_USER_INTERACTION_TIMEOUT_MS: "999" }), fallback);
  assert.equal(resolveUserInteractionTimeoutMs({ NOOBOT_USER_INTERACTION_TIMEOUT_MS: "1500.7" }), 1500);
});
