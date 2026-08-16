/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deepMerge, isPlainObject } from "../utils.js";
import { normalizeKnownConfigKeys } from "../normalization/keys.js";
import { resolveBuiltinScenarios } from "../policy/scenario-policy.js";
import { sanitizeUserConfig } from "../policy/user-override.js";

const RETIRED_CONFIG_PATHS = Object.freeze(
  [
    ["configParams"],
    ["attachments", "attachment_models"],
    ["session", "use_last_running_task_range"],
    ["session", "use_last_completed_task_range"],
    ["tools", "set_skill_task"],
    ["tools", "web_to_data"],
    ["tools", "doc_to_data"],
    ["tools", "media_to_data"],
    ["tools", "process_content_task"],
    ["tools", "execute_script", "sandbox_mode"],
    ["tools", "execute_script", "sandbox_provider"],
  ].map((segments) => Object.freeze(segments)),
);

function deletePath(root, segments) {
  let node = root;
  const parents = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isPlainObject(node)) return;
    parents.push({ node, key: segments[index] });
    node = node[segments[index]];
    if (!isPlainObject(node)) return;
  }
  delete node[segments[segments.length - 1]];
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const parent = parents[index];
    const child = parent.node[parent.key];
    if (!isPlainObject(child) || Object.keys(child).length > 0) break;
    delete parent.node[parent.key];
  }
}

export function migrateConfigFileToCurrentProtocol(config = {}) {
  if (!isPlainObject(config)) return config;
  const migrated = structuredClone(config);
  for (const segments of RETIRED_CONFIG_PATHS) deletePath(migrated, segments);
  return migrated;
}

const USER_OVERRIDE_POLICY = {
  defaultProvider: "replace",
  providers: "deep",
  attachments: "deep",
  multimodal: "deep",
  session: "deep",
  context: "deep",
  services: "deep",
  mcpServers: "deep",
  tools: "deep",
  scenarios: "scenarios",
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

export function normalizeBooleanLike(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
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
