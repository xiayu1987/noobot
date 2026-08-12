/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "@noobot/context-protocol/message-policy";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import {
  resolveBoundToolModelRequestOverrides,
  resolveNonThinkingCallOverrides,
} from "./tool-choice-strategy.js";

export function createBoundLlmToolChoiceInvoker({
  adaptedBinding,
  boundTools,
  messages,
  modelState,
  runtime,
  abortSignal,
}) {
  return async function invokeBoundLlmWithToolChoice(
    toolChoiceOverride = "",
    _llmOverride = null,
    invokeMode = "with_tools",
  ) {
    const baseBindOptions =
      adaptedBinding?.bindOptions && typeof adaptedBinding.bindOptions === "object"
        ? adaptedBinding.bindOptions
        : {};
    const effectiveToolChoice = String(
      toolChoiceOverride || baseBindOptions.tool_choice || "",
    ).trim();
    const effectiveBindOptions = {
      ...baseBindOptions,
      ...(effectiveToolChoice ? { tool_choice: effectiveToolChoice } : {}),
    };
    const effectiveModelSpec = modelState?.activeModelSpec || modelState?.defaultModelSpec || {};
    const nonThinkingOverrides = resolveNonThinkingCallOverrides(
      runtime,
      effectiveToolChoice,
      effectiveModelSpec,
    );
    const boundToolOverrides = resolveBoundToolModelRequestOverrides(effectiveModelSpec);

    const response = await modelState.modelPort.invoke({
      messages: filterForModelContext(messages),
      tools: boundTools,
      options: {
        streaming: invokeMode !== "with_tools_non_streaming",
        callbacks: runtime?.modelCallbacks,
        signal: abortSignal,
        invoke: {
          ...(effectiveToolChoice ? { tool_choice: effectiveToolChoice } : {}),
          ...nonThinkingOverrides,
          ...boundToolOverrides,
        },
        toolBinding: effectiveBindOptions,
      },
      policies: {
        retry: { toolCallMismatch: { maxAttempts: 1, downgradeStreaming: true } },
      },
      invocation: {
        flow: "agent.main",
        purpose: invokeMode,
        domain: "primary",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
      },
    });
    return response.output;
  };
}
