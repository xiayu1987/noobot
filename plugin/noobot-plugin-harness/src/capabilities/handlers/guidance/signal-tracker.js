/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { GUIDANCE_REASON, TOOL_NAME_SET, ensureHarnessBucket } from "./deps.js";
import { resolveSummaryScope } from "@noobot/context-protocol/policy/summary";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { resolveModelMessageBlocks } from "../../../core/message-store.js";
import { requireHarnessStateField } from "../../../core/bucket-contract.js";
import {
  resolveContextMessageKey,
  resolveContextSessionMessageUid,
} from "@noobot/context-protocol/message/codec";
import { text } from "@noobot/shared/value";

function resolveSummaryMarkBlocks(ctx) {
  const blocks = resolveModelMessageBlocks(ctx);
  return {
    history: blocks.history,
    incremental: blocks.incremental,
  };
}

export function captureGuidanceSummaryCheckpoint(ctx, state) {
  requireHarnessStateField(
    "pending",
    "summaryCheckpointMessageKeys",
    state.pending.summaryCheckpointMessageKeys,
  );
  const blocks = resolveSummaryMarkBlocks(ctx);
  const summaryScope = resolveSummaryScope(blocks);
  const messageKeys = [...new Set(summaryScope.checkpointMessages.map(resolveContextMessageKey))];
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
    if (
      state.counters.consecutiveToolFailures >= TURN_THRESHOLDS.harness.guidance.failureConsecutive
    ) {
      setPendingStateWithMeta(state, "guidance", GUIDANCE_REASON.CONSECUTIVE_FAILURES);
    } else if (
      state.counters.totalToolFailures >= TURN_THRESHOLDS.harness.guidance.failureAccumulated
    ) {
      setPendingStateWithMeta(state, "guidance", GUIDANCE_REASON.ACCUMULATED_FAILURES);
    }
    return true;
  }
  state.counters.consecutiveToolFailures = 0;
  return true;
}
