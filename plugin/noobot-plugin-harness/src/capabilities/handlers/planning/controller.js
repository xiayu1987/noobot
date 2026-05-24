/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureTaskAcceptanceTool } from "../acceptance.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
  LLM_SUMMARY_OVERFLOW_POLICY,
  LLM_SUMMARY_THRESHOLD,
} from "../../../core/thresholds.js";
import {
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  extractRawTextContent,
  sanitizeInternalMessages,
  shouldUseSeparateModel,
} from "./deps.js";
import { ensurePlanRefinementTool } from "./tool-injector.js";
import { maybeInjectPlanningPrompt } from "./prompt-builder.js";
import { maybeCapturePlanningResult, runPlanningBySeparateModel } from "./capture-runner.js";

function isMessageSummarized(message = {}) {
  return message?.summarized === true || message?.lc_kwargs?.summarized === true;
}

function resolveUnsummarizedMessageChars(messages = []) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, message) => {
    if (!message || typeof message !== "object") return total;
    if (isMessageSummarized(message)) return total;
    const content = extractRawTextContent(message?.content ?? message);
    return total + String(content || "").length;
  }, 0);
}

const TASK_SUMMARY_TOOL_NAME = "task_summary";

function getMessageToolCalls(messageItem = {}) {
  if (Array.isArray(messageItem?.tool_calls)) return messageItem.tool_calls;
  if (Array.isArray(messageItem?.lc_kwargs?.tool_calls)) return messageItem.lc_kwargs.tool_calls;
  if (Array.isArray(messageItem?.additional_kwargs?.tool_calls)) return messageItem.additional_kwargs.tool_calls;
  return [];
}

function resolveToolNameFromToolCall(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return String(fn.name || "").trim();
}

function resolveToolCallId(toolCall = {}) {
  return String(toolCall?.id ?? toolCall?.tool_call_id ?? toolCall?.toolCallId ?? "").trim();
}

function resolveToolCallIdFromToolMessage(messageItem = {}) {
  return String(
    messageItem?.tool_call_id ??
      messageItem?.toolCallId ??
      messageItem?.lc_kwargs?.tool_call_id ??
      "",
  ).trim();
}

function setMessageSummarized(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem.summarized === true && messageItem?.lc_kwargs?.summarized === true) return false;
  messageItem.summarized = true;
  if (messageItem?.lc_kwargs && typeof messageItem.lc_kwargs === "object") {
    messageItem.lc_kwargs.summarized = true;
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
    const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
    if (role !== "assistant") continue;
    const contentText = extractRawTextContent(message?.content ?? "");
    if (String(contentText || "").trim()) continue;
    const toolCalls = getMessageToolCalls(message);
    if (!toolCalls.length) continue;

    const toolCallIds = toolCalls
      .filter((toolCall) => resolveToolNameFromToolCall(toolCall) !== TASK_SUMMARY_TOOL_NAME)
      .map((toolCall) => resolveToolCallId(toolCall))
      .filter(Boolean);
    if (!toolCallIds.length) continue;

    const toolResultIndexes = [];
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const maybeToolResult = messages[cursor];
      if (!maybeToolResult || typeof maybeToolResult !== "object") continue;
      if (isMessageSummarized(maybeToolResult)) continue;
      const resultRole = String(
        maybeToolResult?.role || maybeToolResult?.lc_kwargs?.role || "",
      ).trim().toLowerCase();
      if (resultRole !== "tool") continue;
      const toolCallId = resolveToolCallIdFromToolMessage(maybeToolResult);
      if (!toolCallId || !toolCallIds.includes(toolCallId)) continue;
      const explicitToolName = String(
        maybeToolResult?.toolName || maybeToolResult?.tool_name || "",
      ).trim();
      if (explicitToolName === TASK_SUMMARY_TOOL_NAME) continue;
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

export function createPlanningHandler({ shouldProcessPrimaryToolHooks = () => true } = {}) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (
      ["before_llm_call", "after_llm_call", "before_final_output"].includes(point) &&
      !shouldProcessPrimaryToolHooks(ctx)
    ) {
      return { capability, point, status: "active", changed: false };
    }
    if (point === "before_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      if (holder) {
        holder.state.counters.llmTurns += 1;
        let currentChars = resolveUnsummarizedMessageChars(ctx?.messages);
        const reachedTurnsSummary = holder.state.counters.llmTurns > LLM_SUMMARY_THRESHOLD;
        let reachedCharsSummary = currentChars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD;

        const pruneEnabled = LLM_SUMMARY_OVERFLOW_POLICY.ENABLE_PRUNE_AFTER_SUMMARY === true;
        const pruneTriggerRounds = Number(
          LLM_SUMMARY_OVERFLOW_POLICY.PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS || 1,
        );
        const canPruneAfterSummary =
          holder.state.flags.summaryByCharsPrompted === true && pruneTriggerRounds <= 1;
        if (reachedCharsSummary && pruneEnabled && canPruneAfterSummary) {
          const pruneResult = discardOldestToolCallPairs(
            ctx?.messages,
            LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
          );
          changed = pruneResult.discardedMessages > 0 || changed;
          currentChars = pruneResult.charsAfter;
          reachedCharsSummary = currentChars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD;
          if (
            reachedCharsSummary &&
            LLM_SUMMARY_OVERFLOW_POLICY.FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW === true
          ) {
            holder.state.flags.overflowForceAcceptancePending = true;
          } else {
            holder.state.flags.overflowForceAcceptancePending = false;
            holder.state.flags.summaryByCharsPrompted = false;
          }
        } else if (holder.state.flags.overflowForceAcceptancePending !== true) {
          holder.state.flags.overflowForceAcceptancePending = false;
        }

        if (reachedTurnsSummary || reachedCharsSummary) {
          setPendingStateWithMeta(holder.state, "summary", true);
          if (reachedCharsSummary) {
            holder.state.flags.summaryByCharsPrompted = true;
          }
        } else {
          holder.state.flags.summaryByCharsPrompted = false;
          holder.state.flags.overflowForceAcceptancePending = false;
        }
      }
      changed = sanitizeInternalMessages(ctx) || changed;
      changed = disableBlockedToolsInRegistry(ctx) || changed;
      changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
      changed = ensurePlanRefinementTool(ctx, meta) || changed;
      if (shouldUseSeparateModel(meta)) {
        changed = (await runPlanningBySeparateModel(ctx, meta)) || changed;
      } else {
        changed = maybeInjectPlanningPrompt(ctx, meta) || changed;
      }
    }
    if (point === "after_llm_call") {
      changed = (await maybeCapturePlanningResult(ctx, meta)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}
