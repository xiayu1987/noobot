/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../event/index.js";
import { extractAiReasoningText } from "../llm-invoker.js";
import { buildReasoningRetrySystemMessage } from "./turn-stage.js";
import { normalizeToolTurnAi } from "./tool-call-retry-stage.js";

export async function maybeRetryReasoningOnlyWithTools({
  ai,
  calls = [],
  aiContentText = "",
  messages = [],
  invokeBoundLlmWithToolChoice,
  eventListener,
  turn,
  locale = "zh-CN",
} = {}) {
  const reasoningText = extractAiReasoningText(ai);
  if (aiContentText || calls.length || !reasoningText) {
    return null;
  }

  emitEvent(eventListener, "llm_reasoning_only_retry_scheduled", {
    turn,
    mode: "with_tools",
    reasoningChars: reasoningText.length,
  });
  messages.push({
    role: "system",
    content: buildReasoningRetrySystemMessage(reasoningText, locale),
  });

  const retryAi = await invokeBoundLlmWithToolChoice();
  return {
    ai: retryAi,
    ...normalizeToolTurnAi(retryAi),
  };
}
