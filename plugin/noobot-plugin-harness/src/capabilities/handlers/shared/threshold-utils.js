/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const THRESHOLD_SOURCE = Object.freeze({
  runtime: "runtime",
  workflowParams: "workflow_params",
});

export function normalizePositiveInteger(value = 0, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

export function normalizeClampedPositiveInteger(value = undefined, min = 1, max = 10) {
  const normalized = normalizePositiveInteger(value, 0);
  if (!normalized) return 0;
  return Math.min(max, Math.max(min, normalized));
}

export function isFrontendThresholdsEnabled(meta = {}) {
  return meta?.harness?.frontendThresholdsEnabled === true;
}

export function resolveGatedRuntimeThreshold(meta = {}, runtimeValue = undefined) {
  if (!isFrontendThresholdsEnabled(meta)) return 0;
  return normalizePositiveInteger(runtimeValue, 0);
}

export function resolveThresholdWithSource({
  runtimeValue = 0,
  scopedValue = undefined,
  defaultValue = 0,
} = {}) {
  const runtime = normalizePositiveInteger(runtimeValue, 0);
  if (runtime) {
    return Object.freeze({ value: runtime, source: THRESHOLD_SOURCE.runtime });
  }
  return Object.freeze({
    value: normalizePositiveInteger(scopedValue, defaultValue),
    source: THRESHOLD_SOURCE.workflowParams,
  });
}

export function resolveGatedThresholdWithSource({
  meta = {},
  runtimeValue = undefined,
  scopedValue = undefined,
  defaultValue = 0,
} = {}) {
  return resolveThresholdWithSource({
    runtimeValue: resolveGatedRuntimeThreshold(meta, runtimeValue),
    scopedValue,
    defaultValue,
  });
}
