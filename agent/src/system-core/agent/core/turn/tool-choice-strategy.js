/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../event/index.js";
import { createChatModelFromSpec, resolveInvokeLlm } from "../../../model/index.js";
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";
import { normalizeProviderFormat, PROVIDER_FORMAT } from "../../../config/core/enums.js";

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

export function applyBoundToolModelRequestOverridesToLlm(llm, overrides = {}) {
  if (!llm || typeof llm !== "object" || !overrides || typeof overrides !== "object") {
    return llm;
  }
  const entries = Object.entries(overrides);
  if (!entries.length) return llm;

  const applyInvocationParamsPatch = (target) => {
    if (!target || typeof target !== "object" || typeof target.invocationParams !== "function") {
      return;
    }
    if (target.__noobotBoundToolRequestOverridesPatched === true) {
      target.__noobotBoundToolRequestOverrides = {
        ...(target.__noobotBoundToolRequestOverrides || {}),
        ...overrides,
      };
      return;
    }
    const originalInvocationParams = target.invocationParams.bind(target);
    target.__noobotBoundToolRequestOverrides = { ...overrides };
    target.__noobotBoundToolRequestOverridesPatched = true;
    target.invocationParams = function invocationParamsWithBoundToolOverrides(...args) {
      const params = originalInvocationParams(...args);
      const currentOverrides = this.__noobotBoundToolRequestOverrides || {};
      const nextParams = {
        ...(params && typeof params === "object" ? params : {}),
        ...currentOverrides,
      };
      if (Object.prototype.hasOwnProperty.call(currentOverrides, "reasoning_effort")) {
        if (nextParams.reasoning && typeof nextParams.reasoning === "object") {
          nextParams.reasoning = {
            ...nextParams.reasoning,
            effort: currentOverrides.reasoning_effort,
          };
        }
        nextParams.reasoning_effort = currentOverrides.reasoning_effort;
      }
      return nextParams;
    };
  };

  // LangChain ChatOpenAI builds the provider request body from the model instance
  // modelKwargs. Unknown snake_case fields passed only as invoke options are not
  // merged into the final request params, so bind-time overrides must be applied
  // to the bound model instance itself. bindTools returns a new model instance,
  // so this does not affect the unbound/no-tools model request path.
  const currentModelKwargs =
    llm.modelKwargs && typeof llm.modelKwargs === "object" && !Array.isArray(llm.modelKwargs)
      ? llm.modelKwargs
      : {};
  llm.modelKwargs = {
    ...currentModelKwargs,
    ...overrides,
  };

  // ChatOpenAI.bindTools creates the bound model from lc_kwargs and its
  // invocationParams implementation may still read modelKwargs from lc_kwargs
  // instead of the mutable top-level property. Keep both in sync so provider
  // request params are actually overridden, not just invoke options.
  if (llm.lc_kwargs && typeof llm.lc_kwargs === "object" && !Array.isArray(llm.lc_kwargs)) {
    const currentLcModelKwargs =
      llm.lc_kwargs.modelKwargs &&
      typeof llm.lc_kwargs.modelKwargs === "object" &&
      !Array.isArray(llm.lc_kwargs.modelKwargs)
        ? llm.lc_kwargs.modelKwargs
        : {};
    llm.lc_kwargs = {
      ...llm.lc_kwargs,
      modelKwargs: {
        ...currentLcModelKwargs,
        ...overrides,
      },
    };
  }

  // Reasoning models in @langchain/openai may map call option reasoningEffort to
  // reasoning_effort after modelKwargs. Keep the instance reasoning config in
  // sync so provider-level high/medium settings cannot override bound-tool low.
  if (Object.prototype.hasOwnProperty.call(overrides, "reasoning_effort")) {
    llm.reasoning = {
      ...(llm.reasoning && typeof llm.reasoning === "object" ? llm.reasoning : {}),
      effort: overrides.reasoning_effort,
    };
    if (llm.lc_kwargs && typeof llm.lc_kwargs === "object" && !Array.isArray(llm.lc_kwargs)) {
      llm.lc_kwargs = {
        ...llm.lc_kwargs,
        reasoning: {
          ...(llm.lc_kwargs.reasoning && typeof llm.lc_kwargs.reasoning === "object"
            ? llm.lc_kwargs.reasoning
            : {}),
          effort: overrides.reasoning_effort,
        },
      };
    }
  }

  // bindTools uses withConfig/defaultOptions and the actual request params are
  // assembled by invocationParams on ChatOpenAI/completions/responses. Patch the
  // bound runnable (and its internal delegates) so provider defaults are forced
  // at the final request-param boundary for bound-tool calls only.
  applyInvocationParamsPatch(llm);
  applyInvocationParamsPatch(llm.completions);
  applyInvocationParamsPatch(llm.responses);

  return llm;
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
  const normalizedToolChoice = String(toolChoice || "").trim().toLowerCase();
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
