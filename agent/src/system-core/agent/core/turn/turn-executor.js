/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "../../../context/session/message-context-policy.js";
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../../../context/session/current-turn-store.js";
import {
  adaptToolsForBinding,
  appendToolCompatibilityLog,
  createChatModelFromSpec,
  normalizeToolCalls,
  registerToolCallStreamingMismatch,
  resolveRetryInvokeLlm,
  resolveInvokeLlm,
  shouldRetryToolCallStreamingMismatch,
} from "../../../model/index.js";
import { emitEvent } from "../../../event/index.js";
import { createStateCommitter } from "../execution/state-committer.js";
import {
  extractAttachmentMetasFromToolResult,
  persistModelGeneratedArtifacts,
} from "../media/artifact-service.js";
import {
  extractAiReasoningText,
  invokeLlmWithTransientRetry,
  normalizeAiTextContent,
} from "../llm-invoker.js";
import { resolveCurrentModelInfo } from "../model/model-manager.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../../hook/index.js";
import { buildHookContext } from "../hook/hook-context-builder.js";
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";
import { mergeConfig } from "../../../config/index.js";

function isRequiredToolChoiceUnsupportedError(error = null) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("tool_choice parameter does not support being set to required") ||
    (message.includes("tool_choice") &&
      message.includes("thinking mode") &&
      message.includes("required"))
  );
}

function resolveNonThinkingCallOverrides(runtime = {}, toolChoice = "", modelSpec = {}) {
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

function resolveLlmForRequiredToolChoice({ modelState, eventListener, turn }) {
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

function normalizeBooleanLike(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = String(value || "").trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return Boolean(fallback);
}

function shouldUseFinalStreaming(modelState = {}) {
  if (!modelState?.eventListener?.onEvent) return false;
  const runtime = modelState?.runtime || {};
  const effectiveConfig = mergeConfig(
    modelState?.globalConfig || {},
    modelState?.userConfig || {},
  );
  return (
    normalizeBooleanLike(runtime?.runConfig?.streaming, false) ||
    normalizeBooleanLike(effectiveConfig?.streaming, false)
  );
}

function createFinalStreamingLlm(modelState = {}) {
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
    { streaming: true },
  );
}

async function maybeInvokeFinalStreamingNoTools({
  modelState,
  baseMessages = [],
  fallbackAi = null,
  fallbackText = "",
  turn,
  mode = "final_stream_no_tools",
} = {}) {
  if (!shouldUseFinalStreaming(modelState)) {
    return {
      ai: fallbackAi,
      text: String(fallbackText || ""),
      streamed: false,
    };
  }

  const { eventListener, runtime, abortSignal } = modelState;
  let streamingLlm = null;
  try {
    streamingLlm = createFinalStreamingLlm(modelState);
  } catch (error) {
    emitEvent(eventListener, "llm_final_stream_create_failed_fallback_non_streaming", {
      turn,
      mode,
      error: error?.message || String(error),
    });
    return {
      ai: fallbackAi,
      text: String(fallbackText || ""),
      streamed: false,
    };
  }

  emitEvent(eventListener, "llm_final_stream_start", { turn, mode });
  try {
    const streamedAi = await invokeLlmWithTransientRetry({
      modelState,
      turn,
      mode,
      invoke: ({ callbacks }) =>
        streamingLlm.invoke(filterForModelContext(baseMessages), {
          callbacks,
          signal: abortSignal,
          ...resolveNonThinkingCallOverrides(
            runtime,
            "none",
            modelState?.defaultModelSpec || {},
          ),
        }),
    });
    const streamedText = normalizeAiTextContent(streamedAi?.content, {
      additionalKwargs: streamedAi?.additional_kwargs ?? null,
      allowReasoningFallback: false,
    });
    emitEvent(eventListener, "llm_final_stream_end", {
      turn,
      mode,
      textChars: streamedText.length,
    });
    return {
      ai: streamedAi,
      text: streamedText || String(fallbackText || ""),
      streamed: true,
    };
  } catch (error) {
    emitEvent(eventListener, "llm_final_stream_failed_fallback_non_streaming", {
      turn,
      mode,
      error: error?.message || String(error),
    });
    return {
      ai: fallbackAi,
      text: String(fallbackText || ""),
      streamed: false,
    };
  }
}

function buildReasoningRetrySystemMessage(reasoningText = "", locale = "zh-CN") {
  const isEn = String(locale || "").trim().toLowerCase() === "en-us";
  return [
    "<!-- noobot-reasoning-retry -->",
    isEn
      ? "The prior model reasoning is reference-only, not final answer. Return final answer directly."
      : "以下是上次模型返回的思考内容，仅供参考，不代表最终答案。请直接给出最终答案。",
    String(reasoningText || "").trim(),
  ].join("\n");
}

export async function invokeNoToolsTurn({
  modelState,
  loopState,
  turn,
  forceToolChoiceNone = false,
}) {
  const {
    messages,
    messageBlocks,
    traces,
    turnMessages,
    currentTurnMessages,
    currentTurnTasks,
    dialogProcessId,
  } = loopState;
  const { eventListener, runtime, abortSignal } = modelState;

  const invokeLlm = resolveInvokeLlm(modelState, "no_tools");
  emitEvent(eventListener, "llm_call_start", { turn, mode: "no_tools" });
  const llmStartedAtMs = Date.now();
  const llmStartedAt = new Date(llmStartedAtMs).toISOString();
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.BEFORE_LLM_CALL,
    context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_LLM_CALL, runtime, {
      phase: "llm_call",
      turn,
      mode: "no_tools",
      status: "start",
      startedAt: llmStartedAt,
      forceToolChoiceNone,
      messages,
      messageBlocks,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const locale = String(systemRuntime?.locale || "zh-CN");
  let modelResponse = null;
  try {
    modelResponse = await invokeLlmWithTransientRetry({
      modelState,
      turn,
      mode: "no_tools",
      invoke: ({ callbacks }) =>
        invokeLlm.invoke(filterForModelContext(messages), {
          callbacks,
          signal: abortSignal,
          ...(forceToolChoiceNone ? { tool_choice: "none" } : {}),
          ...resolveNonThinkingCallOverrides(
            runtime,
            forceToolChoiceNone ? "none" : "",
            modelState?.defaultModelSpec || {},
          ),
        }),
    });
  } catch (error) {
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.LLM_CALL_ERROR,
      context: buildHookContext(AGENT_HOOK_POINTS.LLM_CALL_ERROR, runtime, {
        phase: "llm_call",
        turn,
        mode: "no_tools",
        status: "error",
        startedAt: llmStartedAt,
        endedAt: new Date(Date.now()).toISOString(),
        durationMs: Date.now() - llmStartedAtMs,
        error,
        messages,
        messageBlocks,
        maxTurns: Number(loopState?.maxTurns || 0),
        agentContext: modelState?.agentContext || null,
      }),
    });
    throw error;
  }
  const llmEndedAtMs = Date.now();
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.AFTER_LLM_CALL,
    context: buildHookContext(AGENT_HOOK_POINTS.AFTER_LLM_CALL, runtime, {
      phase: "llm_call",
      turn,
      mode: "no_tools",
      status: "success",
      startedAt: llmStartedAt,
      endedAt: new Date(llmEndedAtMs).toISOString(),
      durationMs: llmEndedAtMs - llmStartedAtMs,
      hasToolCalls: false,
      modelResponse,
      messages,
      messageBlocks,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });
  let responseContentText = normalizeAiTextContent(modelResponse?.content, {
    additionalKwargs: modelResponse?.additional_kwargs ?? null,
    allowReasoningFallback: false,
  });
  const reasoningText = extractAiReasoningText(modelResponse);
  if (!responseContentText && reasoningText) {
    emitEvent(eventListener, "llm_reasoning_only_retry_scheduled", {
      turn,
      mode: "no_tools",
      reasoningChars: reasoningText.length,
    });
    messages.push({
      role: "system",
      content: buildReasoningRetrySystemMessage(reasoningText, locale),
    });
    modelResponse = await invokeLlmWithTransientRetry({
      modelState,
      turn,
      mode: "no_tools_reasoning_retry",
      invoke: ({ callbacks }) =>
        invokeLlm.invoke(filterForModelContext(messages), {
          callbacks,
          signal: abortSignal,
          ...(forceToolChoiceNone ? { tool_choice: "none" } : {}),
          ...resolveNonThinkingCallOverrides(
            runtime,
            forceToolChoiceNone ? "none" : "",
            modelState?.defaultModelSpec || {},
          ),
        }),
    });
    responseContentText = normalizeAiTextContent(modelResponse?.content, {
      additionalKwargs: modelResponse?.additional_kwargs ?? null,
      allowReasoningFallback: false,
    });
  }
  const finalStreamResult = await maybeInvokeFinalStreamingNoTools({
    modelState,
    baseMessages: messages,
    fallbackAi: modelResponse,
    fallbackText: responseContentText,
    turn,
    mode: forceToolChoiceNone
      ? "final_stream_no_tools_forced_none"
      : "final_stream_no_tools",
  });
  modelResponse = finalStreamResult.ai || modelResponse;
  responseContentText = finalStreamResult.text || responseContentText;
  messages.push(modelResponse);

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages, turnMessages);
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const stateCommitter = createStateCommitter({
    messages,
    traces,
    turnMessageStore,
    dialogProcessId,
    runtime,
    agentContext: modelState?.agentContext || null,
  });

  await stateCommitter.pushAssistantMessage({
    content: responseContentText,
    rawModelContent: modelResponse?.content ?? null,
    modelAdditionalKwargs: modelResponse?.additional_kwargs ?? null,
    modelResponseMetadata: modelResponse?.response_metadata ?? null,
    type: "message",
    toolCalls: [],
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
  });
  await persistModelGeneratedArtifacts({
    aiContent: modelResponse?.content,
    runtime,
    eventListener,
    dialogProcessId,
    turnMessageStore,
  });
  emitEvent(eventListener, "llm_call_end", { turn, hasToolCalls: false, mode: "no_tools" });

  return {
    output: responseContentText,
    turnTaskStore,
    turnMessageStore,
    modelMessages: messages,
  };
}

export async function invokeWithToolsTurn({ modelState, loopState, turn }) {
  const {
    messages,
    messageBlocks,
    traces,
    tools,
    turnMessages,
    currentTurnMessages,
    currentTurnTasks,
    dialogProcessId,
  } = loopState;
  const { eventListener, runtime, abortSignal } = modelState;
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const locale = String(systemRuntime?.locale || "zh-CN");

  const adaptedBinding = adaptToolsForBinding(tools, modelState);
  const configuredToolChoice = String(adaptedBinding?.bindOptions?.tool_choice || "").trim();
  const invokeLlm =
    configuredToolChoice === "required"
      ? resolveLlmForRequiredToolChoice({ modelState, eventListener, turn })
      : resolveInvokeLlm(modelState, "with_tools");
  if (configuredToolChoice === "required") {
    emitEvent(eventListener, "tool_choice_required_forced_non_thinking_model", {
      turn,
    });
  }
  const boundTools = Array.isArray(adaptedBinding?.tools) ? adaptedBinding.tools : [];
  const toolMap = new Map(boundTools.map((tool) => [tool.name, tool]));

  if (Array.isArray(adaptedBinding?.droppedToolNames) && adaptedBinding.droppedToolNames.length) {
    emitEvent(eventListener, "tool_binding_adapter_dropped_tools", {
      turn,
      droppedTools: adaptedBinding.droppedToolNames,
    });
    appendToolCompatibilityLog({
      modelState,
      runtime,
      event: "tool_binding_adapter_dropped_tools",
      tools: adaptedBinding.droppedToolNames,
    }).catch(() => {});
  }

  if (
    Array.isArray(adaptedBinding?.strictDowngradedTools) &&
    adaptedBinding.strictDowngradedTools.length
  ) {
    emitEvent(eventListener, "tool_binding_adapter_strict_downgraded", {
      turn,
      incompatibleTools: adaptedBinding.strictDowngradedTools,
    });
  }

  emitEvent(eventListener, "tool_binding_ready", {
    turn,
    toolCount: boundTools.length,
    toolNames: boundTools.map((tool) => String(tool?.name || "").trim()).filter(Boolean),
    bindOptions: adaptedBinding?.bindOptions || {},
  });

  emitEvent(eventListener, "llm_call_start", { turn, mode: "with_tools" });

  const invokeBoundLlmWithToolChoice = async (
    toolChoiceOverride = "",
    llmOverride = null,
    invokeMode = "with_tools",
  ) =>
    invokeLlmWithTransientRetry({
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
        const nonThinkingOverrides = resolveNonThinkingCallOverrides(
          runtime,
          effectiveToolChoice,
          modelState?.defaultModelSpec || {},
        );
        return boundLlm.invoke(filterForModelContext(messages), {
          callbacks,
          signal: abortSignal,
          ...(effectiveToolChoice ? { tool_choice: effectiveToolChoice } : {}),
          ...nonThinkingOverrides,
        });
      },
    });

  const llmStartedAtMs = Date.now();
  const llmStartedAt = new Date(llmStartedAtMs).toISOString();
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.BEFORE_LLM_CALL,
    context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_LLM_CALL, runtime, {
      phase: "llm_call",
      turn,
      mode: "with_tools",
      status: "start",
      startedAt: llmStartedAt,
      toolChoice: configuredToolChoice || "",
      toolNames: boundTools.map((tool) => String(tool?.name || "").trim()).filter(Boolean),
      messages,
      messageBlocks,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });

  let ai = null;
  try {
    ai = await invokeBoundLlmWithToolChoice();
  } catch (error) {
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.LLM_CALL_ERROR,
      context: buildHookContext(AGENT_HOOK_POINTS.LLM_CALL_ERROR, runtime, {
        phase: "llm_call",
        turn,
        mode: "with_tools",
        status: "error",
        startedAt: llmStartedAt,
        endedAt: new Date(Date.now()).toISOString(),
        durationMs: Date.now() - llmStartedAtMs,
        toolChoice: configuredToolChoice || "",
        error,
        messages,
        messageBlocks,
        maxTurns: Number(loopState?.maxTurns || 0),
        agentContext: modelState?.agentContext || null,
      }),
    });
    if (configuredToolChoice === "required" && isRequiredToolChoiceUnsupportedError(error)) {
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
      ai = {
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
    } else {
      throw error;
    }
  }

  let { rawCalls, calls } = normalizeToolCalls(ai);
  let aiContentText = normalizeAiTextContent(ai.content, {
    additionalKwargs: ai?.additional_kwargs ?? null,
    allowReasoningFallback: false,
  });
  const reasoningText = extractAiReasoningText(ai);
  if (!aiContentText && !calls.length && reasoningText) {
    emitEvent(eventListener, "llm_reasoning_only_retry_scheduled", {
      turn,
      mode: "with_tools",
      reasoningChars: reasoningText.length,
    });
    messages.push({
      role: "system",
      content: buildReasoningRetrySystemMessage(reasoningText, locale),
    });
    ai = await invokeBoundLlmWithToolChoice();
    ({ rawCalls, calls } = normalizeToolCalls(ai));
    aiContentText = normalizeAiTextContent(ai.content, {
      additionalKwargs: ai?.additional_kwargs ?? null,
      allowReasoningFallback: false,
    });
  }
  if (shouldRetryToolCallStreamingMismatch({ ai, calls })) {
    registerToolCallStreamingMismatch(modelState, {
      mode: "with_tools",
      reason: "finish_reason_tool_calls_but_no_calls_detected",
    });
    const retryLlm = resolveRetryInvokeLlm(modelState, {
      mode: "with_tools",
      reason: "finish_reason_tool_calls_but_no_calls_detected",
    });
    ai = await invokeBoundLlmWithToolChoice(
      "",
      retryLlm,
      "with_tools_non_streaming_retry",
    );
    ({ rawCalls, calls } = normalizeToolCalls(ai));
    aiContentText = normalizeAiTextContent(ai.content, {
      additionalKwargs: ai?.additional_kwargs ?? null,
      allowReasoningFallback: false,
    });
  }
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.AFTER_LLM_CALL,
    context: buildHookContext(AGENT_HOOK_POINTS.AFTER_LLM_CALL, runtime, {
      phase: "llm_call",
      turn,
      mode: "with_tools",
      status: "success",
      startedAt: llmStartedAt,
      endedAt: new Date(Date.now()).toISOString(),
      durationMs: Date.now() - llmStartedAtMs,
      hasToolCalls: Boolean(calls.length),
      toolChoice: configuredToolChoice || "",
      ai,
      calls,
      messages,
      messageBlocks,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });
  if (!calls.length) {
    const finalStreamResult = await maybeInvokeFinalStreamingNoTools({
      modelState,
      baseMessages: messages,
      fallbackAi: ai,
      fallbackText: aiContentText,
      turn,
      mode: "final_stream_after_tools_no_calls",
    });
    ai = finalStreamResult.ai || ai;
    aiContentText = finalStreamResult.text || aiContentText;
  }
  messages.push(ai);

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages, turnMessages);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const currentModelInfo = resolveCurrentModelInfo(modelState);

  const stateCommitter = createStateCommitter({
    messages,
    traces,
    turnMessageStore,
    dialogProcessId,
    runtime,
    agentContext: modelState?.agentContext || null,
  });

  await stateCommitter.pushAssistantMessage({
    content: aiContentText,
    rawModelContent: ai?.content ?? null,
    modelAdditionalKwargs: ai?.additional_kwargs ?? null,
    modelResponseMetadata: ai?.response_metadata ?? null,
    type: calls.length ? "tool_call" : "message",
    toolCalls: calls.length
      ? calls.map((call) => ({
          id: call.id || "",
          type: "function",
          function: {
            name: call.name || "",
            arguments: JSON.stringify(call.args || {}),
          },
        }))
      : [],
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
  });

  await persistModelGeneratedArtifacts({
    aiContent: ai?.content,
    runtime,
    eventListener,
    dialogProcessId,
    turnMessageStore,
  });

  emitEvent(eventListener, "llm_call_end", {
    turn,
    hasToolCalls: Boolean(calls.length),
  });
  if (!rawCalls.length && String(adaptedBinding?.bindOptions?.tool_choice || "") === "required") {
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
  }

  return {
    ai,
    aiContentText,
    calls,
    toolMap,
    stateCommitter,
    turnMessageStore,
    turnTaskStore,
    traces,
  };
}

export function normalizeToolResultAttachmentMetas(toolCallResult = {}, call = {}) {
  const toolResultText = String(toolCallResult?.toolResultText || "");
  const fallbackExtractedAttachmentMetas = extractAttachmentMetasFromToolResult(
    call?.name || "",
    toolResultText,
  );
  return Array.isArray(toolCallResult?.extractedAttachmentMetas) &&
    toolCallResult.extractedAttachmentMetas.length
    ? toolCallResult.extractedAttachmentMetas
    : fallbackExtractedAttachmentMetas;
}
