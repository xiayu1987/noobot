/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../events/index.js";
import { tEngine } from "./i18n-adapter.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import { HELP_TOOL_NAME } from "../tools/collaboration/help-tool.js";
import { TOOL_NAME } from "../tools/constants/index.js";
import { resolveControlToolOutcome } from "./control-tool-outcome.js";
import { appendTurnRuntimeInjectedMessage } from "./turn/turn-context-message-appender.js";
import {
  hasExternalSummaryScheduler,
  peekMainFlowPhaseSummary,
  requestMainFlowPhaseSummary,
} from "./main-flow-control.js";
import { text, isObjectLike } from "@noobot/shared/value";
import { requireActiveModelContext } from "./active-model-context.js";
import {
  countSummaryMessageChars,
  resolveSummaryScope,
} from "@noobot/context-protocol/policy/summary";

function getSystemRuntime(runtime = {}) {
  return isObjectLike(runtime?.systemRuntime) ? runtime.systemRuntime : null;
}

function hasTool(tools = [], toolName) {
  return (Array.isArray(tools) ? tools : []).some((def) => text(def?.name) === toolName);
}

function resolveSummaryTrigger(reachedLoopThreshold, reachedCharsThreshold) {
  if (reachedLoopThreshold && reachedCharsThreshold) return "both";
  return reachedCharsThreshold ? "message_chars" : "loop_turns";
}

export async function maybeRequestPhaseSummary({ modelState, loopState }) {
  const { runtime } = modelState;
  const systemRuntime = getSystemRuntime(runtime);
  if (!systemRuntime) return false;

  if (hasExternalSummaryScheduler(runtime) || peekMainFlowPhaseSummary(runtime)) return false;

  const currentCount = Number(systemRuntime.phaseSummaryLoopCount || 0);
  const nextCount = Number.isFinite(currentCount) && currentCount >= 0 ? currentCount + 1 : 1;
  systemRuntime.phaseSummaryLoopCount = nextCount;

  const loopThreshold = Number(loopState?.phaseSummaryLoopTurns || 0);
  const reachedLoopThreshold =
    Number.isFinite(loopThreshold) && loopThreshold > 0 && nextCount >= loopThreshold;
  const charsThreshold = Number(loopState?.phaseSummaryMessageCharsThreshold || 0);
  const charsThresholdEnabled = Number.isFinite(charsThreshold) && charsThreshold > 0;
  if (!reachedLoopThreshold && !charsThresholdEnabled) return false;
  const { summaryMessages } = resolveSummaryScope(requireActiveModelContext(runtime).messageBlocks);
  if (!summaryMessages.length) return false;
  const unsummarizedChars = countSummaryMessageChars(summaryMessages);
  const reachedCharsThreshold = charsThresholdEnabled && unsummarizedChars > charsThreshold;
  if (!reachedLoopThreshold && !reachedCharsThreshold) return false;

  requestMainFlowPhaseSummary(runtime, {
    source: "agent.phase_summary",
    prompt: tEngine(runtime, "phaseSummaryPrompt"),
    onCommitted: () => {
      systemRuntime.phaseSummaryLoopCount = 0;
    },
  });
  await emitEvent(runtime.eventListener, "phase_summary_required", {
    loopCount: nextCount,
    loopThreshold,
    charsThreshold,
    unsummarizedChars,
    trigger: resolveSummaryTrigger(reachedLoopThreshold, reachedCharsThreshold),
  });
  return true;
}

export function maybeRequestTaskCheck({ modelState, loopState, toolCallResults = [] }) {
  const { runtime } = modelState;
  const systemRuntime = getSystemRuntime(runtime);
  if (!systemRuntime) return false;
  if (!hasTool(loopState?.tools || [], TOOL_NAME.TASK_CHECK)) return false;

  const taskCheckOutcome = resolveControlToolOutcome(toolCallResults, TOOL_NAME.TASK_CHECK);
  if (taskCheckOutcome.attempted) {
    if (taskCheckOutcome.accepted) systemRuntime.taskCheckLoopCount = 0;
    return false;
  }

  const currentCount = Number(systemRuntime.taskCheckLoopCount || 0);
  const nextCount = Number.isFinite(currentCount) && currentCount >= 0 ? currentCount + 1 : 1;
  systemRuntime.taskCheckLoopCount = nextCount;
  const threshold = Number(loopState?.taskCheckLoopTurns || 0);
  if (!Number.isFinite(threshold) || threshold <= 0 || nextCount < threshold) return false;

  systemRuntime.taskCheckLoopCount = 0;
  appendTurnRuntimeInjectedMessage({
    runtime,
    content: tEngine(runtime, "taskCheckPrompt"),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
  });
  emitEvent(runtime.eventListener, "task_check_required", {
    loopCount: nextCount,
    threshold,
    modelLoopRound: Number(systemRuntime.modelLoopRound || 0),
  });
  return true;
}

export function maybePromptHelpToolByLoop({ modelState, loopState }) {
  const { runtime } = modelState;
  const systemRuntime = getSystemRuntime(runtime);
  if (!systemRuntime) return false;
  const threshold = Number(loopState?.helpPromptLoopTurns || 0);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  if (!hasTool(loopState?.tools || [], HELP_TOOL_NAME)) return false;
  const currentCount = Number(systemRuntime.helpPromptLoopCount || 0);
  const nextCount = Number.isFinite(currentCount) && currentCount >= 0 ? currentCount + 1 : 1;
  systemRuntime.helpPromptLoopCount = nextCount;
  if (nextCount < threshold) return false;
  systemRuntime.helpPromptLoopCount = 0;
  appendTurnRuntimeInjectedMessage({
    runtime,
    content: tEngine(runtime, "helpToolLoopPrompt", {
      loopCount: nextCount,
      threshold,
      helpToolName: HELP_TOOL_NAME,
    }),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT,
  });
  emitEvent(runtime.eventListener, "help_tool_loop_prompted", {
    loopCount: nextCount,
    threshold,
  });
  return true;
}

export function maybePromptHelpToolByFailure({ modelState, loopState, hasHelpCall = false }) {
  const { runtime } = modelState;
  const systemRuntime = getSystemRuntime(runtime);
  const threshold = Number(loopState?.toolFailureHelpCount || 0);
  if (!systemRuntime) return false;
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  if (!hasTool(loopState?.tools || [], HELP_TOOL_NAME)) return false;
  if (hasHelpCall) return false;
  const failureCount = systemRuntime.toolConsecutiveFailureCount;
  if (failureCount < threshold) return false;
  appendTurnRuntimeInjectedMessage({
    runtime,
    content: tEngine(runtime, "toolConsecutiveFailureHelpPrompt", {
      failureCount,
      threshold,
      helpToolName: HELP_TOOL_NAME,
    }),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_FAILURE_PROMPT,
  });
  systemRuntime.toolConsecutiveFailureCount = 0;
  emitEvent(runtime.eventListener, "help_tool_failure_prompted", {
    failureCount,
    threshold,
  });
  return true;
}
