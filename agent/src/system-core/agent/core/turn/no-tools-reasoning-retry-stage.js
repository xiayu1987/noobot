/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "../../../context/session/message-context-policy.js";
import { emitEvent } from "../../../event/index.js";
import {
  extractAiReasoningText,
  invokeLlmWithTransientRetry,
  normalizeAiTextContent,
} from "../llm-invoker.js";
import { resolveNonThinkingCallOverrides } from "./tool-choice-strategy.js";
import { buildReasoningRetrySystemMessage } from "./turn-stage.js";

export async function maybeRetryReasoningOnlyNoTools({
  modelResponse,
  responseContentText = "",
  messages = [],
  invokeLlm,
  modelState,
  runtime,
  abortSignal,
  forceToolChoiceNone = false,
  eventListener,
  turn,
  locale = "zh-CN",
} = {}) {
  const reasoningText = extractAiReasoningText(modelResponse);
  if (responseContentText || !reasoningText) {
    return null;
  }

  emitEvent(eventListener, "llm_reasoning_only_retry_scheduled", {
    turn,
    mode: "no_tools",
    reasoningChars: reasoningText.length,
  });
  messages.push({
    role: "system",
    content: buildReasoningRetrySystemMessage(reasoningText, locale),
  });

  const retryAi = await invokeLlmWithTransientRetry({
    modelState,
    turn,
    mode: "no_tools_reasoning_retry",
    invoke: ({ callbacks }) =>
      invokeLlm.invoke(filterForModelContext(messages), {
        callbacks,
        signal: abortSignal,
        ...(forceToolChoiceNone ? { tool_choice: "none" } : {}),
        ...resolveNonThinkingCallOverrides(
          runtime,
          forceToolChoiceNone ? "none" : "",
          modelState?.defaultModelSpec || {},
        ),
      }),
  });

  return {
    modelResponse: retryAi,
    responseContentText: normalizeAiTextContent(retryAi?.content, {
      additionalKwargs: retryAi?.additional_kwargs ?? null,
      allowReasoningFallback: false,
    }),
  };
}
