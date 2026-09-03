/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import {
  buildModelReasoningEffortTransport,
  normalizeModelReasoningConfiguration,
  resolveModelMinimumReasoningEffort,
} from "@noobot/model-protocol";

/** Bound tool rounds run at the effort the model declares for tool use. */
export function resolveBoundToolModelRequestOverrides(modelSpec = {}) {
  const { tool_reasoning_effort: effort } = normalizeModelReasoningConfiguration(modelSpec);
  return buildModelReasoningEffortTransport(modelSpec, effort);
}

/** Suppressing reasoning means the model's lowest declared effort level. */
function suppressedReasoningOverrides(modelSpec = {}) {
  return buildModelReasoningEffortTransport(
    modelSpec,
    resolveModelMinimumReasoningEffort(modelSpec),
  );
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
  if (normalizedToolChoice === "required") return suppressedReasoningOverrides(modelSpec);
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  if (!systemRuntime || systemRuntime.forceNonThinkingMode !== true) return {};
  return suppressedReasoningOverrides(modelSpec);
}
