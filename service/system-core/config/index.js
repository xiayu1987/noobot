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

const SNAKE_TO_CANONICAL_KEY_MAP = {
  workspace_root: "workspaceRoot",
  workspace_template_path: "workspaceTemplatePath",
  memory_max_items: "memoryMaxItems",
  max_tool_loop_turns: "maxToolLoopTurns",
  recent_message_limit: "recentMessageLimit",
  use_last_running_task_range: "useLastRunningTaskRange",
  use_last_completed_task_range: "useLastCompletedTaskRange",
  switch_web_mode: "switchWebMode",
  sandbox_mode: "sandboxMode",
  sandbox_provider: "sandboxProvider",
  docker_container_scope: "dockerContainerScope",
  docker_container_name: "dockerContainerName",
  docker_image: "dockerImage",
  wait_timeout_ms: "waitTimeoutMs",
  poll_interval_ms: "pollIntervalMs",
  max_sub_agent_depth: "maxSubAgentDepth",
  script_timeout_ms: "scriptTimeoutMs",
  super_admin: "superAdmin",
  user_id: "userId",
  connect_code: "connectCode",
  default_provider: "defaultProvider",
  default_model: "defaultModel",
  attachment_models: "attachmentModels",
  mcp_servers: "mcpServers",
};

function normalizeKnownConfigKeys(input, path = []) {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeKnownConfigKeys(item, path));
  }
  if (!isPlainObject(input)) return input;

  const currentPath = Array.isArray(path) ? path : [];
  const inMcpServersSubtree =
    currentPath[0] === "mcpServers" || currentPath[0] === "mcp_servers";

  const out = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const normalizedKey = inMcpServersSubtree
      ? rawKey
      : SNAKE_TO_CANONICAL_KEY_MAP[rawKey] || rawKey;
    out[normalizedKey] = normalizeKnownConfigKeys(
      value,
      [...currentPath, normalizedKey],
    );
  }
  return out;
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
// - 工具相关：tools
// - 偏好相关：preferences
const USER_OVERRIDE_POLICY = {
  defaultProvider: "replace",
  defaultModel: "replace",
  providers: "deep",
  attachmentModels: "deep",
  services: "deep",
  mcpServers: "deep",
  tools: "deep",
  preferences: "deep",
};

// 用户配置绝不允许覆盖的顶层键（防止后续误加入 USER_OVERRIDE_POLICY）
const USER_OVERRIDE_TOP_LEVEL_DENY_KEYS = new Set([
  "workspaceRoot",
  "workspaceTemplatePath",
]);

// 用户配置禁止覆盖的路径（基于 normalizeKnownConfigKeys 之后的 key）
// 例如：tools.execute_script 由服务端控制，客户端不可改
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
    for (let i = 0; i < parts.length - 1; i += 1) {
      const segment = parts[i];
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
  return out;
}

export function applySessionModelOverride(userConfig = {}, modelAlias = "") {
  const safeUser = sanitizeUserConfig(userConfig);
  const alias = String(modelAlias || "").trim();
  if (!alias) return safeUser;
  return { ...safeUser, defaultProvider: alias };
}

export async function loadGlobalConfig(filePath = "./config/global.config.json") {
  return normalizeKnownConfigKeys(JSON.parse(await readFile(filePath, "utf8")));
}
