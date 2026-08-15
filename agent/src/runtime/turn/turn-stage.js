/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "@noobot/context-protocol/message-policy";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { mergeConfig, normalizeBooleanLike, resolveRunConfigValue } from "../../config/index.js";
import { emitEvent } from "../../events/index.js";
import { createStreamingCallbacks } from "../../models/runtime/model-manager.js";
import { resolveNonThinkingCallOverrides } from "./tool-choice-strategy.js";

function shouldUseFinalStreaming(modelState = {}) {
  if (!modelState?.eventListener?.onEvent) return false;
  const runtime = modelState?.runtime || {};
  const runConfig =
    runtime?.runConfig && typeof runtime.runConfig === "object" && !Array.isArray(runtime.runConfig)
      ? runtime.runConfig
      : {};
  const effectiveConfig = mergeConfig(modelState?.globalConfig || {}, modelState?.userConfig || {});
  return resolveRunConfigValue({
    runConfig,
    config: effectiveConfig,
    key: "streaming",
    normalize: (value) => normalizeBooleanLike(value, false),
    fallback: false,
  });
}
export async function maybeInvokeFinalStreamingNoTools({
  modelState,
  baseMessages = [],
  fallbackAi = null,
  fallbackText = "",
  turn,
  mode = "final_stream_no_tools",
} = {}) {
  if (!shouldUseFinalStreaming(modelState)) {
    return {
      ai: fallbackAi,
      text: String(fallbackText || ""),
      streamed: false,
    };
  }

  const { eventListener, runtime, abortSignal } = modelState;
  emitEvent(eventListener, "llm_final_stream_start", { turn, mode });
  try {
    const modelMessages = filterForModelContext(baseMessages);
    const streamedResponse = await modelState.modelPort.invoke({
      messages: modelMessages,
      options: {
        streaming: true,
        callbacks: createStreamingCallbacks(eventListener, runtime),
        signal: abortSignal,
        invoke: {
          ...resolveNonThinkingCallOverrides(runtime, "none", modelState?.defaultModelSpec || {}),
        },
      },
      invocation: {
        flow: "agent.main",
        purpose: mode,
        domain: "primary",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
      },
    });
    const streamedAi = streamedResponse.output;
    const streamedText = String(streamedAi.text || "");
    emitEvent(eventListener, "llm_final_stream_end", {
      turn,
      mode,
      textChars: streamedText.length,
    });
    return {
      ai: streamedAi,
      text: streamedText || String(fallbackText || ""),
      streamed: true,
      mode,
    };
  } catch (error) {
    emitEvent(eventListener, "llm_final_stream_failed_fallback_non_streaming", {
      turn,
      mode,
      error: error?.message || String(error),
    });
    return {
      ai: fallbackAi,
      text: String(fallbackText || ""),
      streamed: false,
    };
  }
}
