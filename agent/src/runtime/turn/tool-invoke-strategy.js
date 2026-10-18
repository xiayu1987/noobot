/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "@noobot/context-protocol/policy/message";
import { MODEL_CONTEXT_SEQUENCE_POLICY, requireModelSpec } from "@noobot/model-protocol";
import { ACTIVITY_KIND, MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import {
  resolveBoundToolModelRequestOverrides,
  resolveNonThinkingCallOverrides,
} from "./tool-choice-strategy.js";
import { createModelActivity } from "../../models/runtime/model-manager.js";
import { MAIN_FLOW_NO_FINAL_RESPONSE_RETRY } from "./no-final-response-recovery.js";

export function createBoundLlmToolChoiceInvoker({
  adaptedBinding,
  boundTools,
  messages,
  modelState,
  runtime,
}) {
  return async function invokeBoundLlmWithToolChoice(
    toolChoiceOverride = "",
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
    const effectiveModelSpec = requireModelSpec(modelState.activeModelSpec);
    const nonThinkingOverrides = resolveNonThinkingCallOverrides(
      runtime,
      effectiveToolChoice,
      effectiveModelSpec,
    );
    const boundToolOverrides = resolveBoundToolModelRequestOverrides(effectiveModelSpec);
    const streaming = runtime?.runConfig?.streaming === true;
    const modelActivity = createModelActivity(runtime.eventListener, runtime, {
      activityKind: ACTIVITY_KIND.MAIN_MODEL_ANALYSIS,
      activityEventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
      purpose: invokeMode,
      streaming,
    });

    const response = await modelState.modelPort.invoke({
      messages: filterForModelContext(messages),
      tools: boundTools,
      options: {
        streaming,
        callbacks: modelActivity.callbacks,
        signal: runtime.abortSignal,
        invoke: {
          ...(effectiveToolChoice ? { tool_choice: effectiveToolChoice } : {}),
          ...nonThinkingOverrides,
          ...boundToolOverrides,
        },
        toolBinding: effectiveBindOptions,
      },
      policies: {
        retry: {
          toolCallMismatch: { maxAttempts: 1, downgradeStreaming: true },
          ...MAIN_FLOW_NO_FINAL_RESPONSE_RETRY,
        },
      },
      invocation: {
        flow: "agent.main",
        purpose: invokeMode,
        domain: "primary",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
      },
    });
    await modelActivity.complete(response.output?.text);
    return response.output;
  };
}
