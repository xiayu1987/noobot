/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { QUANTITY_THRESHOLDS } from "../quantity-thresholds.js";

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

test("every quantity threshold leaf is a positive integer count", () => {
  const leaves = collectLeafPaths(QUANTITY_THRESHOLDS);
  assert.ok(leaves.length > 0);
  for (const [path, value] of leaves) {
    assert.equal(typeof value, "number", `${path} must be a number`);
    assert.ok(Number.isInteger(value), `${path} must be an integer`);
    assert.ok(value > 0, `${path} must be positive`);
  }
});

test("quantity thresholds are deeply frozen", () => {
  assert.ok(Object.isFrozen(QUANTITY_THRESHOLDS));
  for (const group of Object.values(QUANTITY_THRESHOLDS)) {
    assert.ok(Object.isFrozen(group));
  }
});

test("quantity threshold groups are non-empty owning scopes", () => {
  for (const [group, values] of Object.entries(QUANTITY_THRESHOLDS)) {
    assert.ok(Object.keys(values).length > 0, `${group} must own at least one key`);
  }
});
