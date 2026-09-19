/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TURN_THRESHOLDS } from "../turn-thresholds.js";

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

test("every turn threshold leaf is a positive integer count", () => {
  const leaves = collectLeafPaths(TURN_THRESHOLDS);
  assert.ok(leaves.length > 0);
  for (const [path, value] of leaves) {
    assert.equal(typeof value, "number", `${path} must be a number`);
    assert.ok(Number.isInteger(value), `${path} must be an integer`);
    assert.ok(value > 0, `${path} must be positive`);
  }
});

test("turn thresholds are deeply frozen", () => {
  assert.ok(Object.isFrozen(TURN_THRESHOLDS));
  for (const group of Object.values(TURN_THRESHOLDS)) {
    assert.ok(Object.isFrozen(group));
  }
});

test("turn threshold groups are non-empty owning scopes", () => {
  for (const [group, values] of Object.entries(TURN_THRESHOLDS)) {
    assert.ok(Object.keys(values).length > 0, `${group} must own at least one key`);
  }
});
