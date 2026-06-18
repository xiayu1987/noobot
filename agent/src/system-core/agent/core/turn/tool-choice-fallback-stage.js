/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";
import { emitEvent } from "../../../event/index.js";
import { resolveCurrentModelInfo } from "../model/model-manager.js";
import { isRequiredToolChoiceUnsupportedError } from "./tool-choice-strategy.js";

export function maybeCreateRequiredToolChoiceUnsupportedFallbackAi({
  error,
  configuredToolChoice = "",
  runtime,
  eventListener,
  turn,
  modelState,
} = {}) {
  if (configuredToolChoice !== "required" || !isRequiredToolChoiceUnsupportedError(error)) {
    return null;
  }

  const systemRuntimeForFallback = getSystemRuntimeFromRuntime(runtime);
  systemRuntimeForFallback.toolChoiceRequiredUnsupported = true;
  systemRuntimeForFallback.forceNonThinkingMode = true;
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  emitEvent(eventListener, "tool_choice_downgraded_to_auto", {
    turn,
    reason: "required_invalid_in_thinking_mode_no_retry",
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
  });

  return {
    content: "",
    tool_calls: [],
    additional_kwargs: {},
    response_metadata: {
      noobot: {
        toolChoiceDowngradedToAuto: true,
        downgradedAtTurn: turn,
      },
    },
  };
}
