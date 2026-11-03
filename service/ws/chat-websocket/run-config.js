/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTimeMs, resolveTimeMs } from "#agent/config";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isPlainObject } from "@noobot/shared/value";

function resolveRunTimeoutMs(rawValue) {
  return normalizeTimeMs(rawValue, {
    fallback: TIME_THRESHOLDS.agent.runTimeoutMs,
    min: TIME_THRESHOLDS.agent.minRunTimeoutMs,
    max: TIME_THRESHOLDS.agent.maxRunTimeoutMs,
  });
}

function resolveConfigRunTimeoutMs(config = {}) {
  const source = isPlainObject(config) ? config : {};
  const hasCanonical = Object.prototype.hasOwnProperty.call(source, "runTimeoutMs");
  if (!hasCanonical) return undefined;
  return resolveTimeMs(source, {
    key: "runTimeoutMs",
    fallback: TIME_THRESHOLDS.agent.runTimeoutMs,
    min: TIME_THRESHOLDS.agent.minRunTimeoutMs,
    max: TIME_THRESHOLDS.agent.maxRunTimeoutMs,
  });
}

export async function resolveEffectiveRunTimeoutMs({ runConfig = {} } = {}) {
  const runConfigTimeoutMs = resolveConfigRunTimeoutMs(runConfig);
  if (runConfigTimeoutMs !== undefined && runConfigTimeoutMs !== null) {
    return resolveRunTimeoutMs(runConfigTimeoutMs);
  }
  return resolveRunTimeoutMs(TIME_THRESHOLDS.agent.runTimeoutMs);
}

export function summarizePluginConfig(plugins = {}) {
  if (!isPlainObject(plugins)) return {};
  return Object.fromEntries(
    Object.entries(plugins).map(([key, value]) => [
      key,
      value && typeof value === "object" ? { enabled: value.enabled, mode: value.mode } : value,
    ]),
  );
}
