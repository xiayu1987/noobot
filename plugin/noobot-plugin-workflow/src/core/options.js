/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PLUGIN_DEFAULTS } from "./constants.js";
import { getWorkflowDefaultSemanticPrompt, normalizeWorkflowLocale } from "./i18n.js";
import { isFunction, text } from "@noobot/shared/value";

function normalizeToolNameList(input = []) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => text(item)).filter(Boolean);
}

export function resolveWorkflowDenyToolNames(input = null) {
  const normalized = normalizeToolNameList(input);
  return Array.from(new Set(normalized));
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

const WORKFLOW_AGENT_HOST_CAPABILITIES = Object.freeze([
  "capabilityModelInvoker",
  "resolveModelMessages",
  "subSessionRunner",
]);

export function resolveWorkflowAgentHostCapabilities(input = {}) {
  return Object.fromEntries(
    WORKFLOW_AGENT_HOST_CAPABILITIES.map((name) => {
      if (!isFunction(input?.[name])) {
        throw new TypeError(`workflow agent surface requires host capability: ${name}`);
      }
      return [name, input[name]];
    }),
  );
}

export function normalizeOptions(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const mode = (text(source?.mode) || WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF).toLowerCase();
  const locale = normalizeWorkflowLocale(source?.locale || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_LOCALE);
  const maxAutoTransitions = Number(source?.maxAutoTransitions);
  const maxParallelNodeAgents = Number(source?.maxParallelNodeAgents);
  const miniRunnerMaxTurns = Number(source?.miniRunnerMaxTurns);

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
    semanticModel: text(source?.semanticModel),
    maxAutoTransitions:
      Number.isFinite(maxAutoTransitions) && maxAutoTransitions > 0
        ? Math.floor(maxAutoTransitions)
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS,
    parallelNodeExecution: source?.parallelNodeExecution === true,
    maxParallelNodeAgents:
      Number.isFinite(maxParallelNodeAgents) && maxParallelNodeAgents > 0
        ? Math.floor(maxParallelNodeAgents)
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
    miniRunnerMaxTurns:
      Number.isFinite(miniRunnerMaxTurns) && miniRunnerMaxTurns > 0
        ? Math.floor(miniRunnerMaxTurns)
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MINI_RUNNER_MAX_TURNS,
    nodeAgentTimeoutMs: normalizeNodeAgentTimeoutMs(source?.nodeAgentTimeoutMs),
    priority: normalizePriority(source?.priority),
    timeoutMs: normalizeTimeoutMs(source?.timeoutMs),
    denyToolNames: resolveWorkflowDenyToolNames(source?.denyToolNames),
  };
}
