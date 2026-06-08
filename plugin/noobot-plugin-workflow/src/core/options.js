/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_PLUGIN_DEFAULTS,
} from "./constants.js";
import { getWorkflowDefaultSemanticPrompt, normalizeWorkflowLocale } from "./i18n.js";

export const DEFAULT_WORKFLOW_DENY_TOOL_NAMES = Object.freeze([
  "delegate_task_async",
  "wait_async_task_result",
  "plan_multi_task_collaboration",
]);

function normalizeToolNameList(input = []) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || "").trim()).filter(Boolean);
}

export function resolveWorkflowDenyToolNames(input = null) {
  const normalized = normalizeToolNameList(input);
  if (normalized.length) return Array.from(new Set(normalized));
  return [...DEFAULT_WORKFLOW_DENY_TOOL_NAMES];
}

function normalizePriority(input = null) {
  const value = Number(input);
  if (!Number.isFinite(value)) return WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY;
  return Math.max(0, Math.floor(value));
}

function normalizeTimeoutMs(input = null) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS;
  return Math.floor(value);
}

function normalizeNodeAgentTimeoutMs(input = null) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    return WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_NODE_AGENT_TIMEOUT_MS;
  }
  return Math.floor(value);
}

function normalizeWorkflowExtensions(input = null) {
  if (!Array.isArray(input)) return [];
  return input.filter((item) => typeof item === "function");
}

export function normalizeOptions(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const mode = String(source?.mode ?? WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF).trim().toLowerCase();
  const locale = normalizeWorkflowLocale(source?.locale || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_LOCALE);
  const maxAutoTransitions = Number(source?.maxAutoTransitions);
  const maxParallelNodeAgents = Number(source?.maxParallelNodeAgents);

  return {
    enabled: source?.enabled !== false,
    locale,
    mode:
      mode === WORKFLOW_PLUGIN_DEFAULTS.MODE_ON
        ? WORKFLOW_PLUGIN_DEFAULTS.MODE_ON
        : WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF,
    semanticPrompt:
      typeof source?.semanticPrompt === "string" && source.semanticPrompt.trim()
        ? source.semanticPrompt.trim()
        : getWorkflowDefaultSemanticPrompt(locale),
    semanticModel: String(source?.semanticModel || "").trim(),
    maxAutoTransitions:
      Number.isFinite(maxAutoTransitions) && maxAutoTransitions > 0
        ? Math.floor(maxAutoTransitions)
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS,
    parallelNodeExecution: source?.parallelNodeExecution === true,
    maxParallelNodeAgents:
      Number.isFinite(maxParallelNodeAgents) && maxParallelNodeAgents > 0
        ? Math.floor(maxParallelNodeAgents)
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
    nodeAgentTimeoutMs: normalizeNodeAgentTimeoutMs(source?.nodeAgentTimeoutMs),
    priority: normalizePriority(source?.priority),
    timeoutMs: normalizeTimeoutMs(source?.timeoutMs),
    capabilityModelInvoker:
      typeof source?.capabilityModelInvoker === "function" ? source.capabilityModelInvoker : null,
    resolveModelMessages:
      typeof source?.resolveModelMessages === "function" ? source.resolveModelMessages : null,
    nodeAgentExecutor:
      typeof source?.nodeAgentExecutor === "function" ? source.nodeAgentExecutor : null,
    subSessionRunner:
      typeof source?.subSessionRunner === "function" ? source.subSessionRunner : null,
    generatedArtifactPersister:
      typeof source?.generatedArtifactPersister === "function"
        ? source.generatedArtifactPersister
        : null,
    workflowDialogPersister:
      typeof source?.workflowDialogPersister === "function" ? source.workflowDialogPersister : null,
    workflowEventLogger:
      typeof source?.workflowEventLogger === "function" ? source.workflowEventLogger : null,
    workflowNodeSystemMessageBuilder:
      typeof source?.workflowNodeSystemMessageBuilder === "function"
        ? source.workflowNodeSystemMessageBuilder
        : null,
    workflowExtensionMounter:
      typeof source?.workflowExtensionMounter === "function" ? source.workflowExtensionMounter : null,
    workflowExtensions: normalizeWorkflowExtensions(source?.workflowExtensions),
    denyToolNames: resolveWorkflowDenyToolNames(source?.denyToolNames),
  };
}
