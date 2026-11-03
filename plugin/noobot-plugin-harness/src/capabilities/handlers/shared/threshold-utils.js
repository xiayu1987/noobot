/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isRuntimeThresholdGateEnabled,
  resolveGatedThreshold,
} from "@noobot/agent-config-protocol";

export function resolveAnalysisThresholdWithSource({ runtimeValue, fallbackValue }) {
  return resolveGatedThreshold({ enabled: true, runtimeValue, fallbackValue });
}

export function resolveGatedThresholdWithSource({ meta, runtimeValue, fallbackValue }) {
  return resolveGatedThreshold({
    enabled: isRuntimeThresholdGateEnabled(meta?.harness),
    runtimeValue,
    fallbackValue,
  });
}
