/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { emitEvent } from "../events/index.js";
import { tEngine } from "./i18n-adapter.js";
import {
  PHASE_SUMMARY_PROMPT_MARKER,
  PHASE_SUMMARY_OVERFLOW_POLICY,
  HELP_TOOL_LOOP_PROMPT_MARKER,
  HELP_TOOL_FAILURE_PROMPT_MARKER,
  TASK_SUMMARY_TOOL_NAME,
} from "./constants/index.js";
import { REQUEST_HELP_TOOL_NAME } from "../tools/collaboration/request-help-tool.js";
import { extractMessageTextContent } from "../context/session/message-content-utils.js";
import { appendMessage } from "@noobot/context-protocol/message-store";
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
  const marker =
    message?.additional_kwargs?.noobotInternalMessageType ||
    message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
    message?.metadata?.noobotInternalMessageType ||
    message?.lc_kwargs?.metadata?.noobotInternalMessageType ||
    "";
  return Boolean(String(marker || "").trim());
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

export function removePhaseSummaryPromptMessages(messages = [], runtime = {}) {
  if (!Array.isArray(messages)) return 0;
  let removedCount = 0;
  const phaseSummaryPrompt = tEngine(runtime, "phaseSummaryPrompt");
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const marker =
      message?.additional_kwargs?.noobotInternalMessageType ||
      message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      message?.metadata?.noobotInternalMessageType ||
      message?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "";
    if (marker === PHASE_SUMMARY_PROMPT_MARKER) {
      messages.splice(index, 1);
      removedCount += 1;
      continue;
    }
    const content = String(message?.content || "").trim();
    if (content !== phaseSummaryPrompt) continue;
    messages.splice(index, 1);
    removedCount += 1;
  }
  return removedCount;
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

  const currentCount = Number(systemRuntime.toolLoopExecutionCount || 0);
  const nextCount = Number.isFinite(currentCount) && currentCount >= 0
    ? currentCount + 1
    : 1;
  systemRuntime.toolLoopExecutionCount = nextCount;
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
  appendMessage(loopState.modelContext, new HumanMessage({
    content: tEngine(runtime, "phaseSummaryPrompt"),
    additional_kwargs: {
      noobotInternalMessageType: PHASE_SUMMARY_PROMPT_MARKER,
    },
  }), { block: "incremental" });
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
  appendMessage(loopState.modelContext, new SystemMessage({
    content: tEngine(runtime, "helpToolLoopPrompt", {
      loopCount: nextCount,
      threshold,
      helpToolName: REQUEST_HELP_TOOL_NAME,
    }),
    additional_kwargs: {
      noobotInternalMessageType: HELP_TOOL_LOOP_PROMPT_MARKER,
    },
  }), { block: "system" });
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
  appendMessage(loopState.modelContext, new HumanMessage({
    content: tEngine(runtime, "toolConsecutiveFailureHelpPrompt", {
      failureCount,
      threshold,
      helpToolName: REQUEST_HELP_TOOL_NAME,
    }),
    additional_kwargs: {
      noobotInternalMessageType: HELP_TOOL_FAILURE_PROMPT_MARKER,
    },
  }), { block: "incremental" });
  loopState.toolConsecutiveFailureCount = 0;
  systemRuntime.toolConsecutiveFailureCount = 0;
  emitEvent(modelState?.eventListener || null, "help_tool_failure_prompted", {
    failureCount,
    threshold,
  });
  return true;
}
