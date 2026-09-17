/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deepMerge, isPlainObject } from "../utils.js";
import {
  resolveDefaultModelLibraryProvider,
  resolveModelLibraryProvider,
} from "@noobot/model-protocol";
import { normalizeKnownConfigKeys } from "../normalization/keys.js";
import { resolveBuiltinScenarios } from "../policy/scenario-policy.js";
import { sanitizeUserConfig } from "../policy/user-override.js";
import { CONFIG_NODE_ACCESS, USER_CONFIG_MERGE_MODE } from "../contract/repair.js";
import { MODEL_PROVIDER_AGENT_CONFIG_CONTRACT } from "../contract/config-structure.js";

function projectProviderFields(provider, access) {
  if (!isPlainObject(provider)) return {};
  return Object.fromEntries(
    Object.entries(provider).filter(
      ([field]) => MODEL_PROVIDER_AGENT_CONFIG_CONTRACT.properties[field]?.access === access,
    ),
  );
}

function resolveProviderAuthority(providerId, globalProvider) {
  if (isPlainObject(globalProvider)) return globalProvider;
  const libraryProvider = resolveModelLibraryProvider(providerId);
  if (libraryProvider) return libraryProvider;
  return {
    ...resolveDefaultModelLibraryProvider(),
    reasoning_effort_options: [],
  };
}

function mergeProviders(globalProviders = {}, userProviders = {}) {
  const globalSource = isPlainObject(globalProviders) ? globalProviders : {};
  const userSource = isPlainObject(userProviders) ? userProviders : {};
  const output = { ...globalSource };
  for (const [providerId, userProvider] of Object.entries(userSource)) {
    if (!isPlainObject(userProvider)) continue;
    const globalProvider = globalSource[providerId];
    const authority = resolveProviderAuthority(providerId, globalProvider);
    const editableUserProvider = projectProviderFields(userProvider, CONFIG_NODE_ACCESS.USER);
    output[providerId] = deepMerge(authority, editableUserProvider);
  }
  return output;
}

export function mergeConfig(globalConfig = {}, userConfig = {}) {
  const globalBase = normalizeKnownConfigKeys(
    isPlainObject(globalConfig) ? { ...globalConfig } : {},
  );
  const safeUser = sanitizeUserConfig(userConfig);
  const out = { ...globalBase };
  for (const [key, userValue] of Object.entries(safeUser)) {
    if (key === "scenarios") continue;

    if (key === "providers") {
      out.providers = mergeProviders(globalBase.providers, userValue);
      continue;
    }

    if (USER_CONFIG_MERGE_MODE[key] === "replace") {
      out[key] = userValue;
      continue;
    }
    out[key] = deepMerge(globalBase[key], userValue);
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
