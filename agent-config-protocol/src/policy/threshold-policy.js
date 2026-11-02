/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const RUNTIME_THRESHOLD_SOURCE = Object.freeze({
  RUNTIME: "runtime",
  FALLBACK: "fallback",
});

export function requirePositiveTurnThreshold(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("turn threshold must be a positive safe integer");
  }
  return value;
}

export function isRuntimeThresholdGateEnabled(source = {}) {
  return source?.frontendThresholdsEnabled === true;
}

export function resolveGatedThreshold({
  enabled = false,
  runtimeValue,
  fallbackValue,
  defaultValue,
}) {
  if (typeof enabled !== "boolean") throw new TypeError("threshold gate must be boolean");
  if (runtimeValue !== undefined) requirePositiveTurnThreshold(runtimeValue);
  if (fallbackValue !== undefined) requirePositiveTurnThreshold(fallbackValue);
  if (defaultValue !== undefined) requirePositiveTurnThreshold(defaultValue);
  if (enabled && runtimeValue !== undefined) {
    return Object.freeze({ value: runtimeValue, source: RUNTIME_THRESHOLD_SOURCE.RUNTIME });
  }
  return Object.freeze({
    value: requirePositiveTurnThreshold(fallbackValue === undefined ? defaultValue : fallbackValue),
    source: RUNTIME_THRESHOLD_SOURCE.FALLBACK,
  });
}

export function resolveGatedThresholdValue(input) {
  return resolveGatedThreshold(input).value;
}
