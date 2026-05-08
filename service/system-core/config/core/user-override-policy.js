/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeKnownConfigKeys } from "./key-normalizer.js";
import { isPlainObject } from "./object-utils.js";

// 用户可覆盖策略（只允许这些键被 user config 覆盖）
// - replace：整项替换（当前仅支持字符串值）
// - deep：对象深度合并（用户配置覆盖同名子键，未提供的子键保留全局默认）
const USER_OVERRIDE_POLICY = {
  defaultProvider: "replace",
  providers: "deep",
  attachments: "deep",
  services: "deep",
  mcpServers: "deep",
  tools: "deep",
  preferences: "deep",
};

const USER_OVERRIDE_TOP_LEVEL_DENY_KEYS = new Set([
  "workspaceRoot",
  "workspaceTemplatePath",
]);

const USER_OVERRIDE_DENY_PATHS = new Set([
  "tools.execute_script",
]);

function stripDeniedPaths(rootKey = "", value) {
  if (!isPlainObject(value)) return value;
  const root = String(rootKey || "").trim();
  if (!root) return value;
  const deniedChildren = Array.from(USER_OVERRIDE_DENY_PATHS)
    .filter((item) => item.startsWith(`${root}.`))
    .map((item) => item.slice(root.length + 1))
    .filter(Boolean);
  if (!deniedChildren.length) return value;

  const out = { ...value };
  for (const relativePath of deniedChildren) {
    const parts = relativePath.split(".").filter(Boolean);
    if (!parts.length) continue;
    let node = out;
    for (let partIndex = 0; partIndex < parts.length - 1; partIndex += 1) {
      const segment = parts[partIndex];
      if (!isPlainObject(node?.[segment])) {
        node = null;
        break;
      }
      node = node[segment];
    }
    if (!node || !isPlainObject(node)) continue;
    delete node[parts[parts.length - 1]];
  }
  return out;
}

function cloneAllowedValue(key, value) {
  if (USER_OVERRIDE_TOP_LEVEL_DENY_KEYS.has(String(key || ""))) {
    return undefined;
  }
  const mode = USER_OVERRIDE_POLICY[key];
  if (!mode) return undefined;
  if (mode === "replace") {
    return typeof value === "string" ? value : undefined;
  }
  return isPlainObject(value) ? stripDeniedPaths(key, { ...value }) : undefined;
}

export function sanitizeUserConfig(input = {}) {
  const src = normalizeKnownConfigKeys(isPlainObject(input) ? input : {});
  const out = {};
  for (const key of Object.keys(USER_OVERRIDE_POLICY)) {
    const value = cloneAllowedValue(key, src[key]);
    if (value === undefined) continue;
    if (isPlainObject(value) && !Object.keys(value).length) continue;
    out[key] = value;
  }
  return out;
}
