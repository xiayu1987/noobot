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
  normalizePositiveInteger,
  resolveGatedThreshold,
  resolveGatedThresholdValue,
  resolveRuntimeThresholdOverride,
} from "../src/policy/threshold-policy.js";

test("normalizePositiveInteger falls back for non positive and non finite values", () => {
  assert.equal(normalizePositiveInteger(5, 9), 5);
  assert.equal(normalizePositiveInteger("7", 9), 7);
  assert.equal(normalizePositiveInteger(0, 9), 9);
  assert.equal(normalizePositiveInteger(-3, 9), 9);
  assert.equal(normalizePositiveInteger("abc", 9), 9);
  assert.equal(normalizePositiveInteger(undefined, 9), 9);
  assert.equal(normalizePositiveInteger(4.7, 9), 4);
  assert.equal(normalizePositiveInteger(4.7, 9, { requireInteger: true }), 9);
  assert.equal(normalizePositiveInteger(1, "bad"), 1);
  assert.equal(normalizePositiveInteger("bad", "bad"), 0);
});

test("isRuntimeThresholdGateEnabled only accepts strict boolean true", () => {
  assert.equal(isRuntimeThresholdGateEnabled({ frontendThresholdsEnabled: true }), true);
  assert.equal(isRuntimeThresholdGateEnabled({ frontendThresholdsEnabled: "true" }), false);
  assert.equal(isRuntimeThresholdGateEnabled({}), false);
  assert.equal(isRuntimeThresholdGateEnabled(), false);
  assert.equal(isRuntimeThresholdGateEnabled(null), false);
});

test("resolveRuntimeThresholdOverride returns 0 when gate is closed", () => {
  assert.equal(resolveRuntimeThresholdOverride({ enabled: false, runtimeValue: 12 }), 0);
  assert.equal(resolveRuntimeThresholdOverride({ enabled: true, runtimeValue: 12 }), 12);
  assert.equal(resolveRuntimeThresholdOverride({ enabled: true, runtimeValue: 0 }), 0);
  assert.equal(
    resolveRuntimeThresholdOverride({ enabled: true, runtimeValue: 1.5, requireInteger: true }),
    0,
  );
  assert.equal(resolveRuntimeThresholdOverride(), 0);
});

test("resolveGatedThreshold prefers gated runtime value and reports source", () => {
  assert.deepEqual(resolveGatedThreshold({ enabled: true, runtimeValue: 6, defaultValue: 20 }), {
    value: 6,
    source: RUNTIME_THRESHOLD_SOURCE.RUNTIME,
  });
  assert.deepEqual(resolveGatedThreshold({ enabled: false, runtimeValue: 6, defaultValue: 20 }), {
    value: 20,
    source: RUNTIME_THRESHOLD_SOURCE.FALLBACK,
  });
  assert.deepEqual(resolveGatedThreshold({ enabled: true, runtimeValue: 0, defaultValue: 20 }), {
    value: 20,
    source: RUNTIME_THRESHOLD_SOURCE.FALLBACK,
  });
});

test("resolveGatedThreshold layers scoped fallback above default", () => {
  assert.equal(
    resolveGatedThresholdValue({
      enabled: false,
      runtimeValue: 6,
      fallbackValue: 11,
      defaultValue: 20,
    }),
    11,
  );
  assert.equal(
    resolveGatedThresholdValue({
      enabled: false,
      runtimeValue: 6,
      fallbackValue: 0,
      defaultValue: 20,
    }),
    20,
  );
  assert.equal(
    resolveGatedThresholdValue({
      enabled: true,
      runtimeValue: 6,
      fallbackValue: 11,
      defaultValue: 20,
    }),
    6,
  );
});

test("resolveGatedThreshold result is frozen and defaults are safe", () => {
  const result = resolveGatedThreshold({ enabled: true, runtimeValue: 3, defaultValue: 8 });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(resolveGatedThreshold(), {
    value: 0,
    source: RUNTIME_THRESHOLD_SOURCE.FALLBACK,
  });
  assert.equal(resolveGatedThresholdValue(), 0);
});
