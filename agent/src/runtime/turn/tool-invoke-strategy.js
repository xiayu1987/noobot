/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "@noobot/context-protocol/policy/message";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import {
  resolveBoundToolModelRequestOverrides,
  resolveNonThinkingCallOverrides,
} from "./tool-choice-strategy.js";
import { createActivityStreamingCallbacks } from "../../models/runtime/model-manager.js";

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
        streaming: runtime?.runConfig?.streaming === true,
        callbacks:
          runtime?.runConfig?.streaming === true
            ? createActivityStreamingCallbacks(modelState?.eventListener, runtime, {
                activityKind: "main_model_analysis",
                activityEventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS_DELTA,
                purpose: invokeMode,
              })
            : undefined,
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
