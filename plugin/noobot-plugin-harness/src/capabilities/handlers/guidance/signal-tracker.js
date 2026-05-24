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
import { FAILURE_THRESHOLD } from "../../../core/thresholds.js";

export async function markGuidanceSummarizedMessages(ctx = {}, meta = {}) {
  const historyMessages = ctx?.agentContext?.payload?.messages?.history;
  const currentMessages = ctx?.messages;
  const injectedSummarizer = resolveInjectedMessageSummarizer(meta);
  const safeMark = async (messages = []) => {
    if (!Array.isArray(messages)) return 0;
    if (typeof injectedSummarizer === "function") {
      try {
        const result = await injectedSummarizer({
          ctx,
          messages,
          taskSummaryToolName: "task_summary",
        });
        const normalized = Number(result);
        if (Number.isFinite(normalized)) return normalized;
      } catch {
        // fallback to local implementation
      }
    }
    return markMessagesSummarized(messages);
  };
  const currentMarked = await safeMark(currentMessages);
  const historyMarked = await safeMark(historyMessages);
  return currentMarked + historyMarked;
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
