/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../event/index.js";
import { createChatModelFromSpec, resolveInvokeLlm } from "../../../model/index.js";
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";

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
  const normalizedToolChoice = String(toolChoice || "").trim().toLowerCase();
  const providerFormat = String(modelSpec?.format || "").trim().toLowerCase();
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
    if (providerFormat === "dashscope" && modelEnableThinking !== true) {
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

export function resolveLlmForRequiredToolChoice({ modelState, eventListener, turn }) {
  try {
    return createChatModelFromSpec(
      {
        ...(modelState?.defaultModelSpec || {}),
        ...(modelState?.activeModelName
          ? { model: String(modelState.activeModelName || "").trim() }
          : {}),
        ...(modelState?.activeModelAlias
          ? { alias: String(modelState.activeModelAlias || "").trim() }
          : {}),
      },
      {
        streaming: false,
        context: {
          runtime: modelState?.runtime || {},
          agentContext: modelState?.agentContext || null,
          sessionId: String(
            modelState?.runtime?.systemRuntime?.sessionId || modelState?.runtime?.sessionId || "",
          ).trim(),
        },
      },
    );
  } catch {
    emitEvent(eventListener, "tool_choice_required_non_thinking_model_fallback_skipped", {
      turn,
      reason: "model_create_failed_fallback_to_current",
    });
    return resolveInvokeLlm(modelState, "with_tools");
  }
}
