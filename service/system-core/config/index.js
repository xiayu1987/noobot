/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base))
    return isPlainObject(override) ? { ...override } : base;
  if (!isPlainObject(override)) return { ...base };
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function isString(value) {
  return typeof value === "string";
}

function resolveTemplateInString(
  input = "",
  { configParams = {}, env = process.env } = {},
) {
  const params = isPlainObject(configParams) ? configParams : {};
  const runtimeEnv = isPlainObject(env) ? env : {};
  return String(input || "").replace(/\$\{([A-Z0-9_]+)\}/gi, (_, key) => {
    const envValue = runtimeEnv?.[key];
    if (envValue !== undefined && envValue !== null && String(envValue) !== "") {
      return String(envValue);
    }
    const value = params?.[key];
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

export function resolveConfigSecrets(
  input,
  { configParams = {}, env = process.env } = {},
) {
  if (isString(input)) {
    return resolveTemplateInString(input, { configParams, env });
  }
  if (Array.isArray(input)) {
    return input.map((item) =>
      resolveConfigSecrets(item, { configParams, env }),
    );
  }
  if (isPlainObject(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        resolveConfigSecrets(value, { configParams, env }),
      ]),
    );
  }
  return input;
}

export function resolveConfigTemplates(input, variables = {}) {
  return resolveConfigSecrets(input, { configParams: variables, env: {} });
}

// 用户可覆盖策略（只允许这些键被 user config 覆盖）
// - 模型相关：defaultProvider/defaultModel/providers/attachmentModels
// - 服务相关：services
// - MCP相关：mcpServers
// - 异步等待配置：async（用于 wait timeout）
// - 工具相关：tools
const USER_OVERRIDE_POLICY = {
  defaultProvider: "replace",
  defaultModel: "replace",
  providers: "deep",
  attachmentModels: "deep",
  services: "deep",
  mcpServers: "deep",
  async: "deep",
  tools: "deep",
};

function cloneAllowedValue(key, value) {
  const mode = USER_OVERRIDE_POLICY[key];
  if (!mode) return undefined;
  if (mode === "replace") {
    return typeof value === "string" ? value : undefined;
  }
  return isPlainObject(value) ? { ...value } : undefined;
}

export function sanitizeUserConfig(input = {}) {
  const src = isPlainObject(input) ? input : {};
  const out = {};
  for (const key of Object.keys(USER_OVERRIDE_POLICY)) {
    const value = cloneAllowedValue(key, src[key]);
    if (value === undefined) continue;
    if (isPlainObject(value) && !Object.keys(value).length) continue;
    out[key] = value;
  }
  return out;
}

export function mergeConfig(globalConfig = {}, userConfig = {}) {
  const globalBase = isPlainObject(globalConfig) ? { ...globalConfig } : {};
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
  return out;
}

export function applySessionModelOverride(userConfig = {}, modelAlias = "") {
  const safeUser = sanitizeUserConfig(userConfig);
  const alias = String(modelAlias || "").trim();
  if (!alias) return safeUser;
  return { ...safeUser, defaultProvider: alias };
}

export async function loadGlobalConfig(filePath = "./config/global.config.json") {
  return JSON.parse(await readFile(filePath, "utf8"));
}
