/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  normalizeToolCalls,
  registerToolCallStreamingMismatch,
  resolveRetryInvokeLlm,
  shouldRetryToolCallStreamingMismatch,
} from "../../../model/index.js";
import { normalizeAiTextContent } from "../llm-invoker.js";

export function normalizeToolTurnAi(ai) {
  const { rawCalls, calls } = normalizeToolCalls(ai);
  const aiContentText = normalizeAiTextContent(ai?.content, {
    additionalKwargs: ai?.additional_kwargs ?? null,
    allowReasoningFallback: false,
  });
  return { rawCalls, calls, aiContentText };
}

export async function maybeRetryToolCallStreamingMismatch({
  ai,
  calls,
  modelState,
  invokeBoundLlmWithToolChoice,
} = {}) {
  if (!shouldRetryToolCallStreamingMismatch({ ai, calls })) {
    return null;
  }
  const reason = "finish_reason_tool_calls_but_no_calls_detected";
  registerToolCallStreamingMismatch(modelState, {
    mode: "with_tools",
    reason,
  });
  const retryLlm = resolveRetryInvokeLlm(modelState, {
    mode: "with_tools",
    reason,
  });
  const retryAi = await invokeBoundLlmWithToolChoice(
    "",
    retryLlm,
    "with_tools_non_streaming_retry",
  );
  return {
    ai: retryAi,
    ...normalizeToolTurnAi(retryAi),
  };
}
