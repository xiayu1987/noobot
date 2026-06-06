/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deepMerge, isPlainObject } from "../../utils/shared-utils.js";
import { normalizeKnownConfigKeys } from "./key-normalizer.js";
import { sanitizeUserConfig } from "./user-override-policy.js";

const USER_OVERRIDE_POLICY = {
  defaultProvider: "replace",
  providers: "deep",
  attachments: "deep",
  services: "deep",
  mcpServers: "deep",
  tools: "deep",
  scenarios: "deep",
  plugins: "deep",
  preferences: "deep",
};

export function mergeConfig(globalConfig = {}, userConfig = {}) {
  const globalBase = normalizeKnownConfigKeys(
    isPlainObject(globalConfig) ? { ...globalConfig } : {},
  );
  const safeUser = sanitizeUserConfig(userConfig);
  const out = { ...globalBase };
  for (const [key, userValue] of Object.entries(safeUser)) {
    const mode = USER_OVERRIDE_POLICY[key];
    if (mode === "deep") {
      out[key] = deepMerge(globalBase[key], userValue);
      continue;
    }
    out[key] = userValue;
  }
  const userRuntimeConfigParams =
    userConfig?.configParams && isPlainObject(userConfig.configParams)
      ? userConfig.configParams
      : null;
  if (userRuntimeConfigParams) {
    const mergedRuntimeConfigParams = {
      ...(isPlainObject(globalBase?.configParams) ? globalBase.configParams : {}),
    };
    for (const [paramKey, rawValue] of Object.entries(userRuntimeConfigParams)) {
      const normalizedKey = String(paramKey || "").trim();
      if (!normalizedKey) continue;
      const normalizedValue = String(rawValue ?? "").trim();
      if (!normalizedValue) continue;
      mergedRuntimeConfigParams[normalizedKey] = normalizedValue;
    }
    out.configParams = {
      ...mergedRuntimeConfigParams,
    };
  }
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

export function normalizeBooleanLike(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = String(value || "").trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return Boolean(fallback);
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
