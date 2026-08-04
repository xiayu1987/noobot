/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "../../context/session/message-context-policy.js";
import { resolveMainModelFinalMessages } from "../../session/utils/context-window-normalizer.js";
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../../context/session/current-turn-store.js";
import { resolveInvokeLlm } from "../../models/index.js";
import { emitEvent } from "../../events/index.js";
import { createStateCommitter } from "../tool-execution/state-committer.js";
import { persistModelGeneratedArtifacts } from "../../artifacts/runtime/artifact-service.js";
import {
  invokeLlmWithTransientRetry,
  normalizeAiTextContent,
} from "../llm-invoker.js";
import { resolveCurrentModelInfo } from "../../models/runtime/model-manager.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import { resolveAuthoritativeModelContext } from "@noobot/context-protocol/hook-context";
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
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
import {
  appendContextMessage as appendMessage,
  replaceContextProjection as replaceMessageProjection,
} from "@noobot/context-protocol/context-mutation";
import { MODEL_CONTEXT_PROTOCOL_VERSION } from "@noobot/context-protocol/agent-context-schema";
import { emitModelContextTrace } from "../../observability/model-context-trace-emitter.js";
import {
  summarizeDiagnosticBlocks,
  summarizeDiagnosticMessages,
} from "@noobot/context-protocol/context-diagnostics";
import { peekMainFlowFinalNoToolsTurnInstruction } from "../main-flow-control.js";
import { createSessionMessageUid } from "../../context/session/message-uid.js";
import { consumeSummaryCheckpointCommand } from "../summary-checkpoint-command.js";
import {
  applyAuthoritativeMessageId,
  beginAssistantMessageEventStream,
  currentAssistantPresentationMessageId,
  emitMessageEvent,
} from "../../events/message-event-stream.js";
export { normalizeToolResultAttachments } from "./tool-result-normalizer.js";
export {
  buildAssistantModelMessageForToolCalls,
  formatToolCallsForLangChain,
  formatToolCallsForStorage,
} from "./tool-call-message.js";

function normalizeBlockList(value = []) {
  return Array.isArray(value) ? value : [];
}

function requireLoopStateModelContext(loopState = {}) {
  const modelContext = loopState?.modelContext;
  if (modelContext?.protocolVersion !== MODEL_CONTEXT_PROTOCOL_VERSION) {
    throw new Error(`agent loop requires modelContext protocolVersion=${MODEL_CONTEXT_PROTOCOL_VERSION}`);
  }
  return modelContext;
}

function assertHookContextRetainsModelContext(loopState = {}, hookContext = {}) {
  const expected = requireLoopStateModelContext(loopState);
  const modelContext = resolveAuthoritativeModelContext(hookContext);
  if (modelContext !== expected) {
    throw new Error("before_llm_call must retain the authoritative modelContext entity");
  }
  return expected;
}

function traceLoopStateContext(runtime = {}, stage = "", loopState = {}, extra = {}) {
  const modelContext = requireLoopStateModelContext(loopState);
  emitModelContextTrace(runtime, stage, {
    turn: extra.turn,
    mode: extra.mode,
    dialogProcessId: loopState?.dialogProcessId || "",
    blocks: summarizeDiagnosticBlocks(modelContext.messageBlocks),
    messages: summarizeDiagnosticMessages(modelContext.messages),
    ...extra,
  });
}

function syncMessagesFromBlocks(loopState = {}) {
  const modelContext = requireLoopStateModelContext(loopState);
  const blocks = modelContext.messageBlocks;
  if (!blocks || typeof blocks !== "object" || !Array.isArray(modelContext.messages)) {
    throw new Error("modelContext requires canonical messages and messageBlocks");
  }
  const resolved = resolveMainModelFinalMessages({
    systemMessages: normalizeBlockList(blocks.system),
    historyMessages: normalizeBlockList(blocks.history),
    incrementalMessages: normalizeBlockList(blocks.incremental),
  });
  const composed = Array.isArray(resolved?.messages) ? resolved.messages : [];
  replaceMessageProjection(modelContext, composed);
  return modelContext.messages;
}

export async function invokeNoToolsTurn({
  modelState,
  loopState,
  turn,
  forceToolChoiceNone = false,
}) {
  const modelContext = requireLoopStateModelContext(loopState);
  const messages = modelContext.messages;
  const {
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
    modelContext,
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
    hookBlocks: summarizeDiagnosticBlocks(beforeLlmHookContext.modelContext?.messageBlocks),
    hookMessages: summarizeDiagnosticMessages(beforeLlmHookContext.modelContext?.messages),
  });
  assertHookContextRetainsModelContext(loopState, beforeLlmHookContext);
  await consumeSummaryCheckpointCommand({ runtime, loopState, eventListener, turn });
  syncMessagesFromBlocks(loopState);
  traceLoopStateContext(runtime, "before_llm_final_composed", loopState, { turn, mode: "no_tools" });
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const locale = String(systemRuntime?.locale || "zh-CN");
  let modelResponse = null;
  const assistantMessageId = beginAssistantMessageEventStream(runtime, { turn });
  const presentationMessageId = currentAssistantPresentationMessageId(runtime);
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
        modelContext,
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
      modelContext,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState?.agentContext || null,
    }),
  });
  await consumeSummaryCheckpointCommand({ runtime, loopState, eventListener, turn });
  let responseContentText = normalizeAiTextContent(modelResponse?.content, {
    additionalKwargs: modelResponse?.additional_kwargs ?? null,
    allowReasoningFallback: false,
  });
  const reasoningOnlyRetry = await maybeRetryReasoningOnlyNoTools({
    modelResponse,
    responseContentText,
    messages,
    messageHolder: modelContext,
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
    messageHolder: modelContext,
    modelResponse,
    responseContentText,
    turn,
    forceToolChoiceNone,
  });
  ({ modelResponse, responseContentText } = finalStreamingTurn);
  applyAuthoritativeMessageId(modelResponse, assistantMessageId);
  const { finalStreamResult } = finalStreamingTurn;

  const { turnMessageStore, turnTaskStore } = await commitNoToolsTurnState({
    modelState,
    loopState,
    messages,
    traces,
    modelResponse,
    responseContentText,
    turn,
    messageId: assistantMessageId,
    presentationMessageId,
  });
  return {
    output: responseContentText,
    assistantMessageId,
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
  const modelContext = requireLoopStateModelContext(loopState);
  const messages = modelContext.messages;
  const {
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
    modelContext,
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
    hookBlocks: summarizeDiagnosticBlocks(beforeLlmHookContext.modelContext?.messageBlocks),
    hookMessages: summarizeDiagnosticMessages(beforeLlmHookContext.modelContext?.messages),
  });
  assertHookContextRetainsModelContext(loopState, beforeLlmHookContext);
  await consumeSummaryCheckpointCommand({ runtime, loopState, eventListener, turn });
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
  const assistantMessageId = beginAssistantMessageEventStream(runtime, { turn });
  const presentationMessageId = currentAssistantPresentationMessageId(runtime);
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
        modelContext,
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
    messageHolder: modelContext,
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
  applyAuthoritativeMessageId(ai, assistantMessageId);
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
      modelContext,
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
  const assistantMessageUid = createSessionMessageUid();
  if (!calls.length) {
    if (!ai.additional_kwargs || typeof ai.additional_kwargs !== "object") ai.additional_kwargs = {};
    ai.additional_kwargs.noobotMessageId = assistantMessageUid;
  }
  appendMessage(modelContext, calls.length
    ? buildAssistantModelMessageForToolCalls({
        ai,
        contentText: aiContentText,
        toolCalls: calls,
        noobotMessageId: assistantMessageUid,
      })
    : ai, { block: "incremental" });

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const currentModelInfo = resolveCurrentModelInfo(modelState);

  const stateCommitter = createStateCommitter({
    messages,
    messageHolder: modelContext,
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
    messageId: assistantMessageId,
    messageUid: assistantMessageUid,
    presentationMessageId,
    chatPresentation: calls.length === 0,
  });

  const mainModelToolTurnContent = String(aiContentText || "").trim();
  if (
    eventListener?.onEvent &&
    mainModelToolTurnContent &&
    calls.length
  ) {
    emitMessageEvent(eventListener, runtime, "main_model_content", {
      turn,
      text: mainModelToolTurnContent,
      output: mainModelToolTurnContent,
      eventId: `model-content:${assistantMessageId || presentationMessageId || "turn"}`,
    });
  }

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
    assistantMessageId,
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
