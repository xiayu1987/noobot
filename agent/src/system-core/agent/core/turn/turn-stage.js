/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "../../../context/session/message-context-policy.js";
import { mergeConfig, normalizeBooleanLike, resolveRunConfigValue } from "../../../config/index.js";
import { emitEvent } from "../../../event/index.js";
import { createChatModelFromSpec } from "../../../model/index.js";
import { invokeLlmWithTransientRetry, normalizeAiTextContent } from "../llm-invoker.js";
import { resolveNonThinkingCallOverrides } from "./tool-choice-strategy.js";

function shouldUseFinalStreaming(modelState = {}) {
  if (!modelState?.eventListener?.onEvent) return false;
  const runtime = modelState?.runtime || {};
  const runConfig =
    runtime?.runConfig && typeof runtime.runConfig === "object" && !Array.isArray(runtime.runConfig)
      ? runtime.runConfig
      : {};
  const effectiveConfig = mergeConfig(
    modelState?.globalConfig || {},
    modelState?.userConfig || {},
  );
  return resolveRunConfigValue({
    runConfig,
    config: effectiveConfig,
    key: "streaming",
    normalize: (value) => normalizeBooleanLike(value, false),
    fallback: false,
  });
}

function createFinalStreamingLlm(modelState = {}) {
  return createChatModelFromSpec(
    {
      ...(modelState?.defaultModelSpec || {}),
      ...(modelState?.activeModelName
        ? { model: String(modelState.activeModelName || "").trim() }
        : {}),
      ...(modelState?.activeModelAlias
        ? { alias: String(modelState.activeModelAlias || "").trim() }
        : {}),
    },
    {
      streaming: true,
      context: {
        runtime: modelState?.runtime || {},
        agentContext: modelState?.agentContext || null,
        sessionId: String(
          modelState?.runtime?.systemRuntime?.sessionId || modelState?.runtime?.sessionId || "",
        ).trim(),
      },
    },
  );
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
  let streamingLlm = null;
  try {
    streamingLlm = createFinalStreamingLlm(modelState);
  } catch (error) {
    emitEvent(eventListener, "llm_final_stream_create_failed_fallback_non_streaming", {
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

  emitEvent(eventListener, "llm_final_stream_start", { turn, mode });
  try {
    const streamedAi = await invokeLlmWithTransientRetry({
      modelState,
      turn,
      mode,
      invoke: ({ callbacks }) =>
        streamingLlm.invoke(filterForModelContext(baseMessages), {
          callbacks,
          signal: abortSignal,
          ...resolveNonThinkingCallOverrides(
            runtime,
            "none",
            modelState?.defaultModelSpec || {},
          ),
        }),
    });
    const streamedText = normalizeAiTextContent(streamedAi?.content, {
      additionalKwargs: streamedAi?.additional_kwargs ?? null,
      allowReasoningFallback: false,
    });
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

export function buildReasoningRetrySystemMessage(reasoningText = "", locale = "zh-CN") {
  const isEn = String(locale || "").trim().toLowerCase() === "en-us";
  return [
    "<!-- noobot-reasoning-retry -->",
    isEn
      ? "The prior model reasoning is reference-only, not final answer. Return final answer directly."
      : "以下是上次模型返回的思考内容，仅供参考，不代表最终答案。请直接给出最终答案。",
    String(reasoningText || "").trim(),
  ].join("\n");
}
