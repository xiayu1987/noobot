/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "../../../context/session/message-context-policy.js";
import { invokeLlmWithTransientRetry } from "../llm-invoker.js";
import { syncStoppedModelMessageSnapshotCandidate } from "../resume/model-message-snapshot-store.js";
import {
  applyBoundToolModelRequestOverridesToLlm,
  resolveBoundToolModelRequestOverrides,
  resolveNonThinkingCallOverrides,
} from "./tool-choice-strategy.js";
import { emitModelContextTrace, summarizeDiagnosticMessages } from "../message-context/context-diagnostics.js";

export function createBoundLlmToolChoiceInvoker({
  adaptedBinding,
  boundTools,
  invokeLlm,
  messages,
  modelState,
  runtime,
  abortSignal,
  turn,
}) {
  return async function invokeBoundLlmWithToolChoice(
    toolChoiceOverride = "",
    llmOverride = null,
    invokeMode = "with_tools",
  ) {
    return invokeLlmWithTransientRetry({
      modelState,
      turn,
      mode: invokeMode,
      invoke: ({ callbacks }) => {
        const baseBindOptions =
          adaptedBinding?.bindOptions && typeof adaptedBinding.bindOptions === "object"
            ? adaptedBinding.bindOptions
            : {};
        const effectiveToolChoice = String(
          toolChoiceOverride || baseBindOptions?.tool_choice || "",
        ).trim();
        const effectiveBindOptions = {
          ...baseBindOptions,
          ...(effectiveToolChoice ? { tool_choice: effectiveToolChoice } : {}),
        };
        const targetLlm = llmOverride || invokeLlm;
        const boundLlm = Object.keys(effectiveBindOptions).length
          ? targetLlm.bindTools(boundTools, effectiveBindOptions)
          : targetLlm.bindTools(boundTools);
        const effectiveModelSpec = modelState?.activeModelSpec || modelState?.defaultModelSpec || {};
        const nonThinkingOverrides = resolveNonThinkingCallOverrides(
          runtime,
          effectiveToolChoice,
          effectiveModelSpec,
        );
        const boundToolOverrides = resolveBoundToolModelRequestOverrides(
          effectiveModelSpec,
        );
        const effectiveBoundLlm = applyBoundToolModelRequestOverridesToLlm(
          boundLlm,
          boundToolOverrides,
        );
        const modelMessages = filterForModelContext(messages);
        syncStoppedModelMessageSnapshotCandidate(runtime, modelMessages);
        emitModelContextTrace(runtime, "llm_invoke_messages", {
          turn,
          mode: invokeMode,
          toolChoice: effectiveToolChoice,
          messages: summarizeDiagnosticMessages(modelMessages),
        });
        return effectiveBoundLlm.invoke(modelMessages, {
          callbacks,
          signal: abortSignal,
          ...(effectiveToolChoice ? { tool_choice: effectiveToolChoice } : {}),
          ...nonThinkingOverrides,
          ...boundToolOverrides,
        });
      },
    });
  };
}
