/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deepMerge, isPlainObject } from "../utils.js";
import { normalizeKnownConfigKeys } from "../normalization/keys.js";
import { resolveBuiltinScenarios } from "../policy/scenario-policy.js";
import { sanitizeUserConfig } from "../policy/user-override.js";
import { USER_CONFIG_OVERRIDE_POLICY } from "../contract/repair.js";

export function mergeConfig(globalConfig = {}, userConfig = {}) {
  const globalBase = normalizeKnownConfigKeys(
    isPlainObject(globalConfig) ? { ...globalConfig } : {},
  );
  const safeUser = sanitizeUserConfig(userConfig);
  const out = { ...globalBase };
  for (const [key, userValue] of Object.entries(safeUser)) {
    const mode = USER_CONFIG_OVERRIDE_POLICY[key];
    if (key === "scenarios") continue;
    if (mode === "deep") {
      out[key] = deepMerge(globalBase[key], userValue);
      continue;
    }
    out[key] = userValue;
  }
  out.scenarios = resolveBuiltinScenarios(globalBase?.scenarios, safeUser?.scenarios);
  delete out.configParams;
  return out;
}

export function applySessionModelOverride(userConfig = {}, modelAlias = "") {
  const safeUser = sanitizeUserConfig(userConfig);
  const alias = String(modelAlias || "").trim();
  if (!alias) return safeUser;
  return { ...safeUser, defaultProvider: alias };
}

export function hasOwnConfigKey(source = {}, key = "") {
  const normalizedKey = String(key || "").trim();
  return Boolean(
    normalizedKey &&
    isPlainObject(source) &&
    Object.prototype.hasOwnProperty.call(source, normalizedKey),
  );
}

export function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return typeof fallback === "boolean" ? fallback : false;
}

export function resolveRunConfigValue({
  runConfig = {},
  config = {},
  key = "",
  normalize = (value) => value,
  fallback = undefined,
} = {}) {
  const normalizedKey = String(key || "").trim();
  const normalizer = typeof normalize === "function" ? normalize : (value) => value;
  if (!normalizedKey) return fallback;
  if (hasOwnConfigKey(runConfig, normalizedKey)) {
    return normalizer(runConfig[normalizedKey]);
  }
  if (hasOwnConfigKey(config, normalizedKey)) {
    return normalizer(config[normalizedKey]);
  }
  return fallback;
}
