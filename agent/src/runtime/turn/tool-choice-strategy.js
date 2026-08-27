/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
export function resolveBoundToolModelRequestOverrides(modelSpec = {}) {
  return {
    reasoning_effort: modelSpec?.tool_reasoning_effort || modelSpec?.reasoning_effort || "low",
  };
}
export function isRequiredToolChoiceUnsupportedError(error = null) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("tool_choice parameter does not support being set to required") ||
    (message.includes("tool_choice") &&
      message.includes("thinking mode") &&
      message.includes("required"))
  );
}

export function resolveNonThinkingCallOverrides(runtime = {}, toolChoice = "", modelSpec = {}) {
  const normalizedToolChoice = String(toolChoice || "")
    .trim()
    .toLowerCase();
  if (normalizedToolChoice === "required") {
    return { reasoning_effort: "low" };
  }
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  if (!systemRuntime || systemRuntime.forceNonThinkingMode !== true) return {};
  return { reasoning_effort: "low" };
}
