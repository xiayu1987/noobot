/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "../../../context/session/message-context-policy.js";
import { resolveMainModelFinalMessages } from "../../../session/utils/context-window-normalizer.js";
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../../../context/session/current-turn-store.js";
import { resolveInvokeLlm } from "../../../model/index.js";
import { emitEvent } from "../../../event/index.js";
import { createStateCommitter } from "../execution/state-committer.js";
import { persistModelGeneratedArtifacts } from "../media/artifact-service.js";
import {
  invokeLlmWithTransientRetry,
  normalizeAiTextContent,
} from "../llm-invoker.js";
import { resolveCurrentModelInfo } from "../model/model-manager.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../../hook/index.js";
import { buildHookContext } from "../hook/hook-context-builder.js";
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";
import {
  resolveNonThinkingCallOverrides,
} from "./tool-choice-strategy.js";
import {
  buildAssistantModelMessageForToolCalls,
  formatToolCallsForStorage,
} from "./tool-call-message.js";
import {
  maybeInvokeFinalStreamingNoTools,
} from "./turn-stage.js";
import { prepareToolBinding } from "./tool-binding-preparer.js";
import { createBoundLlmToolChoiceInvoker } from "./tool-invoke-strategy.js";
import {
  maybeRetryToolCallStreamingMismatch,
  normalizeToolTurnAi,
} from "./tool-call-retry-stage.js";
import { maybeRetryReasoningOnlyWithTools } from "./tool-reasoning-retry-stage.js";
import { maybeRetryReasoningOnlyNoTools } from "./no-tools-reasoning-retry-stage.js";
import { finalizeNoToolsStreamingTurn } from "./no-tools-final-stream-stage.js";
import { commitNoToolsTurnState } from "./no-tools-commit-stage.js";
import { maybeCreateRequiredToolChoiceUnsupportedFallbackAi } from "./tool-choice-fallback-stage.js";
import { handleRequiredToolChoiceNotFollowed } from "./tool-choice-required-stage.js";
import { appendMessage } from "../message-context/message-store.js";
import {
  emitModelContextTrace,
  summarizeDiagnosticBlocks,
  summarizeDiagnosticMessages,
} from "../message-context/context-diagnostics.js";
import { peekMainFlowFinalNoToolsTurnInstruction } from "../main-flow-control.js";
export { normalizeToolResultAttachmentMetas } from "./tool-result-normalizer.js";
export {
  buildAssistantModelMessageForToolCalls,
  formatToolCallsForLangChain,
  formatToolCallsForStorage,
} from "./tool-call-message.js";

function normalizeBlockList(value = []) {
  return Array.isArray(value) ? value : [];
}

function isMessageBlocks(value = null) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function reconcileHookContextToLoopState(loopState = {}, hookContext = {}) {
  if (!loopState || typeof loopState !== "object" || !hookContext || typeof hookContext !== "object") {
    return loopState;
  }
  if (isMessageBlocks(hookContext.messageBlocks) && hookContext.messageBlocks !== loopState.messageBlocks) {
    loopState.messageBlocks = hookContext.messageBlocks;
  }
  if (Array.isArray(hookContext.messages) && Array.isArray(loopState.messages) && hookContext.messages !== loopState.messages) {
    loopState.messages.splice(0, loopState.messages.length, ...hookContext.messages);
  }
  return loopState;
}


function traceLoopStateContext(runtime = {}, stage = "", loopState = {}, extra = {}) {
  emitModelContextTrace(runtime, stage, {
    turn: extra.turn,
    mode: extra.mode,
    dialogProcessId: loopState?.dialogProcessId || "",
    blocks: summarizeDiagnosticBlocks(loopState?.messageBlocks),
    messages: summarizeDiagnosticMessages(loopState?.messages),
    ...extra,
  });
}

function syncMessagesFromBlocks(loopState = {}) {
  const blocks =
    loopState?.messageBlocks &&
    typeof loopState.messageBlocks === "object" &&
    !Array.isArray(loopState.messageBlocks)
      ? loopState.messageBlocks
      : null;
  if (!blocks || !Array.isArray(loopState?.messages)) return loopState?.messages || [];
  const resolved = resolveMainModelFinalMessages({
    systemMessages: normalizeBlockList(blocks.system),
    historyMessages: normalizeBlockList(blocks.history),
    incrementalMessages: normalizeBlockList(blocks.incremental),
  });
  const composed = Array.isArray(resolved?.messages) ? resolved.messages : [];
  loopState.messages.splice(0, loopState.messages.length, ...composed);
  return loopState.messages;
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
  traceLoopStateContext(runtime, "before_llm_hook_context_input", loopState, { turn, mode: "no_tools" });
  const beforeLlmHookContext = buildHookContext(AGENT_HOOK_POINTS.BEFORE_LLM_CALL, runtime, {
    phase: "llm_call",
    turn,
    mode: "no_tools",
    status: "start",
    startedAt: llmStartedAt,
    forceToolChoiceNone,
    messages,
    messageStore: loopState.messageStore,
    messageBlocks: loopState.messageBlocks,
    maxTurns: Number(loopState?.maxTurns || 0),
    agentContext: modelState?.agentContext || null,
  });
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.BEFORE_LLM_CALL,
    context: beforeLlmHookContext,
  });
  emitModelContextTrace(runtime, "before_llm_hook_context_output", {
    turn,
    mode: "no_tools",
    hookBlocks: summarizeDiagnosticBlocks(beforeLlmHookContext.messageBlocks),
    hookMessages: summarizeDiagnosticMessages(beforeLlmHookContext.messages),
  });
  reconcileHookContextToLoopState(loopState, beforeLlmHookContext);
  syncMessagesFromBlocks(loopState);
  traceLoopStateContext(runtime, "before_llm_final_composed", loopState, { turn, mode: "no_tools" });
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const locale = String(systemRuntime?.locale || "zh-CN");
  let modelResponse = null;
  try {
    modelResponse = await invokeLlmWithTransientRetry({
      modelState,
      turn,
      mode: "no_tools",
      invoke: ({ callbacks }) => {
        const modelMessages = filterForModelContext(messages);
        emitModelContextTrace(runtime, "llm_invoke_messages", {
          turn,
          mode: "no_tools",
          toolChoice: forceToolChoiceNone ? "none" : "",
          messages: summarizeDiagnosticMessages(modelMessages),
        });
        return invokeLlm.invoke(modelMessages, {
          callbacks,
          signal: abortSignal,
          ...(forceToolChoiceNone ? { tool_choice: "none" } : {}),
          ...resolveNonThinkingCallOverrides(
            runtime,
            forceToolChoiceNone ? "none" : "",
            modelState?.defaultModelSpec || {},
          ),
        });
      },
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
        messageStore: loopState.messageStore,
        messageBlocks: loopState.messageBlocks,
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
      messageStore: loopState.messageStore,
      messageBlocks: loopState.messageBlocks,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });
  let responseContentText = normalizeAiTextContent(modelResponse?.content, {
    additionalKwargs: modelResponse?.additional_kwargs ?? null,
    allowReasoningFallback: false,
  });
  const reasoningOnlyRetry = await maybeRetryReasoningOnlyNoTools({
    modelResponse,
    responseContentText,
    messages,
    messageHolder: loopState,
    invokeLlm,
    modelState,
    runtime,
    abortSignal,
    forceToolChoiceNone,
    eventListener,
    turn,
    locale,
  });
  if (reasoningOnlyRetry) {
    ({ modelResponse, responseContentText } = reasoningOnlyRetry);
  }
  const finalStreamingTurn = await finalizeNoToolsStreamingTurn({
    modelState,
    messages,
    messageHolder: loopState,
    modelResponse,
    responseContentText,
    turn,
    forceToolChoiceNone,
  });
  ({ modelResponse, responseContentText } = finalStreamingTurn);
  const { finalStreamResult } = finalStreamingTurn;

  const { turnMessageStore, turnTaskStore } = await commitNoToolsTurnState({
    modelState,
    loopState,
    messages,
    traces,
    modelResponse,
    responseContentText,
    turn,
  });

  return {
    output: responseContentText,
    turnTaskStore,
    turnMessageStore,
    modelMessages: messages,
    finalStreaming: finalStreamResult.streamed
      ? {
          streamed: true,
          output: responseContentText,
          mode:
            finalStreamResult.mode ||
            (forceToolChoiceNone ? "final_stream_no_tools_forced_none" : "final_stream_no_tools"),
        }
      : null,
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
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const locale = String(systemRuntime?.locale || "zh-CN");

  const { adaptedBinding, configuredToolChoice, invokeLlm, boundTools, toolMap } = prepareToolBinding({
    tools,
    modelState,
    runtime,
    eventListener,
    turn,
  });

  emitEvent(eventListener, "llm_call_start", { turn, mode: "with_tools" });

  const invokeBoundLlmWithToolChoice = createBoundLlmToolChoiceInvoker({
    adaptedBinding,
    boundTools,
    invokeLlm,
    messages,
    modelState,
    runtime,
    abortSignal,
    turn,
  });

  const llmStartedAtMs = Date.now();
  const llmStartedAt = new Date(llmStartedAtMs).toISOString();
  traceLoopStateContext(runtime, "before_llm_hook_context_input", loopState, { turn, mode: "with_tools" });
  const beforeLlmHookContext = buildHookContext(AGENT_HOOK_POINTS.BEFORE_LLM_CALL, runtime, {
    phase: "llm_call",
    turn,
    mode: "with_tools",
    status: "start",
    startedAt: llmStartedAt,
    toolChoice: configuredToolChoice || "",
    toolNames: boundTools.map((tool) => String(tool?.name || "").trim()).filter(Boolean),
    messages,
    messageStore: loopState.messageStore,
    messageBlocks: loopState.messageBlocks,
    maxTurns: Number(loopState?.maxTurns || 0),
    agentContext: modelState?.agentContext || null,
  });
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.BEFORE_LLM_CALL,
    context: beforeLlmHookContext,
  });
  emitModelContextTrace(runtime, "before_llm_hook_context_output", {
    turn,
    mode: "with_tools",
    hookBlocks: summarizeDiagnosticBlocks(beforeLlmHookContext.messageBlocks),
    hookMessages: summarizeDiagnosticMessages(beforeLlmHookContext.messages),
  });
  reconcileHookContextToLoopState(loopState, beforeLlmHookContext);
  syncMessagesFromBlocks(loopState);
  traceLoopStateContext(runtime, "before_llm_final_composed", loopState, { turn, mode: "with_tools" });

  const mainFlowFinalNoToolsInstruction =
    peekMainFlowFinalNoToolsTurnInstruction(systemRuntime);
  if (mainFlowFinalNoToolsInstruction) {
    emitEvent(eventListener, "with_tools_llm_call_skipped_for_main_flow_instruction", {
      turn,
      action: mainFlowFinalNoToolsInstruction.action,
      reason: mainFlowFinalNoToolsInstruction.reason,
      source: mainFlowFinalNoToolsInstruction.source,
    });
    return {
      mainFlowFinalNoToolsRequested: true,
      mainFlowFinalNoToolsInstruction,
      traces,
      toolMap,
    };
  }

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
        messageStore: loopState.messageStore,
        messageBlocks: loopState.messageBlocks,
        maxTurns: Number(loopState?.maxTurns || 0),
        agentContext: modelState?.agentContext || null,
      }),
    });
    ai = maybeCreateRequiredToolChoiceUnsupportedFallbackAi({
      error,
      configuredToolChoice,
      runtime,
      eventListener,
      turn,
      modelState,
    });
    if (!ai) {
      throw error;
    }
  }

  let { rawCalls, calls, aiContentText } = normalizeToolTurnAi(ai);
  const reasoningOnlyRetry = await maybeRetryReasoningOnlyWithTools({
    ai,
    calls,
    aiContentText,
    messages,
    messageHolder: loopState,
    invokeBoundLlmWithToolChoice,
    eventListener,
    turn,
    locale,
  });
  if (reasoningOnlyRetry) {
    ({ ai, rawCalls, calls, aiContentText } = reasoningOnlyRetry);
  }
  const toolCallStreamingRetry = await maybeRetryToolCallStreamingMismatch({
    ai,
    calls,
    modelState,
    invokeBoundLlmWithToolChoice,
  });
  if (toolCallStreamingRetry) {
    ({ ai, rawCalls, calls, aiContentText } = toolCallStreamingRetry);
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
      messageStore: loopState.messageStore,
      messageBlocks: loopState.messageBlocks,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });
  let finalStreamResult = null;
  if (!calls.length) {
    finalStreamResult = await maybeInvokeFinalStreamingNoTools({
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
  appendMessage(loopState, calls.length
    ? buildAssistantModelMessageForToolCalls({
        ai,
        contentText: aiContentText,
        toolCalls: calls,
      })
    : ai, { block: "incremental" });

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages, turnMessages);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const currentModelInfo = resolveCurrentModelInfo(modelState);

  const stateCommitter = createStateCommitter({
    messages,
    messageHolder: loopState,
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
    toolCalls: calls.length ? formatToolCallsForStorage(calls) : [],
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
  handleRequiredToolChoiceNotFollowed({
    rawCalls,
    adaptedBinding,
    runtime,
    eventListener,
    turn,
    currentModelInfo,
  });

  return {
    ai,
    aiContentText,
    calls,
    toolMap,
    stateCommitter,
    turnMessageStore,
    turnTaskStore,
    traces,
    finalStreaming: finalStreamResult?.streamed
      ? {
          streamed: true,
          output: aiContentText,
          mode: finalStreamResult.mode || "final_stream_after_tools_no_calls",
        }
      : null,
  };
}
