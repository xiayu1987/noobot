/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_THRESHOLD_SOURCE,
  isRuntimeThresholdGateEnabled,
  requirePositiveTurnThreshold,
  resolveGatedThreshold,
  resolveGatedThresholdValue,
} from "../src/policy/threshold-policy.js";

test("turn thresholds reject malformed declared facts regardless of gate or precedence", () => {
  const invalidValues = [null, "7", 0, -1, 1.5, NaN, Infinity, {}, Number.MAX_SAFE_INTEGER + 1];
  for (const value of invalidValues) {
    assert.throws(() => requirePositiveTurnThreshold(value), TypeError);
    for (const enabled of [false, true]) {
      for (const field of ["runtimeValue", "fallbackValue", "defaultValue"]) {
        const input = {
          enabled,
          runtimeValue: 2,
          fallbackValue: 3,
          defaultValue: 4,
          [field]: value,
        };
        assert.throws(() => resolveGatedThreshold(input), TypeError);
        assert.equal(Object.is(input[field], value), true);
      }
    }
  }
  assert.equal(requirePositiveTurnThreshold(11), 11);
  assert.equal(requirePositiveTurnThreshold(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});

test("runtime gate discovery only enables explicit boolean true", () => {
  assert.equal(isRuntimeThresholdGateEnabled({ frontendThresholdsEnabled: true }), true);
  for (const source of [{ frontendThresholdsEnabled: "true" }, {}, undefined, null]) {
    assert.equal(isRuntimeThresholdGateEnabled(source), false);
  }
  assert.throws(() => resolveGatedThreshold({ enabled: "true", defaultValue: 4 }), TypeError);
});

test("threshold selection preserves explicit scope and source without manufacturing defaults", () => {
  const input = { runtimeValue: 6, fallbackValue: 11, defaultValue: 20 };
  assert.deepEqual(resolveGatedThreshold({ ...input, enabled: true }), {
    value: 6,
    source: RUNTIME_THRESHOLD_SOURCE.RUNTIME,
  });
  assert.deepEqual(resolveGatedThreshold({ ...input, enabled: false }), {
    value: 11,
    source: RUNTIME_THRESHOLD_SOURCE.FALLBACK,
  });
  assert.equal(resolveGatedThresholdValue({ defaultValue: 20 }), 20);
  assert.equal(resolveGatedThresholdValue({ enabled: true, runtimeValue: 6 }), 6);
  assert.equal(Object.isFrozen(resolveGatedThreshold(input)), true);
  for (const input of [undefined, {}, { enabled: false, runtimeValue: 6 }]) {
    assert.throws(() => resolveGatedThresholdValue(input), TypeError);
  }
});
