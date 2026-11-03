/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { WORKFLOW_PLUGIN_DEFAULTS } from "./constants.js";
import { isFunction, text } from "@noobot/shared/value";

function normalizeToolNameList(input = []) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => text(item)).filter(Boolean);
}

export function resolveWorkflowDenyToolNames(input = null) {
  const normalized = normalizeToolNameList(input);
  return Array.from(new Set(normalized));
}

function isConfigured(value) {
  return value !== undefined && value !== null;
}

function resolveIntegerOption(source, name, { minimum, resolveDefault }) {
  const value = source[name];
  if (!isConfigured(value)) return resolveDefault();
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`workflow option ${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function resolveMode(source) {
  if (!isConfigured(source.mode)) return WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF;
  const mode = text(source.mode).toLowerCase();
  if (mode === WORKFLOW_PLUGIN_DEFAULTS.MODE_ON || mode === WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF) {
    return mode;
  }
  throw new TypeError(
    `workflow option mode must be "${WORKFLOW_PLUGIN_DEFAULTS.MODE_ON}" or "${WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF}"`,
  );
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

  return {
    enabled: source?.enabled !== false,
    mode: resolveMode(source),
    semanticPrompt:
      typeof source?.semanticPrompt === "string" && source.semanticPrompt.trim()
        ? source.semanticPrompt.trim()
        : "",
    semanticModel: text(source?.semanticModel),
    maxAutoTransitions: resolveIntegerOption(source, "maxAutoTransitions", {
      minimum: 1,
      resolveDefault: () => WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS,
    }),
    parallelNodeExecution: source?.parallelNodeExecution === true,
    maxParallelNodeAgents: resolveIntegerOption(source, "maxParallelNodeAgents", {
      minimum: 1,
      resolveDefault: () => WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
    }),
    miniRunnerMaxTurns: resolveIntegerOption(source, "miniRunnerMaxTurns", {
      minimum: 1,
      resolveDefault: () => TURN_THRESHOLDS.workflow.miniRunnerMaxTurns,
    }),
    nodeAgentTimeoutMs: resolveIntegerOption(source, "nodeAgentTimeoutMs", {
      minimum: 1000,
      resolveDefault: () => TIME_THRESHOLDS.workflow.nodeAgentTimeoutMs,
    }),
    priority: resolveIntegerOption(source, "priority", {
      minimum: 0,
      resolveDefault: () => WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY,
    }),
    timeoutMs: resolveIntegerOption(source, "timeoutMs", {
      minimum: 1,
      resolveDefault: () => TIME_THRESHOLDS.workflow.timeoutMs,
    }),
    denyToolNames: resolveWorkflowDenyToolNames(source?.denyToolNames),
  };
}
