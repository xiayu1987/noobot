/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  markCurrentTurnArraySummarized,
  markCurrentTurnModelMessagesSummarized,
  markCurrentTurnStoreSummarized,
} from "../../../context/session/summarized-message-policy.js";
import { TASK_SUMMARY_TOOL_NAME } from "../constants/index.js";

function autoMarkCurrentTurnSummarized({
  turnMessageStore = null,
  fallbackMessages = [],
}) {
  if (turnMessageStore) {
    markCurrentTurnStoreSummarized(turnMessageStore, {
      taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
    });
    return turnMessageStore.toArray();
  }
  return markCurrentTurnArraySummarized(fallbackMessages, {
    taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
  });
}

export function finalizeTurnMessagesBeforeReturn({
  modelMessages = [],
  turnMessageStore = null,
  fallbackMessages = [],
} = {}) {
  markCurrentTurnModelMessagesSummarized(modelMessages, {
    taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
  });
  return autoMarkCurrentTurnSummarized({
    turnMessageStore,
    fallbackMessages,
  });
}

/**
 * Centralized loop result builder.
 */
export function buildLoopResult({
  output,
  traces,
  loopState,
  turnTaskStore = null,
  turnMessageStore = null,
  modelMessages = [],
} = {}) {
  const finalTurnMessages = finalizeTurnMessagesBeforeReturn({
    modelMessages,
    turnMessageStore,
    fallbackMessages: Array.isArray(loopState?.turnMessages) ? loopState.turnMessages : [],
  });
  return {
    output,
    traces,
    turnMessages: finalTurnMessages,
    modelMessages: Array.isArray(modelMessages) ? modelMessages : [],
    turnTasks: turnTaskStore
      ? turnTaskStore.toArray()
      : Array.isArray(loopState?.turnTasks)
        ? loopState.turnTasks
        : [],
  };
}
