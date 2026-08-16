/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  DEFAULT_TASK_CHECK_TOOL_NAME,
  DEFAULT_TASK_SUMMARY_TOOL_NAME,
  markCurrentTurnArraySummarized,
  markCurrentTurnStoreSummarized,
  mirrorSummarizedMessagesById,
} from "./summary-policy.js";
import { resolveMessageId } from "./message-policy.js";

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
  if (!turnMessageStore || typeof turnMessageStore.updateWhere !== "function") {
    throw new Error("turn completion policy requires the canonical turn message store");
  }
  // The canonical turn store is the sole decision source. Mirror its exact
  // UID decisions to provider objects instead of classifying a second snapshot.
  const markedMessageIds = new Set();
  const markedCount = markCurrentTurnStoreSummarized(turnMessageStore, {
    taskSummaryToolName,
    taskCheckToolName,
    policyOptions,
    onMarked: (message) => {
      const id = resolveMessageId(message);
      if (id) markedMessageIds.add(id);
    },
  });
  mirrorSummarizedMessagesById(modelMessages, markedMessageIds);
  return {
    markedCount,
    messages: typeof turnMessageStore.toArray === "function"
      ? turnMessageStore.toArray()
      : [],
  };
}

export function projectTurnCompletionMessages(
  messages = [],
  {
    taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME,
    taskCheckToolName = DEFAULT_TASK_CHECK_TOOL_NAME,
    policyOptions = {},
  } = {},
) {
  return markCurrentTurnArraySummarized(messages, {
    taskSummaryToolName,
    taskCheckToolName,
    policyOptions,
  });
}
