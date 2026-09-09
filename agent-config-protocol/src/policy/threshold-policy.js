/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const RUNTIME_THRESHOLD_SOURCE = Object.freeze({
  RUNTIME: "runtime",
  FALLBACK: "fallback",
});

export function normalizePositiveInteger(value, fallback = 0, { requireInteger = false } = {}) {
  const parsed = Number(value);
  const fallbackValue = Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  if (requireInteger && !Number.isInteger(parsed)) return fallbackValue;
  return Math.floor(parsed);
}

export function isRuntimeThresholdGateEnabled(source = {}) {
  return source?.frontendThresholdsEnabled === true;
}

export function resolveRuntimeThresholdOverride({
  enabled = false,
  runtimeValue,
  requireInteger = false,
} = {}) {
  if (enabled !== true) return 0;
  return normalizePositiveInteger(runtimeValue, 0, { requireInteger });
}

export function resolveGatedThreshold({
  enabled = false,
  runtimeValue,
  fallbackValue,
  defaultValue = 0,
  requireInteger = false,
} = {}) {
  const runtimeThreshold = resolveRuntimeThresholdOverride({
    enabled,
    runtimeValue,
    requireInteger,
  });
  if (runtimeThreshold > 0) {
    return Object.freeze({ value: runtimeThreshold, source: RUNTIME_THRESHOLD_SOURCE.RUNTIME });
  }
  const normalizedDefault = normalizePositiveInteger(defaultValue, 0, { requireInteger });
  const value =
    fallbackValue === undefined
      ? normalizedDefault
      : normalizePositiveInteger(fallbackValue, normalizedDefault, { requireInteger });
  return Object.freeze({ value, source: RUNTIME_THRESHOLD_SOURCE.FALLBACK });
}

export function resolveGatedThresholdValue(input = {}) {
  return resolveGatedThreshold(input).value;
}
