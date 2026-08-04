/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { extractAiReasoningText } from "../llm-invoker.js";
import { appendMessage } from "@noobot/context-protocol/message-store";
import { buildReasoningRetrySystemMessage } from "./turn-stage.js";
import { normalizeToolTurnAi } from "./tool-call-retry-stage.js";

export async function maybeRetryReasoningOnlyWithTools({
  ai,
  calls = [],
  aiContentText = "",
  messages = [],
  messageHolder = null,
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
  const retryMessage = {
    role: "system",
    content: buildReasoningRetrySystemMessage(reasoningText, locale),
  };
  if (messageHolder && typeof messageHolder === "object") {
    appendMessage(messageHolder, retryMessage, { block: "incremental" });
  } else {
    messages.push(retryMessage);
  }

  const retryAi = await invokeBoundLlmWithToolChoice();
  return {
    ai: retryAi,
    ...normalizeToolTurnAi(retryAi),
  };
}
