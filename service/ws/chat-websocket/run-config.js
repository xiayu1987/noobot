/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  BUILTIN_THRESHOLDS,
  hasOwnConfigKey,
  mergeConfig,
  normalizeBoolean,
  normalizeTimeMs,
  resolveRunConfigValue,
  resolveTimeMs,
} from "#agent/config";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isPlainObject, text } from "@noobot/shared/value";

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

export async function resolveEffectiveStreamingEnabled({ bot, userId = "", runConfig = {} } = {}) {
  const runConfigSource = isPlainObject(runConfig) ? runConfig : {};
  if (hasOwnConfigKey(runConfigSource, "streaming")) {
    return resolveRunConfigValue({
      runConfig: runConfigSource,
      config: {},
      key: "streaming",
      normalize: (value) => normalizeBoolean(value, false),
      fallback: false,
    });
  }

  const normalizedUserId = text(userId);
  const globalConfig =
    bot?.globalConfig && typeof bot.globalConfig === "object" ? bot.globalConfig : {};
  if (!normalizedUserId || typeof bot?.loadUserConfig !== "function") {
    return resolveRunConfigValue({
      runConfig: {},
      config: globalConfig,
      key: "streaming",
      normalize: (value) => normalizeBoolean(value, false),
      fallback: false,
    });
  }

  let userConfig = {};
  try {
    const workspacePath =
      typeof bot?.getWorkspacePath === "function" ? bot.getWorkspacePath(normalizedUserId) : "";
    userConfig =
      workspacePath && typeof workspacePath === "string"
        ? (await bot.loadUserConfig(workspacePath)) || {}
        : {};
  } catch (error) {
    void writeRuntimeEvent({
      scope: "system",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.CONFIG,
      level: "warn",
      event: "service.websocket.userConfig.load.failed",
      data: { userIdLength: normalizedUserId.length },
      error,
    });
    userConfig = {};
  }
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  return resolveRunConfigValue({
    runConfig: {},
    config: effectiveConfig,
    key: "streaming",
    normalize: (value) => normalizeBoolean(value, false),
    fallback: false,
  });
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
