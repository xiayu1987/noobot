/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import { emitEvent } from "../../events/index.js";
import { resolveCurrentModelInfo } from "../../models/runtime/model-manager.js";
import { isRequiredToolChoiceUnsupportedError } from "./tool-choice-strategy.js";

export function applyRequiredToolChoiceUnsupportedRetryDecision({
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

  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  systemRuntime.toolChoiceRequiredUnsupported = true;
  systemRuntime.forceNonThinkingMode = true;
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  emitEvent(eventListener, "tool_choice_downgraded_to_auto", {
    turn,
    reason: "required_invalid_in_thinking_mode_no_retry",
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
  });

  return true;
}
