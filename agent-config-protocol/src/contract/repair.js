/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONFIG_DOCUMENT_SCOPE = Object.freeze({
  GLOBAL: "global",
  USER_DEFAULT: "user_default",
  USER: "user",
});

export const CONFIG_NODE_POLICY = Object.freeze({
  USER_CONFIGURABLE: "user_configurable",
  USER_OPTIONAL: "user_optional",
  GLOBAL_ONLY: "global_only",
});

export const CONFIG_ITEM_TYPE = Object.freeze({
  BUILTIN: "builtin",
  EXPLICIT: "explicit",
});

export const CONFIG_PATH_REPRESENTATION = Object.freeze({
  PERSISTED: "persisted",
  RUNTIME: "runtime",
});

export const CONFIG_REPAIR_ACTION = Object.freeze({
  ADD_DEFAULT: "add_default",
  MIGRATE_PROTOCOL: "migrate_protocol",
  REMOVE_INVALID_OPTIONAL: "remove_invalid_optional",
  REMOVE_SCOPE_FORBIDDEN: "remove_scope_forbidden",
  REMOVE_UNSUPPORTED: "remove_unsupported",
  RESTORE_INVALID_DOCUMENT: "restore_invalid_document",
  RESET_TO_DEFAULT: "reset_to_default",
});

export const USER_CONFIG_OVERRIDE_POLICY = Object.freeze({
  defaultProvider: "replace",
  providers: "deep",
  multimodal: "deep",
  session: "deep",
  context: "deep",
  services: "deep",
  mcpServers: "deep",
  tools: "deep",
  scenarios: "scenarios",
  plugins: "deep",
  preferences: "deep",
});

const systemOwnedRule = (persistedPath, runtimePath = persistedPath) =>
  Object.freeze({
    policy: CONFIG_NODE_POLICY.GLOBAL_ONLY,
    persistedPath,
    runtimePath,
  });

export const CONFIG_NODE_RULES = Object.freeze([
  systemOwnedRule("workspace_root", "workspaceRoot"),
  systemOwnedRule("workspace_template_path", "workspaceTemplatePath"),
  systemOwnedRule("super_admin", "superAdmin"),
  systemOwnedRule("security"),
  systemOwnedRule("streaming"),
  systemOwnedRule("desktop"),
  systemOwnedRule("attachments"),
  systemOwnedRule("tools.delegate_task_async.waitTimeoutMs"),
  systemOwnedRule("tools.delegate_task_async.pollIntervalMs"),
  systemOwnedRule("tools.delegate_task_async.maxSubAgentDepth"),
  systemOwnedRule("tools.wait_async_task_result.pollIntervalMs"),
  systemOwnedRule("tools.call_mcp_task.maxToolLoopTurns"),
  systemOwnedRule("tools.execute_script"),
  systemOwnedRule("tools.task_summary.phaseSummaryLoopTurns"),
  systemOwnedRule("tools.task_summary.phaseSummaryMessageCharsThreshold"),
  systemOwnedRule("tools.task_summary.maxToolLoopTurns"),
  systemOwnedRule("tools.request_help.helpPromptLoopTurns"),
  systemOwnedRule("tools.request_help.toolFailureHelpCount"),
  systemOwnedRule("plugins.workflow.timeoutMs"),
  systemOwnedRule("plugins.workflow.maxAutoTransitions"),
  systemOwnedRule("plugins.workflow.maxParallelNodeAgents"),
  systemOwnedRule("plugins.workflow.miniRunnerMaxTurns"),
  systemOwnedRule("plugins.workflow.parallelNodeExecution"),
]);

export function listConfigNodePathsByPolicy({
  policy,
  representation = CONFIG_PATH_REPRESENTATION.PERSISTED,
} = {}) {
  if (!Object.values(CONFIG_NODE_POLICY).includes(policy)) {
    throw new TypeError(`unsupported config node policy: ${policy}`);
  }
  if (!Object.values(CONFIG_PATH_REPRESENTATION).includes(representation)) {
    throw new TypeError(`unsupported config path representation: ${representation}`);
  }
  const pathKey =
    representation === CONFIG_PATH_REPRESENTATION.RUNTIME ? "runtimePath" : "persistedPath";
  return Object.freeze(
    CONFIG_NODE_RULES.filter((rule) => rule.policy === policy).map((rule) => rule[pathKey]),
  );
}

export function summarizeConfigRepairReport(report = {}) {
  const actionCounts = {};
  const changes = Array.isArray(report?.changes) ? report.changes : [];
  for (const change of changes) {
    const action = String(change?.action || "unknown");
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }
  return Object.freeze({
    changed: report?.changed === true,
    changeCount: changes.length,
    actionCounts: Object.freeze(actionCounts),
  });
}
