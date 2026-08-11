/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import { normalizeProviderFormat, PROVIDER_FORMAT } from "@noobot/agent-config-protocol";

export function resolveBoundToolModelRequestOverrides(modelSpec = {}) {
  const providerFormat = normalizeProviderFormat(modelSpec?.format || "");
  if (providerFormat === PROVIDER_FORMAT.OPENAI_COMPATIBLE) {
    return { reasoning_effort: modelSpec?.tool_reasoning_effort || "low" };
  }
  if (providerFormat === PROVIDER_FORMAT.DASHSCOPE) {
    return {
      preserve_thinking: false,
      thinking_budget: 0,
    };
  }
  return {};
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
  const providerFormat = normalizeProviderFormat(modelSpec?.format || "");
  const hasEnableThinkingConfig = Object.prototype.hasOwnProperty.call(
    modelSpec || {},
    "enable_thinking",
  );
  const modelEnableThinking =
    hasEnableThinkingConfig && typeof modelSpec?.enable_thinking === "boolean"
      ? modelSpec.enable_thinking
      : undefined;
  if (normalizedToolChoice === "required") {
    return {
      enable_thinking: false,
      preserve_thinking: false,
      thinking_budget: 0,
    };
  }
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  if (!systemRuntime || systemRuntime.forceNonThinkingMode !== true) {
    if (providerFormat === PROVIDER_FORMAT.DASHSCOPE && modelEnableThinking !== true) {
      return {
        enable_thinking: false,
        preserve_thinking: false,
        thinking_budget: 0,
      };
    }
    return {};
  }
  return {
    enable_thinking: false,
    preserve_thinking: false,
    thinking_budget: 0,
  };
}
