/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  markCurrentTurnModelMessagesSummarized,
  markCurrentTurnStoreSummarized,
} from "../../context/session/summarized-message-policy.js";
import {
  DEFAULT_TASK_SUMMARY_TOOL_NAME as TASK_SUMMARY_TOOL_NAME,
} from "@noobot/context-protocol/summary-policy";

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

function requireCanonicalTurnMessageStore(turnMessageStore = null) {
  if (
    !turnMessageStore ||
    typeof turnMessageStore.toArray !== "function" ||
    typeof turnMessageStore.updateWhere !== "function"
  ) {
    throw new Error("turn result requires the canonical currentTurnMessages store");
  }
  return turnMessageStore;
}

export function finalizeTurnMessagesBeforeReturn({
  modelMessages = [],
  turnMessageStore = null,
} = {}) {
  markCurrentTurnModelMessagesSummarized(modelMessages, {
    taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
  });
  const canonicalStore = requireCanonicalTurnMessageStore(turnMessageStore);
  markCurrentTurnStoreSummarized(canonicalStore, {
    taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
  });
  return canonicalStore.toArray();
}

export function buildLoopResult({
  output,
  assistantMessageId = "",
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
  });
  return attachFinalStreamingResultMeta(
    {
      output,
      assistantMessageId: String(assistantMessageId || "").trim(),
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
