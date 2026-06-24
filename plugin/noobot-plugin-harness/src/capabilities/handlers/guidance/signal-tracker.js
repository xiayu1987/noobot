/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  GUIDANCE_REASON,
  TOOL_NAME_SET,
  ensureHarnessBucket,
  markMessagesSummarized,
  resolveInjectedMessageSummarizer,
} from "./deps.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";

const FAILURE_THRESHOLD = Object.freeze({
  CONSECUTIVE: WORKFLOW_PARAMS.guidance.failureThreshold.consecutive,
  ACCUMULATED: WORKFLOW_PARAMS.guidance.failureThreshold.accumulated,
});

function resolveMessageBlockMarkSource(ctx = {}) {
  const blocks = ctx?.messageBlocks && typeof ctx.messageBlocks === "object" && !Array.isArray(ctx.messageBlocks)
    ? ctx.messageBlocks
    : null;
  if (!blocks) return [];
  return [
    ...(Array.isArray(blocks.system) ? blocks.system : []),
    ...(Array.isArray(blocks.history) ? blocks.history : []),
    ...(Array.isArray(blocks.incremental) ? blocks.incremental : []),
  ];
}

function readMessageField(message = {}, field = "") {
  return String(
    message?.[field] ||
      message?.additional_kwargs?.[field] ||
      message?.lc_kwargs?.[field] ||
      message?.lc_kwargs?.additional_kwargs?.[field] ||
      "",
  ).trim();
}

function resolveMessageRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role) return role;
  const type = String(message?.type || message?.lc_kwargs?.type || "").trim().toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function resolveMessageContent(message = {}) {
  return String(message?.content ?? message?.lc_kwargs?.content ?? "");
}

function resolveMessageToolCallId(message = {}) {
  return String(
    message?.tool_call_id ||
      message?.toolCallId ||
      message?.lc_kwargs?.tool_call_id ||
      message?.lc_kwargs?.toolCallId ||
      "",
  ).trim();
}

function resolveMessageAssistantToolCallIds(message = {}) {
  const calls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.lc_kwargs?.tool_calls)
      ? message.lc_kwargs.tool_calls
      : Array.isArray(message?.additional_kwargs?.tool_calls)
        ? message.additional_kwargs.tool_calls
        : [];
  return calls
    .map((call = {}) => String(call?.id || call?.tool_call_id || call?.toolCallId || "").trim())
    .filter(Boolean)
    .join(",");
}

function buildMessageMarkKey(message = {}) {
  return [
    resolveMessageRole(message),
    resolveMessageToolCallId(message),
    resolveMessageAssistantToolCallIds(message),
    readMessageField(message, "injectedMessageType") || readMessageField(message, "injected_message_type"),
    readMessageField(message, "dialogProcessId"),
    readMessageField(message, "turnScopeId"),
    resolveMessageContent(message),
  ].join("|||");
}

function resolveScopedMessageBlockMarkSource(ctx = {}, scopedMessages = []) {
  const blockMessages = resolveMessageBlockMarkSource(ctx);
  if (!blockMessages.length) return [];
  const scopedKeys = new Set(
    (Array.isArray(scopedMessages) ? scopedMessages : [])
      .map((message) => buildMessageMarkKey(message))
      .filter(Boolean),
  );
  if (!scopedKeys.size) return blockMessages;
  return blockMessages.filter((message) => scopedKeys.has(buildMessageMarkKey(message)));
}

export async function markGuidanceSummarizedMessages(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  const summaryCheckpointMessageCountValue =
    holder?.state?.pending?.summaryCheckpointMessageCount;
  const summaryCheckpointMessageCountRaw = Number(summaryCheckpointMessageCountValue);
  const hasSummaryCheckpoint = Number.isFinite(summaryCheckpointMessageCountRaw);
  const hasUsableSummaryCheckpoint =
    summaryCheckpointMessageCountValue !== null &&
    summaryCheckpointMessageCountValue !== undefined &&
    hasSummaryCheckpoint;
  const summaryCheckpointMessageCount = hasSummaryCheckpoint
    ? Math.max(0, Math.trunc(summaryCheckpointMessageCountRaw))
    : null;

  const historyMessages = ctx?.agentContext?.payload?.messages?.history;
  const currentMessages = ctx?.messages;
  const injectedSummarizer = resolveInjectedMessageSummarizer(meta);
  const scopedCurrentMessages = hasUsableSummaryCheckpoint && Array.isArray(currentMessages)
    ? currentMessages.slice(0, Math.min(currentMessages.length, summaryCheckpointMessageCount))
    : currentMessages;
  const safeMark = async (messages = []) => {
    if (!Array.isArray(messages)) return 0;

    const scopedMessages = hasUsableSummaryCheckpoint
      ? messages.slice(0, Math.min(messages.length, summaryCheckpointMessageCount))
      : messages;
    if (!Array.isArray(scopedMessages) || !scopedMessages.length) return 0;

    if (typeof injectedSummarizer === "function") {
      try {
        const result = await injectedSummarizer({
          ctx,
          messages: scopedMessages,
          taskSummaryToolName: "task_summary",
          ...(hasUsableSummaryCheckpoint
            ? {
                summaryScope: {
                  maxMessages: summaryCheckpointMessageCount,
                  limitToProvidedMessagesOnly: true,
                },
              }
            : {}),
        });
        const normalized = Number(result);
        if (Number.isFinite(normalized)) return normalized;
      } catch {
        // fallback to local implementation
      }
    }
    return markMessagesSummarized(scopedMessages);
  };
  const currentMarked = await safeMark(currentMessages);
  const historyMarked = await safeMark(historyMessages);
  const blockMarked = await safeMark(
    hasUsableSummaryCheckpoint
      ? resolveScopedMessageBlockMarkSource(ctx, scopedCurrentMessages)
      : resolveMessageBlockMarkSource(ctx),
  );
  if (holder?.state?.pending && hasUsableSummaryCheckpoint) {
    holder.state.pending.summaryCheckpointMessageCount = null;
  }
  return currentMarked + historyMarked + blockMarked;
}

export function markToolSignals(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const toolName = String(ctx?.toolName || ctx?.call?.name || "").trim();
  if (!toolName) return false;
  let changed = false;
  if (ctx?.success === true) {
    state.signals.successfulToolCount += 1;
    if (
      [
        TOOL_NAME_SET.MEDIA_TO_DATA,
        TOOL_NAME_SET.DOC_TO_DATA,
        TOOL_NAME_SET.WEB_TO_DATA,
        TOOL_NAME_SET.PROCESS_CONTENT_TASK,
      ].includes(toolName)
    ) {
      state.signals.parsedAttachment = true;
      changed = true;
    }
    if ([TOOL_NAME_SET.DELEGATE_TASK_ASYNC, TOOL_NAME_SET.PLAN_MULTI_TASK_COLLABORATION].includes(toolName)) {
      state.signals.subtaskStarted = true;
      changed = true;
    }
    if (toolName === TOOL_NAME_SET.WAIT_ASYNC_TASK_RESULT) {
      state.signals.subtaskWaited = true;
      changed = true;
    }
  }
  if (ctx?.commitType === "attachment_metas" && Array.isArray(ctx?.payload?.attachmentMetas) && ctx.payload.attachmentMetas.length) {
    state.signals.parsedAttachment = true;
    changed = true;
  }
  return changed;
}

export function updateFailureCounters(ctx = {}, failed = false) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (failed) {
    state.counters.consecutiveToolFailures += 1;
    state.counters.totalToolFailures += 1;
    if (state.counters.consecutiveToolFailures >= FAILURE_THRESHOLD.CONSECUTIVE) {
      setPendingStateWithMeta(state, "guidance", GUIDANCE_REASON.CONSECUTIVE_FAILURES);
    } else if (state.counters.totalToolFailures >= FAILURE_THRESHOLD.ACCUMULATED) {
      setPendingStateWithMeta(state, "guidance", GUIDANCE_REASON.ACCUMULATED_FAILURES);
    }
    return true;
  }
  state.counters.consecutiveToolFailures = 0;
  return true;
}
