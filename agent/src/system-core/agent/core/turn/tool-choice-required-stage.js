/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";
import { emitEvent } from "../../../event/index.js";

export function handleRequiredToolChoiceNotFollowed({
  rawCalls = [],
  adaptedBinding = null,
  runtime,
  eventListener,
  turn,
  currentModelInfo = {},
} = {}) {
  if (rawCalls.length || String(adaptedBinding?.bindOptions?.tool_choice || "") !== "required") {
    return false;
  }

  const systemRuntimeForRequired = getSystemRuntimeFromRuntime(runtime);
  systemRuntimeForRequired.toolChoiceRequiredUnsupported = true;
  emitEvent(eventListener, "llm_tool_choice_required_not_followed", {
    turn,
    toolChoice: "required",
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
  });
  emitEvent(eventListener, "tool_choice_downgraded_to_auto", {
    turn,
    reason: "required_not_followed",
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
  });
  return true;
}
