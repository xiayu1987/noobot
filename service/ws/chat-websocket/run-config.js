/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_THRESHOLDS, normalizeTimeMs, resolveTimeMs } from "#agent/config";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isPlainObject } from "@noobot/shared/value";

const DEFAULT_RUN_TIMEOUT_MS = BUILTIN_THRESHOLDS.runTimeoutMs;
const MIN_RUN_TIMEOUT_MS = TIME_THRESHOLDS.agent.minRunTimeoutMs;
const MAX_RUN_TIMEOUT_MS = TIME_THRESHOLDS.agent.maxRunTimeoutMs;

function resolveRunTimeoutMs(rawValue) {
  return normalizeTimeMs(rawValue, {
    fallback: DEFAULT_RUN_TIMEOUT_MS,
    min: MIN_RUN_TIMEOUT_MS,
    max: MAX_RUN_TIMEOUT_MS,
  });
}

function resolveConfigRunTimeoutMs(config = {}) {
  const source = isPlainObject(config) ? config : {};
  const hasCanonical = Object.prototype.hasOwnProperty.call(source, "runTimeoutMs");
  if (!hasCanonical) return undefined;
  return resolveTimeMs(source, {
    key: "runTimeoutMs",
    fallback: DEFAULT_RUN_TIMEOUT_MS,
    min: MIN_RUN_TIMEOUT_MS,
    max: MAX_RUN_TIMEOUT_MS,
  });
}

export async function resolveEffectiveRunTimeoutMs({ runConfig = {} } = {}) {
  const runConfigTimeoutMs = resolveConfigRunTimeoutMs(runConfig);
  if (runConfigTimeoutMs !== undefined && runConfigTimeoutMs !== null) {
    return resolveRunTimeoutMs(runConfigTimeoutMs);
  }
  return resolveRunTimeoutMs(DEFAULT_RUN_TIMEOUT_MS);
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
