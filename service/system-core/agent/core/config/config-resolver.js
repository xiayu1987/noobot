/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveDefaultModelSpec } from "../../../model/index.js";
import {
  DEFAULT_HELP_PROMPT_LOOP_TURNS,
  DEFAULT_MAX_TOOL_LOOP_TURNS,
  DEFAULT_PHASE_SUMMARY_LOOP_TURNS,
  DEFAULT_TOOL_FAILURE_HELP_COUNT,
  TASK_SUMMARY_TOOL_NAME,
} from "../constants/index.js";
import { REQUEST_HELP_TOOL_NAME } from "../../../tools/request-help-tool.js";

function resolvePositiveInteger(value, fallback = 0) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
  return Math.floor(normalized);
}

function resolveTaskSummaryConfig(effectiveConfig = {}) {
  if (
    effectiveConfig?.tools?.[TASK_SUMMARY_TOOL_NAME] &&
    typeof effectiveConfig.tools[TASK_SUMMARY_TOOL_NAME] === "object"
  ) {
    return effectiveConfig.tools[TASK_SUMMARY_TOOL_NAME];
  }
  return {};
}

function resolveHelpToolConfig(effectiveConfig = {}) {
  if (
    effectiveConfig?.tools?.[REQUEST_HELP_TOOL_NAME] &&
    typeof effectiveConfig.tools[REQUEST_HELP_TOOL_NAME] === "object"
  ) {
    return effectiveConfig.tools[REQUEST_HELP_TOOL_NAME];
  }
  return {};
}

export function resolvePhaseSummaryLoopTurns(effectiveConfig = {}) {
  const taskSummaryConfig = resolveTaskSummaryConfig(effectiveConfig);
  const configuredValue =
    taskSummaryConfig.phase_summary_loop_turns ??
    taskSummaryConfig.phaseSummaryLoopTurns ??
    taskSummaryConfig.max_tool_loop_turns ??
    taskSummaryConfig.maxToolLoopTurns ??
    DEFAULT_PHASE_SUMMARY_LOOP_TURNS;
  return resolvePositiveInteger(configuredValue, 0);
}

export function resolveHelpPromptLoopTurns(effectiveConfig = {}) {
  const helpToolConfig = resolveHelpToolConfig(effectiveConfig);
  const configuredValue =
    helpToolConfig.help_prompt_loop_turns ??
    helpToolConfig.helpPromptLoopTurns ??
    DEFAULT_HELP_PROMPT_LOOP_TURNS;
  return resolvePositiveInteger(configuredValue, 0);
}

export function resolveToolFailureHelpCount(effectiveConfig = {}) {
  const helpToolConfig = resolveHelpToolConfig(effectiveConfig);
  const configuredValue =
    helpToolConfig.tool_failure_help_count ??
    helpToolConfig.toolFailureHelpCount ??
    DEFAULT_TOOL_FAILURE_HELP_COUNT;
  return resolvePositiveInteger(configuredValue, 0);
}

export function resolveMaxToolLoopTurns({ systemRuntime = {}, effectiveConfig = {} } = {}) {
  const runtimeMaxTurns = resolvePositiveInteger(systemRuntime?.config?.maxToolLoopTurns, 0);
  if (runtimeMaxTurns > 0) return runtimeMaxTurns;
  const configMaxTurns = resolvePositiveInteger(
    effectiveConfig?.maxToolLoopTurns,
    DEFAULT_MAX_TOOL_LOOP_TURNS,
  );
  return configMaxTurns > 0 ? configMaxTurns : DEFAULT_MAX_TOOL_LOOP_TURNS;
}

export function resolveEffectiveModelSpec({ globalConfig = {}, userConfig = {} } = {}) {
  return resolveDefaultModelSpec({ globalConfig, userConfig });
}
