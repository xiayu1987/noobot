/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "@noobot/context-protocol/message-policy";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import {
  buildDualLaneModelContext,
  MODEL_CONTEXT_LANE,
} from "@noobot/context-protocol/dual-lane-context";
import {
  requireCurrentTurnMessagesStore,
  requireCurrentTurnTasksStore,
} from "./current-turn-ledger.js";
import { emitEvent } from "../../events/index.js";
import { createStateCommitter } from "../tool-execution/state-committer.js";
import { persistModelGeneratedArtifacts } from "../../artifacts/runtime/artifact-service.js";
import { resolveCurrentModelInfo } from "../../models/runtime/model-manager.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import { resolveAuthoritativeModelContext } from "@noobot/context-protocol/hook-context";
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import { resolveNonThinkingCallOverrides } from "./tool-choice-strategy.js";
import {
  buildAssistantModelMessageForToolCalls,
  formatToolCallsForStorage,
} from "./tool-call-message.js";
import { maybeInvokeFinalStreamingNoTools } from "./turn-stage.js";
import { prepareToolBinding } from "./tool-binding-preparer.js";
import { createBoundLlmToolChoiceInvoker } from "./tool-invoke-strategy.js";
import { normalizeToolTurnAi } from "./tool-turn-normalizer.js";
import { finalizeNoToolsStreamingTurn } from "./no-tools-final-stream-stage.js";
import { commitNoToolsTurnState } from "./no-tools-commit-stage.js";
import { applyRequiredToolChoiceUnsupportedRetryDecision } from "./tool-choice-retry-stage.js";
import { handleRequiredToolChoiceNotFollowed } from "./tool-choice-required-stage.js";
import {
  appendContextMessage as appendMessage,
  replaceContextProjection as replaceMessageProjection,
} from "@noobot/context-protocol/context-mutation";
import { MODEL_CONTEXT_PROTOCOL_VERSION } from "@noobot/context-protocol/agent-context-schema";
import { emitModelContextTrace } from "../../observability/model-context-trace-emitter.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
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
export {
  buildAssistantModelMessageForToolCalls,
  formatToolCallsForLangChain,
  formatToolCallsForStorage,
} from "./tool-call-message.js";

function requireLoopStateModelContext(loopState = {}) {
  const modelContext = loopState?.modelContext;
  if (modelContext?.protocolVersion !== MODEL_CONTEXT_PROTOCOL_VERSION) {
    throw new Error(
      `agent loop requires modelContext protocolVersion=${MODEL_CONTEXT_PROTOCOL_VERSION}`,
    );
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
  const resolved = buildDualLaneModelContext({
    lane: MODEL_CONTEXT_LANE.PRIMARY,
    modelContext,
    primaryHistoryLimit: TURN_THRESHOLDS.session.mainModelHistoryRoundLimit,
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
  const { traces, turnMessages, currentTurnMessages, currentTurnTasks, dialogProcessId } =
    loopState;
  const { eventListener, runtime, abortSignal } = modelState;

  emitEvent(eventListener, "llm_call_start", { turn, mode: "no_tools" });
  const llmStartedAtMs = Date.now();
  const llmStartedAt = new Date(llmStartedAtMs).toISOString();
  traceLoopStateContext(runtime, "before_llm_hook_context_input", loopState, {
    turn,
    mode: "no_tools",
  });
  const beforeLlmHookContext = buildHookContext(HOOK_POINT.AGENT.BEFORE_LLM_CALL, runtime, {
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
    point: HOOK_POINT.AGENT.BEFORE_LLM_CALL,
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
  traceLoopStateContext(runtime, "before_llm_final_composed", loopState, {
    turn,
    mode: "no_tools",
  });
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const locale = String(systemRuntime?.locale || "zh-CN");
  let modelResponse = null;
  const assistantMessageId = beginAssistantMessageEventStream(runtime, { turn });
  const presentationMessageId = currentAssistantPresentationMessageId(runtime);
  try {
    const protocolResponse = await modelState.modelPort.invoke({
      messages: filterForModelContext(messages),
      options: {
        streaming: false,
        signal: abortSignal,
        invoke: {
          ...(forceToolChoiceNone ? { tool_choice: "none" } : {}),
          ...resolveNonThinkingCallOverrides(
            runtime,
            forceToolChoiceNone ? "none" : "",
            modelState?.defaultModelSpec || {},
          ),
        },
      },
      invocation: {
        flow: "agent.main",
        purpose: "no_tools",
        domain: "primary",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
      },
    });
    modelResponse = protocolResponse.output;
  } catch (error) {
    await runAgentRuntimeHook({
      runtime,
      point: HOOK_POINT.AGENT.LLM_CALL_ERROR,
      context: buildHookContext(HOOK_POINT.AGENT.LLM_CALL_ERROR, runtime, {
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
    point: HOOK_POINT.AGENT.AFTER_LLM_CALL,
    context: buildHookContext(HOOK_POINT.AGENT.AFTER_LLM_CALL, runtime, {
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
  let responseContentText = String(modelResponse?.text || "");
  const finalStreamingTurn = await finalizeNoToolsStreamingTurn({
    modelState,
    messages,
    modelResponse,
    responseContentText,
    turn,
    forceToolChoiceNone,
  });
  ({ modelResponse, responseContentText } = finalStreamingTurn);
  appendMessage(
    modelContext,
    buildAssistantModelMessageForToolCalls({
      ai: modelResponse,
      contentText: responseContentText,
      toolCalls: [],
      noobotMessageId: assistantMessageId,
    }),
    { block: "incremental" },
  );
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
  const { traces, tools, turnMessages, currentTurnMessages, currentTurnTasks, dialogProcessId } =
    loopState;
  const { eventListener, runtime, abortSignal } = modelState;
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const locale = String(systemRuntime?.locale || "zh-CN");

  const { adaptedBinding, configuredToolChoice, boundTools, toolMap } = prepareToolBinding({
    tools,
    modelState,
    runtime,
    eventListener,
    turn,
  });

  const invokeBoundLlmWithToolChoice = createBoundLlmToolChoiceInvoker({
    adaptedBinding,
    boundTools,
    messages,
    modelState,
    runtime,
    abortSignal,
    turn,
  });

  const llmStartedAtMs = Date.now();
  const llmStartedAt = new Date(llmStartedAtMs).toISOString();
  traceLoopStateContext(runtime, "before_llm_hook_context_input", loopState, {
    turn,
    mode: "with_tools",
  });
  const beforeLlmHookContext = buildHookContext(HOOK_POINT.AGENT.BEFORE_LLM_CALL, runtime, {
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
    point: HOOK_POINT.AGENT.BEFORE_LLM_CALL,
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
  traceLoopStateContext(runtime, "before_llm_final_composed", loopState, {
    turn,
    mode: "with_tools",
  });

  const mainFlowFinalNoToolsInstruction = peekMainFlowFinalNoToolsTurnInstruction(systemRuntime);
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

  const currentModelLoopRound = Number(systemRuntime?.modelLoopRound || 0);
  const modelLoopRound =
    Number.isFinite(currentModelLoopRound) && currentModelLoopRound >= 0
      ? currentModelLoopRound + 1
      : 1;
  systemRuntime.modelLoopRound = modelLoopRound;
  emitEvent(eventListener, "main_model_loop_started", { turn, modelLoopRound });
  emitEvent(eventListener, "llm_call_start", { turn, modelLoopRound, mode: "with_tools" });

  let ai = null;
  const assistantMessageId = beginAssistantMessageEventStream(runtime, { turn });
  const presentationMessageId = currentAssistantPresentationMessageId(runtime);
  try {
    ai = await invokeBoundLlmWithToolChoice();
  } catch (error) {
    const retryRequiredToolChoice = applyRequiredToolChoiceUnsupportedRetryDecision({
      error,
      configuredToolChoice,
      runtime,
      eventListener,
      turn,
      modelState,
    });
    if (!retryRequiredToolChoice) {
      await runAgentRuntimeHook({
        runtime,
        point: HOOK_POINT.AGENT.LLM_CALL_ERROR,
        context: buildHookContext(HOOK_POINT.AGENT.LLM_CALL_ERROR, runtime, {
          phase: "llm_call",
          turn,
          modelLoopRound,
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
      throw error;
    }
    try {
      ai = await invokeBoundLlmWithToolChoice("auto", null, "with_tools_required_retry");
    } catch (retryError) {
      await runAgentRuntimeHook({
        runtime,
        point: HOOK_POINT.AGENT.LLM_CALL_ERROR,
        context: buildHookContext(HOOK_POINT.AGENT.LLM_CALL_ERROR, runtime, {
          phase: "llm_call",
          turn,
          modelLoopRound,
          mode: "with_tools_required_retry",
          status: "error",
          startedAt: llmStartedAt,
          endedAt: new Date(Date.now()).toISOString(),
          durationMs: Date.now() - llmStartedAtMs,
          toolChoice: "auto",
          error: retryError,
          modelContext,
          maxTurns: Number(loopState?.maxTurns || 0),
          agentContext: modelState?.agentContext || null,
        }),
      });
      throw retryError;
    }
  }

  const { rawCalls, calls, aiContentText: normalizedAiContentText } = normalizeToolTurnAi(ai);
  ai = applyAuthoritativeMessageId(ai, assistantMessageId);
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.AFTER_LLM_CALL,
    context: buildHookContext(HOOK_POINT.AGENT.AFTER_LLM_CALL, runtime, {
      phase: "llm_call",
      turn,
      modelLoopRound,
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
      fallbackText: normalizedAiContentText,
      turn,
      mode: "final_stream_after_tools_no_calls",
    });
    ai = finalStreamResult.ai || ai;
  }
  const finalAiContentText = finalStreamResult?.text || normalizedAiContentText;
  const assistantMessageUid = createSessionMessageUid();
  if (!calls.length) {
    ai = {
      ...ai,
      messageId: assistantMessageUid,
    };
  }
  appendMessage(
    modelContext,
    buildAssistantModelMessageForToolCalls({
      ai,
      contentText: finalAiContentText,
      toolCalls: calls,
      noobotMessageId: assistantMessageUid,
    }),
    { block: "incremental" },
  );

  const turnMessageStore = requireCurrentTurnMessagesStore(currentTurnMessages);
  const turnTaskStore = requireCurrentTurnTasksStore(currentTurnTasks);
  const currentModelInfo = resolveCurrentModelInfo(modelState);

  const stateCommitter = createStateCommitter({
    modelContext,
    traces,
    turnMessageStore,
    dialogProcessId,
    runtime,
    agentContext: modelState?.agentContext || null,
  });

  await stateCommitter.pushAssistantMessage({
    content: finalAiContentText,
    rawModelContent: ai?.text ?? null,
    modelAdditionalKwargs: { reasoning: ai?.reasoning || "" },
    modelResponseMetadata: { finishReason: ai?.finishReason || "", usage: ai?.usage || {} },
    type: calls.length ? "tool_call" : "message",
    toolCalls: calls.length ? formatToolCallsForStorage(calls) : [],
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
    messageId: assistantMessageId,
    messageUid: assistantMessageUid,
    presentationMessageId,
    chatPresentation: calls.length === 0,
    attachments: await persistModelGeneratedArtifacts({
      aiContent: ai?.text,
      runtime,
      eventListener,
      dialogProcessId,
      messageId: assistantMessageId,
      turnMessageStore,
    }),
  });

  const mainModelToolTurnContent = String(finalAiContentText || "").trim();
  if (eventListener?.onEvent && mainModelToolTurnContent && calls.length) {
    emitMessageEvent(eventListener, runtime, "main_model_content", {
      turn,
      text: mainModelToolTurnContent,
      output: mainModelToolTurnContent,
      eventId: `model-content:${assistantMessageId || presentationMessageId || "turn"}`,
    });
  }

  emitEvent(eventListener, "llm_call_end", {
    turn,
    modelLoopRound,
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
    aiContentText: finalAiContentText,
    calls,
    toolMap,
    stateCommitter,
    turnMessageStore,
    turnTaskStore,
    traces,
    finalStreaming: finalStreamResult?.streamed
      ? {
          streamed: true,
          output: finalAiContentText,
          mode: finalStreamResult.mode || "final_stream_after_tools_no_calls",
        }
      : null,
  };
}
