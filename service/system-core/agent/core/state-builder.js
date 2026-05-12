/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createChatModel, resolveDefaultModelSpec } from "../../model/index.js";
import { mergeConfig } from "../../config/index.js";
import { emitEvent } from "../../event/index.js";
import { buildContextMessages } from "./context/message-builder.js";
import {
  DEFAULT_MAX_TOOL_LOOP_TURNS,
  DEFAULT_PHASE_SUMMARY_LOOP_TURNS,
  DEFAULT_HELP_PROMPT_LOOP_TURNS,
  DEFAULT_TOOL_FAILURE_HELP_COUNT,
  TASK_SUMMARY_TOOL_NAME,
} from "./constants.js";
import { REQUEST_HELP_TOOL_NAME } from "../../tools/request-help-tool.js";

// ── Config Resolution ──

function resolvePhaseSummaryLoopTurns(effectiveConfig = {}) {
  const taskSummaryConfig =
    effectiveConfig?.tools?.[TASK_SUMMARY_TOOL_NAME] &&
    typeof effectiveConfig.tools[TASK_SUMMARY_TOOL_NAME] === "object"
      ? effectiveConfig.tools[TASK_SUMMARY_TOOL_NAME]
      : {};
  const configuredValue = Number(
    taskSummaryConfig.phase_summary_loop_turns ??
      taskSummaryConfig.phaseSummaryLoopTurns ??
      taskSummaryConfig.max_tool_loop_turns ??
      taskSummaryConfig.maxToolLoopTurns ??
      DEFAULT_PHASE_SUMMARY_LOOP_TURNS,
  );
  if (!Number.isFinite(configuredValue) || configuredValue <= 0) return 0;
  return Math.floor(configuredValue);
}

function resolveHelpPromptLoopTurns(effectiveConfig = {}) {
  const helpToolConfig =
    effectiveConfig?.tools?.[REQUEST_HELP_TOOL_NAME] &&
    typeof effectiveConfig.tools[REQUEST_HELP_TOOL_NAME] === "object"
      ? effectiveConfig.tools[REQUEST_HELP_TOOL_NAME]
      : {};
  const configuredValue = Number(
    helpToolConfig.help_prompt_loop_turns ??
      helpToolConfig.helpPromptLoopTurns ??
      DEFAULT_HELP_PROMPT_LOOP_TURNS,
  );
  if (!Number.isFinite(configuredValue) || configuredValue <= 0) return 0;
  return Math.floor(configuredValue);
}

function resolveToolFailureHelpCount(effectiveConfig = {}) {
  const helpToolConfig =
    effectiveConfig?.tools?.[REQUEST_HELP_TOOL_NAME] &&
    typeof effectiveConfig.tools[REQUEST_HELP_TOOL_NAME] === "object"
      ? effectiveConfig.tools[REQUEST_HELP_TOOL_NAME]
      : {};
  const configuredValue = Number(
    helpToolConfig.tool_failure_help_count ??
      helpToolConfig.toolFailureHelpCount ??
      DEFAULT_TOOL_FAILURE_HELP_COUNT,
  );
  if (!Number.isFinite(configuredValue) || configuredValue <= 0) return 0;
  return Math.floor(configuredValue);
}

// ── Counter Normalization ──

/**
 * Normalizes systemRuntime counters to ensure they are valid numbers.
 * IMPORTANT: toolLoopExecutionCount MUST be normalized before
 * phaseSummaryLoopCount, because phaseSummaryLoopCount falls back to
 * the already-normalized toolLoopExecutionCount value.
 */
function normalizeSystemRuntimeCounters(systemRuntime, userMessage) {
  if (!systemRuntime || typeof systemRuntime !== "object") return;

  // Normalize toolLoopExecutionCount FIRST
  const toolLoopExecutionCount = Number(systemRuntime.toolLoopExecutionCount || 0);
  systemRuntime.toolLoopExecutionCount =
    Number.isFinite(toolLoopExecutionCount) && toolLoopExecutionCount > 0
      ? toolLoopExecutionCount
      : 0;

  // Then normalize phaseSummaryLoopCount (fallbacks to normalized toolLoopExecutionCount)
  const phaseSummaryLoopCount = Number(
    systemRuntime.phaseSummaryLoopCount ??
      systemRuntime.toolLoopExecutionCount ??
      0,
  );
  systemRuntime.phaseSummaryLoopCount =
    Number.isFinite(phaseSummaryLoopCount) && phaseSummaryLoopCount > 0
      ? phaseSummaryLoopCount
      : 0;

  // Normalize remaining counters
  const otherCounters = ["helpPromptLoopCount", "toolConsecutiveFailureCount"];
  for (const key of otherCounters) {
    const value = Number(systemRuntime[key] || 0);
    systemRuntime[key] = Number.isFinite(value) && value > 0 ? value : 0;
  }

  systemRuntime.needsPhaseSummary = systemRuntime.needsPhaseSummary === true;
  systemRuntime.currentTurnUserMessage = String(userMessage || "").trim();
}

// ── Public API ──

/**
 * Resolves runtime config, creates LLM, builds messages, and assembles
 * modelState + loopState for the function-call loop.
 */
export function buildAgentState({ agentContext, userMessage, errorLogger }) {
  const runtime = agentContext?.execution?.controllers?.runtime || {};
  const sys = runtime.systemRuntime || {};
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const eventListener = runtime.eventListener || null;
  const abortSignal = runtime.abortSignal || null;
  const dialogProcessId = sys.dialogProcessId || "";
  const tools = Array.isArray(agentContext?.payload?.tools?.registry)
    ? agentContext.payload.tools.registry
    : [];

  normalizeSystemRuntimeCounters(runtime.systemRuntime, userMessage);

  const selectedModelSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
  const runtimeMaxTurns = Number(sys?.config?.maxToolLoopTurns || 0);
  const configMaxTurns = Number(effectiveConfig?.maxToolLoopTurns || DEFAULT_MAX_TOOL_LOOP_TURNS);
  const maxToolLoopTurns =
    Number.isFinite(runtimeMaxTurns) && runtimeMaxTurns > 0 ? runtimeMaxTurns : configMaxTurns;
  const phaseSummaryLoopTurns = resolvePhaseSummaryLoopTurns(effectiveConfig);
  const helpPromptLoopTurns = resolveHelpPromptLoopTurns(effectiveConfig);
  const toolFailureHelpCount = resolveToolFailureHelpCount(effectiveConfig);

  const llm = createChatModel({
    globalConfig,
    userConfig,
    streaming: Boolean(eventListener?.onEvent),
  });
  emitEvent(eventListener, "model_selected", {
    alias: selectedModelSpec?.alias || "",
    model: selectedModelSpec?.model || "",
  });

  const messages = buildContextMessages(agentContext, { currentUserMessage: userMessage });

  const modelState = {
    llm,
    activeModelName: selectedModelSpec?.model || "",
    activeModelAlias: selectedModelSpec?.alias || "",
    eventListener,
    runtime,
    globalConfig,
    userConfig,
    defaultModelSpec: selectedModelSpec,
    abortSignal,
  };

  const loopState = {
    tools,
    messages,
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: runtime?.currentTurnMessages || null,
    currentTurnTasks: runtime?.currentTurnTasks || null,
    dialogProcessId,
    maxTurns:
      Number.isFinite(maxToolLoopTurns) && maxToolLoopTurns > 0
        ? maxToolLoopTurns
        : DEFAULT_MAX_TOOL_LOOP_TURNS,
    phaseSummaryLoopTurns,
    helpPromptLoopTurns,
    toolFailureHelpCount,
    taskSummaryTriggered: false,
    toolConsecutiveFailureCount: Number(
      runtime?.systemRuntime?.toolConsecutiveFailureCount || 0,
    ),
    errorLogger,
  };

  return { modelState, loopState };
}
