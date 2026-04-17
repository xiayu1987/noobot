/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from "node:fs";

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

// 用户可覆盖策略（只允许这些键被 user config 覆盖）
// - 模型相关：defaultProvider/defaultModel/providers/attachmentModels
// - 服务相关：services
// - 异步等待配置：async（用于 wait timeout）
const USER_OVERRIDE_POLICY = {
  defaultProvider: "replace",
  defaultModel: "replace",
  providers: "deep",
  attachmentModels: "deep",
  services: "deep",
  async: "deep",
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

export function loadGlobalConfig(filePath = "./config/global.config.json") {
  return JSON.parse(readFileSync(filePath, "utf8"));
}
