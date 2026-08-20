/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_CONNECTOR_INSTANCES } from "../src/index.js";

test("built-in connector instances have unique definitions and complete lifecycle methods", () => {
  assert.equal(BUILTIN_CONNECTOR_INSTANCES.length, 5);
  assert.equal(
    new Set(BUILTIN_CONNECTOR_INSTANCES.map((item) => item.definition.instanceType)).size,
    BUILTIN_CONNECTOR_INSTANCES.length,
  );
  for (const instance of BUILTIN_CONNECTOR_INSTANCES) {
    assert.ok(instance.definition.operations.length > 0);
    for (const method of ["create", "health", "access", "dispose"]) {
      assert.equal(typeof instance[method], "function");
    }
  }
});
