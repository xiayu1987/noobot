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

export const FINAL_STREAMING_RESULT_META_KEY = "__noobotFinalStreaming";

export function readFinalStreamingResultMeta(result = {}) {
  if (!result || typeof result !== "object") return null;
  const meta = result[FINAL_STREAMING_RESULT_META_KEY];
  return meta && typeof meta === "object" ? meta : null;
}

function attachFinalStreamingResultMeta(result = {}, finalStreaming = null) {
  if (!result || typeof result !== "object") return result;
  if (!finalStreaming || typeof finalStreaming !== "object") return result;
  const streamedText = String(finalStreaming?.output || finalStreaming?.text || "");
  if (finalStreaming?.streamed !== true || !streamedText) return result;
  Object.defineProperty(result, FINAL_STREAMING_RESULT_META_KEY, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: {
      streamed: true,
      output: streamedText,
      mode: String(finalStreaming?.mode || "").trim(),
    },
  });
  return result;
}

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
  finalStreaming = null,
} = {}) {
  const finalTurnMessages = finalizeTurnMessagesBeforeReturn({
    modelMessages,
    turnMessageStore,
    fallbackMessages: Array.isArray(loopState?.turnMessages) ? loopState.turnMessages : [],
  });
  return attachFinalStreamingResultMeta(
    {
      output,
      traces,
      turnMessages: finalTurnMessages,
      modelMessages: Array.isArray(modelMessages) ? modelMessages : [],
      turnTasks: turnTaskStore
        ? turnTaskStore.toArray()
        : Array.isArray(loopState?.turnTasks)
          ? loopState.turnTasks
          : [],
    },
    finalStreaming,
  );
}
