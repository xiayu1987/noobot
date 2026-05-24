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
  HELP_TOOL_LOOP_PROMPT_MARKER,
  HELP_TOOL_FAILURE_PROMPT_MARKER,
  TASK_SUMMARY_TOOL_NAME,
} from "./constants/index.js";
import { REQUEST_HELP_TOOL_NAME } from "../../tools/workflow/request-help-tool.js";

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

function extractRawTextContent(content = null) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.text === "string") {
        return item.text;
      }
      return "";
    })
    .join("\n")
    .trim();
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
    const text = extractRawTextContent(message?.content ?? message);
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
  if (!reachedLoopThreshold && !reachedCharsThreshold) return false;

  systemRuntime.needsPhaseSummary = true;
  systemRuntime.phaseSummaryLoopCount = 0;
  if (Array.isArray(loopState?.messages)) {
    loopState.messages.push(
      new HumanMessage({
        content: tEngine(runtime, "phaseSummaryPrompt"),
        additional_kwargs: {
          noobotInternalMessageType: PHASE_SUMMARY_PROMPT_MARKER,
        },
      }),
    );
  }
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
  if (Array.isArray(loopState?.messages)) {
    loopState.messages.push(
      new SystemMessage({
        content: tEngine(runtime, "helpToolLoopPrompt", {
          loopCount: nextCount,
          threshold,
          helpToolName: REQUEST_HELP_TOOL_NAME,
        }),
        additional_kwargs: {
          noobotInternalMessageType: HELP_TOOL_LOOP_PROMPT_MARKER,
        },
      }),
    );
  }
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
  if (Array.isArray(loopState?.messages)) {
    loopState.messages.push(
      new HumanMessage({
        content: tEngine(runtime, "toolConsecutiveFailureHelpPrompt", {
          failureCount,
          threshold,
          helpToolName: REQUEST_HELP_TOOL_NAME,
        }),
        additional_kwargs: {
          noobotInternalMessageType: HELP_TOOL_FAILURE_PROMPT_MARKER,
        },
      }),
    );
  }
  loopState.toolConsecutiveFailureCount = 0;
  systemRuntime.toolConsecutiveFailureCount = 0;
  emitEvent(modelState?.eventListener || null, "help_tool_failure_prompted", {
    failureCount,
    threshold,
  });
  return true;
}
