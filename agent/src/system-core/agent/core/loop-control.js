/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { emitEvent } from "../../event/index.js";
import { tEngine } from "./i18n-adapter.js";
import {
  PHASE_SUMMARY_PROMPT_MARKER,
  PHASE_SUMMARY_OVERFLOW_POLICY,
  HELP_TOOL_LOOP_PROMPT_MARKER,
  HELP_TOOL_FAILURE_PROMPT_MARKER,
  TASK_SUMMARY_TOOL_NAME,
} from "./constants/index.js";
import { REQUEST_HELP_TOOL_NAME } from "../../tools/collaboration/request-help-tool.js";
import { extractMessageTextContent } from "../../context/session/message-content-utils.js";
import { appendMessage } from "./message-context/message-store.js";

// ── Helpers ──

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

// ── Phase Summary ──

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

function getMessageType(message = {}) {
  if (typeof message?._getType === "function") {
    return String(message._getType() || "").trim().toLowerCase();
  }
  return String(message?.lc_kwargs?.type || message?.type || "").trim().toLowerCase();
}

function getMessageRole(message = {}) {
  const roleFromField = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (roleFromField) return roleFromField;
  const type = getMessageType(message);
  if (type === "human") return "user";
  if (type === "ai") return "assistant";
  if (type === "tool") return "tool";
  if (type === "system") return "system";
  return "";
}

function getMessageToolCalls(message = {}) {
  if (Array.isArray(message?.tool_calls)) return message.tool_calls;
  if (Array.isArray(message?.lc_kwargs?.tool_calls)) return message.lc_kwargs.tool_calls;
  if (Array.isArray(message?.additional_kwargs?.tool_calls)) {
    return message.additional_kwargs.tool_calls;
  }
  return [];
}

function resolveToolCallId(toolCall = {}) {
  return String(toolCall?.id ?? toolCall?.tool_call_id ?? toolCall?.toolCallId ?? "").trim();
}

function resolveToolName(toolCall = {}) {
  if (toolCall?.name) return String(toolCall.name || "").trim();
  const fn = toolCall?.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return String(fn.name || "").trim();
}

function resolveToolCallIdFromToolMessage(message = {}) {
  return String(
    message?.tool_call_id ??
      message?.toolCallId ??
      message?.lc_kwargs?.tool_call_id ??
      "",
  ).trim();
}

function setMessageSummarized(message = {}) {
  if (!message || typeof message !== "object") return false;
  if (isMessageSummarized(message)) return false;
  message.summarized = true;
  if (message?.lc_kwargs && typeof message.lc_kwargs === "object") {
    message.lc_kwargs.summarized = true;
  }
  return true;
}

function discardOldestToolCallPairs(messages = [], charsThreshold = 0) {
  if (!Array.isArray(messages) || !Number.isFinite(charsThreshold) || charsThreshold <= 0) {
    return { discardedMessages: 0, charsAfter: resolveUnsummarizedMessageChars(messages) };
  }
  let charsAfter = resolveUnsummarizedMessageChars(messages);
  if (charsAfter <= charsThreshold) {
    return { discardedMessages: 0, charsAfter };
  }
  let discardedMessages = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (charsAfter <= charsThreshold) break;
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    if (isMessageSummarized(message)) continue;
    if (getMessageRole(message) !== "assistant") continue;
    const contentText = extractMessageTextContent(message?.content ?? "");
    if (String(contentText || "").trim()) continue;
    const toolCalls = getMessageToolCalls(message);
    if (!toolCalls.length) continue;
    const toolCallIds = toolCalls
      .filter((toolCall) => resolveToolName(toolCall) !== TASK_SUMMARY_TOOL_NAME)
      .map((toolCall) => resolveToolCallId(toolCall))
      .filter(Boolean);
    if (!toolCallIds.length) continue;
    const toolResultIndexes = [];
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const maybeToolResult = messages[cursor];
      if (!maybeToolResult || typeof maybeToolResult !== "object") continue;
      if (isMessageSummarized(maybeToolResult)) continue;
      if (getMessageRole(maybeToolResult) !== "tool") continue;
      const toolCallId = resolveToolCallIdFromToolMessage(maybeToolResult);
      if (!toolCallId || !toolCallIds.includes(toolCallId)) continue;
      const toolName = String(
        maybeToolResult?.toolName || maybeToolResult?.tool_name || "",
      ).trim();
      if (toolName === TASK_SUMMARY_TOOL_NAME) continue;
      toolResultIndexes.push(cursor);
    }
    if (!toolResultIndexes.length) continue;
    if (setMessageSummarized(message)) discardedMessages += 1;
    for (const toolIndex of toolResultIndexes) {
      if (setMessageSummarized(messages[toolIndex])) discardedMessages += 1;
    }
    charsAfter = resolveUnsummarizedMessageChars(messages);
  }
  return { discardedMessages, charsAfter };
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
    // Backward compatibility for phase-summary prompts created before the
    // internal marker existed.
    const content = String(message?.content || "").trim();
    if (content !== phaseSummaryPrompt) continue;
    messages.splice(index, 1);
    removedCount += 1;
  }
  return removedCount;
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
  const unsummarizedChars = resolveUnsummarizedMessageChars(loopState?.messages || []);
  const reachedCharsThreshold = Number.isFinite(charsThreshold) &&
    charsThreshold > 0 &&
    unsummarizedChars > charsThreshold;
  if (!reachedLoopThreshold && !reachedCharsThreshold) {
    systemRuntime.phaseSummaryByCharsPrompted = false;
    return false;
  }

  const pruneEnabled = PHASE_SUMMARY_OVERFLOW_POLICY.ENABLE_PRUNE_AFTER_SUMMARY === true;
  const pruneTriggerRounds = Number(
    PHASE_SUMMARY_OVERFLOW_POLICY.PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS || 1,
  );
  const canPruneAfterSummary =
    systemRuntime.phaseSummaryByCharsPrompted === true && pruneTriggerRounds <= 1;
  if (reachedCharsThreshold && pruneEnabled && canPruneAfterSummary) {
    const pruneResult = discardOldestToolCallPairs(
      loopState?.messages || [],
      charsThreshold,
    );
    const stillOverflow = pruneResult.charsAfter > charsThreshold;
    if (stillOverflow) {
      if (PHASE_SUMMARY_OVERFLOW_POLICY.ENFORCE_NO_TOOLS_WHEN_STILL_OVERFLOW === true) {
        systemRuntime.phaseSummaryNoToolsNextTurn = true;
      }
      emitEvent(modelState?.eventListener || null, "phase_summary_hard_overflow", {
        loopCount: nextCount,
        charsThreshold,
        unsummarizedChars: pruneResult.charsAfter,
        discardedMessages: pruneResult.discardedMessages,
      });
      return pruneResult.discardedMessages > 0;
    }
    systemRuntime.phaseSummaryByCharsPrompted = false;
    emitEvent(modelState?.eventListener || null, "phase_summary_messages_pruned", {
      loopCount: nextCount,
      charsThreshold,
      unsummarizedCharsBefore: unsummarizedChars,
      unsummarizedCharsAfter: pruneResult.charsAfter,
      discardedMessages: pruneResult.discardedMessages,
    });
    return pruneResult.discardedMessages > 0;
  }

  systemRuntime.needsPhaseSummary = true;
  systemRuntime.phaseSummaryLoopCount = 0;
  if (reachedCharsThreshold) {
    systemRuntime.phaseSummaryByCharsPrompted = true;
  }
  appendMessage(loopState, new HumanMessage({
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

// ── Help Tool Prompts ──

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
  appendMessage(loopState, new SystemMessage({
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
  appendMessage(loopState, new HumanMessage({
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
