/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterSummarizedMessages } from "../../../context/session/summarized-message-policy.js";
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../../../context/session/current-turn-store.js";
import {
  adaptToolsForBinding,
  appendToolCompatibilityLog,
  createChatModelFromSpec,
  resolveInvokeLlm,
} from "../../../model/index.js";
import { emitEvent } from "../../../event/index.js";
import { createStateCommitter } from "../execution/state-committer.js";
import {
  extractAttachmentMetasFromToolResult,
  persistModelGeneratedArtifacts,
} from "../media/artifact-service.js";
import { invokeLlmWithTransientRetry, normalizeAiTextContent } from "../llm-invoker.js";
import { resolveCurrentModelInfo } from "../model/model-manager.js";
import { HOOK_POINTS, runRuntimeHook, withHookRuntimeMeta } from "../../../hook/index.js";

function isRequiredToolChoiceUnsupportedError(error = null) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("tool_choice parameter does not support being set to required") ||
    (message.includes("tool_choice") &&
      message.includes("thinking mode") &&
      message.includes("required"))
  );
}

function resolveNonThinkingCallOverrides(runtime = {}, toolChoice = "") {
  const normalizedToolChoice = String(toolChoice || "").trim().toLowerCase();
  if (normalizedToolChoice === "required") {
    return {
      enable_thinking: false,
      preserve_thinking: false,
      thinking_budget: 0,
    };
  }
  const systemRuntime =
    runtime?.systemRuntime && typeof runtime.systemRuntime === "object"
      ? runtime.systemRuntime
      : null;
  if (!systemRuntime || systemRuntime.forceNonThinkingMode !== true) {
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
        streaming: Boolean(eventListener?.onEvent),
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

export async function invokeNoToolsTurn({
  modelState,
  loopState,
  turn,
  forceToolChoiceNone = false,
}) {
  const {
    messages,
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
  await runRuntimeHook({
    runtime,
    point: HOOK_POINTS.BEFORE_LLM_CALL,
    context: withHookRuntimeMeta(runtime, {
      phase: "llm_call",
      turn,
      mode: "no_tools",
      status: "start",
      startedAt: llmStartedAt,
      forceToolChoiceNone,
      messages,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });
  let modelResponse = null;
  try {
    modelResponse = await invokeLlmWithTransientRetry({
      modelState,
      turn,
      mode: "no_tools",
      invoke: ({ callbacks }) =>
        invokeLlm.invoke(filterSummarizedMessages(messages), {
          callbacks,
          signal: abortSignal,
          ...(forceToolChoiceNone ? { tool_choice: "none" } : {}),
        }),
    });
  } catch (error) {
    await runRuntimeHook({
      runtime,
      point: HOOK_POINTS.LLM_CALL_ERROR,
      context: withHookRuntimeMeta(runtime, {
        phase: "llm_call",
        turn,
        mode: "no_tools",
        status: "error",
        startedAt: llmStartedAt,
        endedAt: new Date(Date.now()).toISOString(),
        durationMs: Date.now() - llmStartedAtMs,
        error,
        messages,
        maxTurns: Number(loopState?.maxTurns || 0),
        agentContext: modelState?.agentContext || null,
      }),
    });
    throw error;
  }
  const llmEndedAtMs = Date.now();
  await runRuntimeHook({
    runtime,
    point: HOOK_POINTS.AFTER_LLM_CALL,
    context: withHookRuntimeMeta(runtime, {
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
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });
  const responseContentText = normalizeAiTextContent(modelResponse?.content, {
    additionalKwargs: modelResponse?.additional_kwargs ?? null,
    allowReasoningFallback: true,
  });
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
    traces,
    tools,
    turnMessages,
    currentTurnMessages,
    currentTurnTasks,
    dialogProcessId,
  } = loopState;
  const { eventListener, runtime, abortSignal } = modelState;

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

  const invokeBoundLlmWithToolChoice = async (toolChoiceOverride = "") =>
    invokeLlmWithTransientRetry({
      modelState,
      turn,
      mode: "with_tools",
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
        const boundLlm = Object.keys(effectiveBindOptions).length
          ? invokeLlm.bindTools(boundTools, effectiveBindOptions)
          : invokeLlm.bindTools(boundTools);
        const nonThinkingOverrides = resolveNonThinkingCallOverrides(
          runtime,
          effectiveToolChoice,
        );
        return boundLlm.invoke(filterSummarizedMessages(messages), {
          callbacks,
          signal: abortSignal,
          ...(effectiveToolChoice ? { tool_choice: effectiveToolChoice } : {}),
          ...nonThinkingOverrides,
        });
      },
    });

  const llmStartedAtMs = Date.now();
  const llmStartedAt = new Date(llmStartedAtMs).toISOString();
  await runRuntimeHook({
    runtime,
    point: HOOK_POINTS.BEFORE_LLM_CALL,
    context: withHookRuntimeMeta(runtime, {
      phase: "llm_call",
      turn,
      mode: "with_tools",
      status: "start",
      startedAt: llmStartedAt,
      toolChoice: configuredToolChoice || "",
      toolNames: boundTools.map((tool) => String(tool?.name || "").trim()).filter(Boolean),
      messages,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });

  let ai = null;
  try {
    ai = await invokeBoundLlmWithToolChoice();
  } catch (error) {
    await runRuntimeHook({
      runtime,
      point: HOOK_POINTS.LLM_CALL_ERROR,
      context: withHookRuntimeMeta(runtime, {
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
        maxTurns: Number(loopState?.maxTurns || 0),
        agentContext: modelState?.agentContext || null,
      }),
    });
    if (configuredToolChoice === "required" && isRequiredToolChoiceUnsupportedError(error)) {
      if (runtime?.systemRuntime && typeof runtime.systemRuntime === "object") {
        runtime.systemRuntime.toolChoiceRequiredUnsupported = true;
        runtime.systemRuntime.forceNonThinkingMode = true;
      }
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

  const rawCalls = Array.isArray(ai?.tool_calls) ? ai.tool_calls : [];
  const calls = rawCalls.map((call = {}) => ({
    ...call,
    id: String(
      call?.id ??
        call?.tool_call_id ??
        call?.toolCallId ??
        call?.call_id ??
        "",
    ).trim(),
    name: String(call?.name ?? call?.tool_name ?? call?.toolName ?? "").trim(),
    args: call?.args && typeof call.args === "object" ? call.args : {},
  }));
  const aiContentText = normalizeAiTextContent(ai.content, {
    additionalKwargs: ai?.additional_kwargs ?? null,
    allowReasoningFallback: calls.length === 0,
  });
  await runRuntimeHook({
    runtime,
    point: HOOK_POINTS.AFTER_LLM_CALL,
    context: withHookRuntimeMeta(runtime, {
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
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });
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
    if (runtime?.systemRuntime && typeof runtime.systemRuntime === "object") {
      runtime.systemRuntime.toolChoiceRequiredUnsupported = true;
    }
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
