/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { GUIDANCE_REASON, TOOL_NAME_SET, ensureHarnessBucket } from "./deps.js";
import { resolveSummaryScope } from "@noobot/context-protocol/policy/summary";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { resolveModelMessageBlocks } from "../../../core/message-store.js";
import {
  resolveContextMessageKey,
  resolveContextSessionMessageUid,
} from "@noobot/context-protocol/message/codec";
import { text, isObjectLike } from "@noobot/shared/value";

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

export function captureGuidanceSummaryCheckpoint(ctx = {}, state = {}) {
  if (!isObjectLike(state)) return [];
  const blocks = resolveSummaryMarkBlocks(ctx);
  const summaryScope = resolveSummaryScope(blocks);
  const messageKeys = [...new Set(summaryScope.checkpointMessages.map(resolveContextMessageKey))];
  state.pending = state.pending && typeof state.pending === "object" ? state.pending : {};
  state.pending.summaryCheckpointMessageKeys = messageKeys;
  return messageKeys;
}

export async function markGuidanceSummarizedMessages(ctx = {}, meta = {}) {
  void meta;
  const holder = ensureHarnessBucket(ctx);
  const summaryCheckpointMessageKeys = holder.state.pending.summaryCheckpointMessageKeys;

  const blocks = resolveSummaryMarkBlocks(ctx);
  const summaryScope = resolveSummaryScope(blocks, {
    messageKeys: summaryCheckpointMessageKeys,
  });
  const summaryTargets = summaryScope.summaryMessages;
  const summarizedMessageUids = [
    ...new Set(summaryTargets.map(resolveContextSessionMessageUid).filter(Boolean)),
  ];
  if (summarizedMessageUids.length) {
    ctx.agentContext.bindings.mainFlowControl.requestSummaryCheckpoint({
      source: "plugin.summary",
      summarizedMessageUids,
    });
  }
  holder.state.pending.summaryCheckpointMessageKeys = null;
  return summaryTargets.length;
}

export function markToolSignals(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const toolName = text(ctx.toolName);
  if (!toolName) return false;
  let changed = false;
  if (ctx?.success === true) {
    state.signals.successfulToolCount += 1;
    if (toolName === TOOL_NAME_SET.MULTIMODAL_PARSE) {
      state.signals.parsedAttachment = true;
      changed = true;
    }
  }
  if (
    ctx?.commitType === "attachments" &&
    Array.isArray(ctx?.payload?.attachments) &&
    ctx.payload.attachments.length
  ) {
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
