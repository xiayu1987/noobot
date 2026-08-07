/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  GUIDANCE_REASON,
  TOOL_NAME_SET,
  ensureHarnessBucket,
} from "./deps.js";
import { collectClosedToolCallBatchMessages, collectDialogScopedMessagesToSummarize } from "@noobot/context-protocol/summary-policy";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  getMessageId,
  resolveMessagesByIds,
  resolveModelMessageBlocks,
} from "../../../core/message-store.js";
import { requestSummaryCheckpointMainFlowInstruction } from "../shared/runtime/main-flow-control-instruction.js";

const FAILURE_THRESHOLD = Object.freeze({
  CONSECUTIVE: WORKFLOW_PARAMS.guidance.failureThreshold.consecutive,
  ACCUMULATED: WORKFLOW_PARAMS.guidance.failureThreshold.accumulated,
});

function resolveSummaryMarkBlocks(ctx = {}) {
  const blocks = resolveModelMessageBlocks(ctx);
  return {
    history: Array.isArray(blocks.history) ? blocks.history : [],
    incremental: Array.isArray(blocks.incremental) ? blocks.incremental : [],
  };
}

function assertSummaryHistoryClosed(history = []) {
  const pendingHistoryMessages = collectDialogScopedMessagesToSummarize(history, {
    maxMessages: history.length,
    limitToProvidedMessagesOnly: true,
    retentionMessages: history,
    taskSummaryToolName: "task_summary",
  });
  if (!pendingHistoryMessages.length) return;
  const messageIds = pendingHistoryMessages
    .map((message) => getMessageId(message))
    .filter(Boolean);
  const error = new Error("summary checkpoint history contains messages pending summarization");
  error.pendingHistoryMessageIds = messageIds;
  throw error;
}

export function captureGuidanceSummaryCheckpoint(ctx = {}, state = {}) {
  if (!state || typeof state !== "object") return [];
  const blocks = resolveSummaryMarkBlocks(ctx);
  assertSummaryHistoryClosed(blocks.history);
  const sourceMessages = blocks.incremental;
  const checkpointMessages = collectClosedToolCallBatchMessages(sourceMessages);
  const messageIds = [...new Set(
    checkpointMessages.map((message) => getMessageId(message)).filter(Boolean),
  )];
  state.pending = state.pending && typeof state.pending === "object"
    ? state.pending
    : {};
  state.pending.summaryCheckpointMessageIds = messageIds;
  return messageIds;
}

export async function markGuidanceSummarizedMessages(ctx = {}, meta = {}) {
  void meta;
  const holder = ensureHarnessBucket(ctx);
  const summaryCheckpointMessageIdsValue =
    holder?.state?.pending?.summaryCheckpointMessageIds;
  const summaryCheckpointMessageIds = Array.isArray(summaryCheckpointMessageIdsValue)
    ? summaryCheckpointMessageIdsValue.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const hasSummaryCheckpoint = Array.isArray(summaryCheckpointMessageIdsValue);

  const blocks = resolveSummaryMarkBlocks(ctx);
  assertSummaryHistoryClosed(blocks.history);
  const coveredMessages = blocks.incremental;
  const scopedCurrentMessages = hasSummaryCheckpoint
    ? resolveMessagesByIds(ctx, summaryCheckpointMessageIds)
    : coveredMessages;
  const scopedSet = new Set(scopedCurrentMessages);
  const checkpointTargets = coveredMessages.filter((message) => scopedSet.has(message));
  const summaryTargets = collectDialogScopedMessagesToSummarize(checkpointTargets, {
    maxMessages: checkpointTargets.length,
    limitToProvidedMessagesOnly: true,
    retentionMessages: coveredMessages,
    taskSummaryToolName: "task_summary",
  });
  requestSummaryCheckpointMainFlowInstruction(ctx, {
    source: "plugin.summary",
    summarizedMessageIds: [...new Set(
      summaryTargets
        .map((message) => getMessageId(message))
        .filter(Boolean),
    )],
  });
  if (holder?.state?.pending && hasSummaryCheckpoint) {
    holder.state.pending.summaryCheckpointMessageIds = null;
  }
  return summaryTargets.length;
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
  if (ctx?.commitType === "attachments" && Array.isArray(ctx?.payload?.attachments) && ctx.payload.attachments.length) {
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
