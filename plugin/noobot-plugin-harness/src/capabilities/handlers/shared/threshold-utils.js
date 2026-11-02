/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveGatedThreshold, RUNTIME_THRESHOLD_SOURCE } from "@noobot/agent-config-protocol";

function resolveThresholdWithSource({ runtimeValue, scopedValue, defaultValue }, enabled) {
  const result = resolveGatedThreshold({
    enabled,
    runtimeValue,
    fallbackValue: scopedValue,
    defaultValue,
  });
  return Object.freeze({
    value: result.value,
    source: result.source === RUNTIME_THRESHOLD_SOURCE.RUNTIME ? "runtime" : "workflow_params",
  });
}

export function resolveAnalysisThresholdWithSource(input) {
  return resolveThresholdWithSource(input, true);
}

export function resolveGatedThresholdWithSource({ meta, ...input }) {
  return resolveThresholdWithSource(input, meta?.harness?.frontendThresholdsEnabled === true);
}
