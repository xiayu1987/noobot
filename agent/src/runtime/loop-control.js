/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../events/index.js";
import { tEngine } from "./i18n-adapter.js";
import {
  PHASE_SUMMARY_OVERFLOW_POLICY,
} from "./constants/index.js";
import {
  CONTEXT_INJECTED_MESSAGE_TYPE,
  resolveContextInternalMessageType,
} from "@noobot/context-protocol/injected-message-policy";
import {
  DEFAULT_TASK_CHECK_TOOL_NAME as TASK_CHECK_TOOL_NAME,
  DEFAULT_TASK_SUMMARY_TOOL_NAME as TASK_SUMMARY_TOOL_NAME,
} from "@noobot/context-protocol/summary-policy";
import { REQUEST_HELP_TOOL_NAME } from "../tools/collaboration/request-help-tool.js";
import { extractMessageTextContent } from "../context/session/message-content-utils.js";
import { appendTurnContextControlMessage } from "./turn/turn-context-message-appender.js";
import {
  MAIN_FLOW_CONTROL_REASON,
  requestMainFlowFinalNoToolsTurn,
} from "./main-flow-control.js";


function getSystemRuntime(runtime = {}) {
  return runtime?.systemRuntime && typeof runtime.systemRuntime === "object"
    ? runtime.systemRuntime
    : null;
}

function hasTool(tools = [], toolName) {
  return (Array.isArray(tools) ? tools : []).some(
    (def) => String(def?.name || "").trim() === toolName,
  );
}


function hasTaskSummaryTool(tools = []) {
  return hasTool(tools, TASK_SUMMARY_TOOL_NAME);
}

function isMessageSummarized(message = {}) {
  return message?.summarized === true || message?.lc_kwargs?.summarized === true;
}

function hasInternalMessageMarker(message = {}) {
  return Boolean(resolveContextInternalMessageType(message));
}

function resolveUnsummarizedMessageChars(messages = []) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, message) => {
    if (!message || typeof message !== "object") return total;
    if (isMessageSummarized(message)) return total;
    if (hasInternalMessageMarker(message)) return total;
    const text = extractMessageTextContent(message?.content ?? message);
    return total + String(text || "").length;
  }, 0);
}

function handlePostSummaryCharsOverflow({
  modelState,
  loopState,
  loopCount = 0,
  source = "agent_phase_summary",
} = {}) {
  const runtime = modelState?.runtime || {};
  const systemRuntime = getSystemRuntime(runtime);
  if (!systemRuntime) return false;
  if (!hasTaskSummaryTool(loopState?.tools || [])) return false;
  if (systemRuntime.needsPhaseSummary === true) return false;
  if (systemRuntime.phaseSummaryByCharsPrompted !== true) return false;

  const charsThreshold = Number(loopState?.phaseSummaryMessageCharsThreshold || 0);
  if (!Number.isFinite(charsThreshold) || charsThreshold <= 0) return false;

  const messages = loopState?.modelContext?.messages || [];
  const unsummarizedChars = resolveUnsummarizedMessageChars(messages);
  if (unsummarizedChars <= charsThreshold) {
    systemRuntime.phaseSummaryByCharsPrompted = false;
    return false;
  }

  if (PHASE_SUMMARY_OVERFLOW_POLICY.ENFORCE_NO_TOOLS_WHEN_STILL_OVERFLOW === true) {
    requestMainFlowFinalNoToolsTurn(runtime, {
      reason: MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY,
      source,
      detail: {
        loopCount,
        charsThreshold,
        unsummarizedChars,
      },
    });
  }
  emitEvent(modelState?.eventListener || null, "phase_summary_hard_overflow", {
      loopCount,
      charsThreshold,
      unsummarizedChars,
  });
  return PHASE_SUMMARY_OVERFLOW_POLICY.ENFORCE_NO_TOOLS_WHEN_STILL_OVERFLOW === true;
}

export function maybeFinalizeNoToolsAfterPhaseSummaryOverflow({ modelState, loopState } = {}) {
  const runtime = modelState?.runtime || {};
  const systemRuntime = getSystemRuntime(runtime);
  const loopCount = Number(systemRuntime?.phaseSummaryLoopCount || 0);
  return handlePostSummaryCharsOverflow({
    modelState,
    loopState,
    loopCount,
    source: "agent_phase_summary",
  });
}

export function maybeRequestPhaseSummary({ modelState, loopState, toolCallResults = [] }) {
  const runtime = modelState?.runtime || {};
  const systemRuntime = getSystemRuntime(runtime);
  if (!systemRuntime) return false;

  const hasTaskSummaryCall = (Array.isArray(toolCallResults) ? toolCallResults : [])
    .some((r) => String(r?.call?.name || "").trim() === TASK_SUMMARY_TOOL_NAME);
  if (hasTaskSummaryCall) return false;

  const currentCount = Number(systemRuntime.phaseSummaryLoopCount || 0);
  const nextCount = Number.isFinite(currentCount) && currentCount >= 0
    ? currentCount + 1
    : 1;
  systemRuntime.phaseSummaryLoopCount = nextCount;

  if (!hasTaskSummaryTool(loopState?.tools || [])) return false;
  if (systemRuntime.needsPhaseSummary === true) return false;

  const loopThreshold = Number(loopState?.phaseSummaryLoopTurns || 0);
  const reachedLoopThreshold = Number.isFinite(loopThreshold) &&
    loopThreshold > 0 &&
    nextCount >= loopThreshold;
  const charsThreshold = Number(loopState?.phaseSummaryMessageCharsThreshold || 0);
  const unsummarizedChars = resolveUnsummarizedMessageChars(loopState?.modelContext?.messages || []);
  const reachedCharsThreshold = Number.isFinite(charsThreshold) &&
    charsThreshold > 0 &&
    unsummarizedChars > charsThreshold;
  if (!reachedLoopThreshold && !reachedCharsThreshold) {
    systemRuntime.phaseSummaryByCharsPrompted = false;
    return false;
  }

  if (reachedCharsThreshold && systemRuntime.phaseSummaryByCharsPrompted === true) {
    return handlePostSummaryCharsOverflow({
      modelState,
      loopState,
      loopCount: nextCount,
      source: "agent_phase_summary",
    });
  }

  systemRuntime.needsPhaseSummary = true;
  systemRuntime.phaseSummaryLoopCount = 0;
  if (reachedCharsThreshold) {
    systemRuntime.phaseSummaryByCharsPrompted = true;
  }
  appendTurnContextControlMessage({
    runtime,
    loopState,
    content: tEngine(runtime, "phaseSummaryPrompt"),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
  });
  emitEvent(modelState?.eventListener || null, "phase_summary_required", {
    loopCount: nextCount,
    loopThreshold,
    charsThreshold,
    unsummarizedChars,
    trigger:
      reachedLoopThreshold && reachedCharsThreshold
        ? "both"
        : reachedCharsThreshold
          ? "message_chars"
          : "loop_turns",
  });
  return true;
}

export function maybeRequestTaskCheck({ modelState, loopState, toolCallResults = [] }) {
  const runtime = modelState?.runtime || {};
  const systemRuntime = getSystemRuntime(runtime);
  if (!systemRuntime) return false;
  if (!hasTool(loopState?.tools || [], TASK_CHECK_TOOL_NAME)) return false;

  const hasTaskCheckCall = (Array.isArray(toolCallResults) ? toolCallResults : [])
    .some((result) => String(result?.call?.name || "").trim() === TASK_CHECK_TOOL_NAME);
  if (hasTaskCheckCall) {
    systemRuntime.taskCheckLoopCount = 0;
    return false;
  }

  const currentCount = Number(systemRuntime.taskCheckLoopCount || 0);
  const nextCount = Number.isFinite(currentCount) && currentCount >= 0
    ? currentCount + 1
    : 1;
  systemRuntime.taskCheckLoopCount = nextCount;
  const threshold = Number(loopState?.taskCheckLoopTurns || 0);
  if (!Number.isFinite(threshold) || threshold <= 0 || nextCount < threshold) return false;

  systemRuntime.taskCheckLoopCount = 0;
  appendTurnContextControlMessage({
    runtime,
    loopState,
    content: tEngine(runtime, "taskCheckPrompt"),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
  });
  emitEvent(modelState?.eventListener || null, "task_check_required", {
    loopCount: nextCount,
    threshold,
  });
  return true;
}


export function maybePromptHelpToolByLoop({ modelState, loopState }) {
  const runtime = modelState?.runtime || {};
  const systemRuntime = getSystemRuntime(runtime);
  if (!systemRuntime) return false;
  const threshold = Number(loopState?.helpPromptLoopTurns || 0);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  if (!hasTool(loopState?.tools || [], REQUEST_HELP_TOOL_NAME)) return false;
  const currentCount = Number(systemRuntime.helpPromptLoopCount || 0);
  const nextCount =
    Number.isFinite(currentCount) && currentCount >= 0 ? currentCount + 1 : 1;
  systemRuntime.helpPromptLoopCount = nextCount;
  if (nextCount < threshold) return false;
  systemRuntime.helpPromptLoopCount = 0;
  appendTurnContextControlMessage({
    runtime,
    loopState,
    content: tEngine(runtime, "helpToolLoopPrompt", {
      loopCount: nextCount,
      threshold,
      helpToolName: REQUEST_HELP_TOOL_NAME,
    }),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT,
  });
  emitEvent(modelState?.eventListener || null, "help_tool_loop_prompted", {
    loopCount: nextCount,
    threshold,
  });
  return true;
}

export function maybePromptHelpToolByFailure({
  modelState,
  loopState,
  hasRequestHelpCall = false,
}) {
  const runtime = modelState?.runtime || {};
  const systemRuntime = getSystemRuntime(runtime);
  const threshold = Number(loopState?.toolFailureHelpCount || 0);
  if (!systemRuntime) return false;
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  if (!hasTool(loopState?.tools || [], REQUEST_HELP_TOOL_NAME)) return false;
  if (hasRequestHelpCall) return false;
  const failureCount = Number(loopState?.toolConsecutiveFailureCount || 0);
  if (!Number.isFinite(failureCount) || failureCount < threshold) return false;
  appendTurnContextControlMessage({
    runtime,
    loopState,
    content: tEngine(runtime, "toolConsecutiveFailureHelpPrompt", {
      failureCount,
      threshold,
      helpToolName: REQUEST_HELP_TOOL_NAME,
    }),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_FAILURE_PROMPT,
  });
  loopState.toolConsecutiveFailureCount = 0;
  systemRuntime.toolConsecutiveFailureCount = 0;
  emitEvent(modelState?.eventListener || null, "help_tool_failure_prompted", {
    failureCount,
    threshold,
  });
  return true;
}
