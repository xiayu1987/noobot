/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeKnownConfigKeys } from "../normalization/keys.js";
import { normalizeTimeMs } from "../normalization/time.js";
import { sanitizeScenarioConfig } from "./scenario-policy.js";
import { isPlainObject } from "../utils.js";

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

const USER_OVERRIDE_TOP_LEVEL_DENY_KEYS = new Set(["workspaceRoot", "workspaceTemplatePath"]);

const USER_OVERRIDE_DENY_PATHS = new Set([
  "attachments.maxFileCount",
  "attachments.maxFileSizeBytes",
  "attachments.maxTotalSizeBytes",
  "attachments.allowedExtensions",
  "attachments.allowedMimeTypes",
  "tools.access_connector.command_file.allowedExtensions",
  "tools.access_connector.command_file.allowedRoots",
  "tools.delegate_task_async.waitTimeoutMs",
  "tools.delegate_task_async.pollIntervalMs",
  "tools.delegate_task_async.maxSubAgentDepth",
  "tools.wait_async_task_result.pollIntervalMs",
  "tools.process_connector_tool.maxToolLoopTurns",
  "tools.call_mcp_task.maxToolLoopTurns",
  "tools.execute_script",
  "tools.execute_native_script",
  "tools.access_connector.command_file.maxBytes",
  "tools.task_summary.phaseSummaryLoopTurns",
  "tools.task_summary.phaseSummaryMessageCharsThreshold",
  "tools.task_summary.maxToolLoopTurns",
  "tools.request_help.helpPromptLoopTurns",
  "tools.request_help.toolFailureHelpCount",
  "plugins.workflow.timeoutMs",
  "plugins.workflow.maxAutoTransitions",
  "plugins.workflow.maxParallelNodeAgents",
  "plugins.workflow.miniRunnerMaxTurns",
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
  if (mode === "replace_number") {
    const normalizedNumber = normalizeTimeMs(value, {
      fallback: Number.NaN,
      min: 1,
    });
    return Number.isFinite(normalizedNumber) && normalizedNumber > 0 ? normalizedNumber : undefined;
  }
  if (mode === "scenarios") {
    const sanitizedScenarios = sanitizeScenarioConfig(value);
    return Object.keys(sanitizedScenarios).length ? sanitizedScenarios : undefined;
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
