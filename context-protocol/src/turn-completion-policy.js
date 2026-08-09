/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  DEFAULT_TASK_CHECK_TOOL_NAME,
  DEFAULT_TASK_SUMMARY_TOOL_NAME,
  markCurrentTurnModelMessagesSummarized,
  markCurrentTurnStoreSummarized,
} from "./summary-policy.js";

/**
 * Applies the terminal policy for a complete dialog turn.
 *
 * This is distinct from a summary checkpoint: completion is the lifecycle
 * boundary that marks all eligible messages not covered by the latest
 * checkpoint artifacts, then persists the same decision in the canonical
 * current-turn store.
 */
export function applyTurnCompletionPolicy({
  modelMessages = [],
  turnMessageStore = null,
  taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME,
  taskCheckToolName = DEFAULT_TASK_CHECK_TOOL_NAME,
  policyOptions = {},
} = {}) {
  markCurrentTurnModelMessagesSummarized(modelMessages, {
    taskSummaryToolName,
    taskCheckToolName,
    policyOptions,
  });
  if (!turnMessageStore || typeof turnMessageStore.updateWhere !== "function") {
    throw new Error("turn completion policy requires the canonical turn message store");
  }
  const markedCount = markCurrentTurnStoreSummarized(turnMessageStore, {
    taskSummaryToolName,
    taskCheckToolName,
    policyOptions,
  });
  return {
    markedCount,
    messages: typeof turnMessageStore.toArray === "function"
      ? turnMessageStore.toArray()
      : [],
  };
}
