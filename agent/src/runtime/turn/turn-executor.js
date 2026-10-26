/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterForModelContext } from "@noobot/context-protocol/policy/message";
import { MODEL_CONTEXT_SEQUENCE_POLICY, requireModelSpec } from "@noobot/model-protocol";
import {
  buildDualLaneModelContext,
  MODEL_CONTEXT_LANE,
} from "@noobot/context-protocol/assembly/dual-lane";
import {
  requireCurrentTurnMessagesStore,
  requireCurrentTurnTasksStore,
} from "./current-turn-ledger.js";
import { emitEvent } from "../../events/index.js";
import { createStateCommitter } from "../tool-execution/state-committer.js";
import { persistModelGeneratedArtifacts } from "../../artifacts/runtime/artifact-service.js";
import { createStreamingCallbacks } from "../../models/runtime/model-manager.js";
import { resolveCurrentModelInfo } from "../../models/runtime/current-model-info.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_PHASE_STATUS, HOOK_POINT } from "@noobot/hook-protocol";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import { resolveAuthoritativeModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import { resolveNonThinkingCallOverrides } from "./tool-choice-strategy.js";
import {
  buildAssistantModelMessageForToolCalls,
  formatToolCallsForStorage,
} from "./tool-call-message.js";
import { prepareToolBinding } from "./tool-binding-preparer.js";
import { createBoundLlmToolChoiceInvoker } from "./tool-invoke-strategy.js";
import { commitNoToolsTurnState } from "./no-tools-commit-stage.js";
import { applyRequiredToolChoiceUnsupportedRetryDecision } from "./tool-choice-retry-stage.js";
import { handleRequiredToolChoiceNotFollowed } from "./tool-choice-required-stage.js";
import {
  isRecoverableNoFinalResponse,
  MAIN_FLOW_NO_FINAL_RESPONSE_RETRY,
} from "./no-final-response-recovery.js";
import {
  appendContextMessage as appendMessage,
  replaceContextProjection as replaceMessageProjection,
} from "@noobot/context-protocol/mutation/context";
import { requireActiveModelContext } from "../active-model-context.js";
import { emitModelContextTrace } from "../../observability/model-context-trace-emitter.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import {
  summarizeDiagnosticBlocks,
  summarizeDiagnosticMessages,
} from "@noobot/context-protocol/assembly/diagnostics";
import { peekMainFlowFinalNoToolsTurnInstruction } from "../main-flow-control.js";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { consumeSummaryCheckpointCommand } from "../summary-checkpoint-command.js";
import { projectToolDefinitionContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import {
  beginAssistantMessageEventStream,
  currentAssistantPresentationMessageId,
  discardAssistantDraft,
} from "../../events/message-event-stream.js";
import { CONTROL_TOOL_NAMES } from "../../tools/constants/index.js";
import { text, isObjectLike } from "@noobot/shared/value";
export {
  buildAssistantModelMessageForToolCalls,
  formatToolCallsForLangChain,
  formatToolCallsForStorage,
} from "./tool-call-message.js";

function assertHookContextRetainsModelContext(runtime, hookContext) {
  const expected = requireActiveModelContext(runtime);
  const modelContext = resolveAuthoritativeModelContext(hookContext);
  if (modelContext !== expected) {
    throw new Error("before_llm_call must retain the authoritative modelContext entity");
  }
  return expected;
}

function traceActiveModelContext(runtime, stage, extra) {
  const modelContext = requireActiveModelContext(runtime);
  emitModelContextTrace(runtime.eventListener, stage, {
    turn: extra.turn,
    mode: extra.mode,
    blocks: summarizeDiagnosticBlocks(modelContext.messageBlocks),
    messages: summarizeDiagnosticMessages(modelContext.messages),
    ...extra,
  });
}

function syncMessagesFromBlocks(runtime) {
  const modelContext = requireActiveModelContext(runtime);
  const blocks = modelContext.messageBlocks;
  if (!isObjectLike(blocks) || !Array.isArray(modelContext.messages)) {
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

function requestedStreaming(modelState) {
  return modelState.runtime.runConfig.streaming;
}

async function invokeNoToolsModel({
  modelState,
  loopState,
  turn,
  forceToolChoiceNone,
  llmStartedAtMs,
  llmStartedAt,
}) {
  const modelContext = requireActiveModelContext(modelState.runtime);
  const { runtime } = modelState;
  const { eventListener, abortSignal } = runtime;
  try {
    const protocolResponse = await modelState.modelPort.invoke({
      messages: filterForModelContext(modelContext.messages),
      options: {
        streaming: requestedStreaming(modelState),
        callbacks: requestedStreaming(modelState)
          ? createStreamingCallbacks(eventListener, runtime)
          : undefined,
        signal: abortSignal,
        invoke: {
          ...(forceToolChoiceNone ? { tool_choice: "none" } : {}),
          ...resolveNonThinkingCallOverrides(
            runtime,
            forceToolChoiceNone ? "none" : "",
            requireModelSpec(modelState.activeModelSpec),
          ),
        },
      },
      invocation: {
        flow: "agent.main",
        purpose: "no_tools",
        domain: "primary",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
      },
      policies: { retry: MAIN_FLOW_NO_FINAL_RESPONSE_RETRY },
    });
    return protocolResponse.output;
  } catch (error) {
    if (isRecoverableNoFinalResponse(error, runtime)) throw error;
    await runAgentRuntimeHook({
      runtime,
      point: HOOK_POINT.AGENT.LLM_CALL_ERROR,
      context: buildHookContext(HOOK_POINT.AGENT.LLM_CALL_ERROR, runtime, {
        phase: "llm_call",
        turn,
        mode: "no_tools",
        status: HOOK_PHASE_STATUS.ERROR,
        startedAt: llmStartedAt,
        endedAt: new Date(Date.now()).toISOString(),
        durationMs: Date.now() - llmStartedAtMs,
        error,
        maxTurns: Number(loopState?.maxTurns || 0),
        agentContext: modelState.agentContext,
      }),
    });
    throw error;
  }
}

export async function invokeNoToolsTurn({
  modelState,
  loopState,
  turn,
  forceToolChoiceNone = false,
}) {
  const modelContext = requireActiveModelContext(modelState.runtime);
  const { traces } = loopState;
  const { runtime } = modelState;
  const { eventListener } = runtime;

  emitEvent(eventListener, "llm_call_start", { turn, mode: "no_tools" });
  const llmStartedAtMs = Date.now();
  const llmStartedAt = new Date(llmStartedAtMs).toISOString();
  traceActiveModelContext(runtime, "before_llm_hook_context_input", {
    turn,
    mode: "no_tools",
  });
  const beforeLlmHookContext = buildHookContext(HOOK_POINT.AGENT.BEFORE_LLM_CALL, runtime, {
    phase: "llm_call",
    turn,
    mode: "no_tools",
    status: HOOK_PHASE_STATUS.RUNNING,
    startedAt: llmStartedAt,
    forceToolChoiceNone,
    maxTurns: Number(loopState?.maxTurns || 0),
    agentContext: modelState.agentContext,
  });
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    context: beforeLlmHookContext,
  });
  emitModelContextTrace(runtime.eventListener, "before_llm_hook_context_output", {
    turn,
    mode: "no_tools",
    hookBlocks: summarizeDiagnosticBlocks(beforeLlmHookContext.modelContext?.messageBlocks),
    hookMessages: summarizeDiagnosticMessages(beforeLlmHookContext.modelContext?.messages),
  });
  assertHookContextRetainsModelContext(runtime, beforeLlmHookContext);
  await consumeSummaryCheckpointCommand({ runtime, eventListener, turn });
  syncMessagesFromBlocks(runtime);
  traceActiveModelContext(runtime, "before_llm_final_composed", {
    turn,
    mode: "no_tools",
  });

  const modelMessageId = beginAssistantMessageEventStream(runtime, {
    turn,
    ...resolveCurrentModelInfo(modelState),
  });
  const presentationMessageId = currentAssistantPresentationMessageId(runtime);
  const modelResponse = await invokeNoToolsModel({
    modelState,
    loopState,
    turn,
    forceToolChoiceNone,
    llmStartedAtMs,
    llmStartedAt,
  });
  const llmEndedAtMs = Date.now();
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.AFTER_LLM_CALL,
    context: buildHookContext(HOOK_POINT.AGENT.AFTER_LLM_CALL, runtime, {
      phase: "llm_call",
      turn,
      mode: "no_tools",
      status: HOOK_PHASE_STATUS.SUCCESS,
      startedAt: llmStartedAt,
      endedAt: new Date(llmEndedAtMs).toISOString(),
      durationMs: llmEndedAtMs - llmStartedAtMs,
      modelResponse,
      calls: [],
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState.agentContext,
    }),
  });
  await consumeSummaryCheckpointCommand({ runtime, eventListener, turn });
  const responseContentText = String(modelResponse?.text || "");
  const assistantMessageUid = createMessageUid();
  appendMessage(
    modelContext,
    buildAssistantModelMessageForToolCalls({
      ai: modelResponse,
      contentText: responseContentText,
      toolCalls: [],
      messageUid: assistantMessageUid,
      modelMessageId,
    }),
    { block: "incremental" },
  );
  const { turnMessageStore, turnTaskStore } = await commitNoToolsTurnState({
    modelState,
    loopState,
    traces,
    modelResponse,
    responseContentText,
    turn,
    modelMessageId,
    messageUid: assistantMessageUid,
    presentationMessageId,
  });
  return {
    output: responseContentText,
    modelMessageId,
    turnTaskStore,
    turnMessageStore,
    modelMessages: modelContext.messages,
  };
}

export async function invokeWithToolsTurn({ modelState, loopState, turn }) {
  const modelContext = requireActiveModelContext(modelState.runtime);
  const messages = modelContext.messages;
  const { traces, tools, currentTurnMessages, currentTurnTasks } = loopState;
  const { dialogProcessId } = modelContext.activeTurnIdentity;
  const { runtime } = modelState;
  const { eventListener } = runtime;
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);

  const { adaptedBinding, configuredToolChoice, boundTools, toolMap } = prepareToolBinding({
    tools,
    modelState,
    runtime,
    turn,
  });

  const invokeBoundLlmWithToolChoice = createBoundLlmToolChoiceInvoker({
    adaptedBinding,
    boundTools,
    messages,
    modelState,
    runtime,
    turn,
  });

  const llmStartedAtMs = Date.now();
  const llmStartedAt = new Date(llmStartedAtMs).toISOString();
  traceActiveModelContext(runtime, "before_llm_hook_context_input", {
    turn,
    mode: "with_tools",
  });
  const beforeLlmHookContext = buildHookContext(HOOK_POINT.AGENT.BEFORE_LLM_CALL, runtime, {
    phase: "llm_call",
    turn,
    mode: "with_tools",
    status: HOOK_PHASE_STATUS.RUNNING,
    startedAt: llmStartedAt,
    toolChoice: configuredToolChoice || "",
    toolNames: boundTools.map((tool) => text(tool?.name)).filter(Boolean),
    maxTurns: Number(loopState?.maxTurns || 0),
    agentContext: modelState.agentContext,
  });
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    context: beforeLlmHookContext,
  });
  emitModelContextTrace(runtime.eventListener, "before_llm_hook_context_output", {
    turn,
    mode: "with_tools",
    hookBlocks: summarizeDiagnosticBlocks(beforeLlmHookContext.modelContext?.messageBlocks),
    hookMessages: summarizeDiagnosticMessages(beforeLlmHookContext.modelContext?.messages),
  });
  assertHookContextRetainsModelContext(runtime, beforeLlmHookContext);
  await consumeSummaryCheckpointCommand({ runtime, eventListener, turn });
  syncMessagesFromBlocks(runtime);
  traceActiveModelContext(runtime, "before_llm_final_composed", {
    turn,
    mode: "with_tools",
  });

  const mainFlowFinalNoToolsInstruction = peekMainFlowFinalNoToolsTurnInstruction(runtime);
  if (mainFlowFinalNoToolsInstruction) {
    emitEvent(eventListener, "with_tools_llm_call_skipped_for_main_flow_instruction", {
      turn,
      action: mainFlowFinalNoToolsInstruction.action,
      reason: mainFlowFinalNoToolsInstruction.reason,
      source: mainFlowFinalNoToolsInstruction.source,
    });
    return {
      mainFlowFinalNoToolsRequested: true,
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
  const modelMessageId = beginAssistantMessageEventStream(runtime, {
    turn,
    ...resolveCurrentModelInfo(modelState),
  });
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
      if (isRecoverableNoFinalResponse(error, runtime)) throw error;
      await runAgentRuntimeHook({
        runtime,
        point: HOOK_POINT.AGENT.LLM_CALL_ERROR,
        context: buildHookContext(HOOK_POINT.AGENT.LLM_CALL_ERROR, runtime, {
          phase: "llm_call",
          turn,
          modelLoopRound,
          mode: "with_tools",
          status: HOOK_PHASE_STATUS.ERROR,
          startedAt: llmStartedAt,
          endedAt: new Date(Date.now()).toISOString(),
          durationMs: Date.now() - llmStartedAtMs,
          toolChoice: configuredToolChoice || "",
          error,
          maxTurns: Number(loopState?.maxTurns || 0),
          agentContext: modelState.agentContext,
        }),
      });
      throw error;
    }
    try {
      ai = await invokeBoundLlmWithToolChoice("auto", "with_tools_required_retry");
    } catch (retryError) {
      if (isRecoverableNoFinalResponse(retryError, runtime)) throw retryError;
      await runAgentRuntimeHook({
        runtime,
        point: HOOK_POINT.AGENT.LLM_CALL_ERROR,
        context: buildHookContext(HOOK_POINT.AGENT.LLM_CALL_ERROR, runtime, {
          phase: "llm_call",
          turn,
          modelLoopRound,
          mode: "with_tools_required_retry",
          status: HOOK_PHASE_STATUS.ERROR,
          startedAt: llmStartedAt,
          endedAt: new Date(Date.now()).toISOString(),
          durationMs: Date.now() - llmStartedAtMs,
          toolChoice: "auto",
          error: retryError,
          maxTurns: Number(loopState?.maxTurns || 0),
          agentContext: modelState.agentContext,
        }),
      });
      throw retryError;
    }
  }

  const calls = ai.toolCalls.map((call) =>
    projectToolDefinitionContextPolicy(call, toolMap.get(call.name)),
  );

  const controlToolCall =
    calls.length > 1 ? calls.find((call) => CONTROL_TOOL_NAMES.includes(call.name)) : null;
  if (controlToolCall) {
    discardAssistantDraft(runtime, modelMessageId);
    emitEvent(eventListener, "llm_call_end", {
      turn,
      modelLoopRound,
      mode: "with_tools",
      toolCallCount: calls.length,
    });
    return {
      rejectedControlToolBatch: {
        controlToolName: controlToolCall.name,
        toolCallCount: calls.length,
      },
      traces,
      toolMap,
    };
  }
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.AFTER_LLM_CALL,
    context: buildHookContext(HOOK_POINT.AGENT.AFTER_LLM_CALL, runtime, {
      phase: "llm_call",
      turn,
      modelLoopRound,
      mode: "with_tools",
      status: HOOK_PHASE_STATUS.SUCCESS,
      startedAt: llmStartedAt,
      endedAt: new Date(Date.now()).toISOString(),
      durationMs: Date.now() - llmStartedAtMs,
      toolChoice: configuredToolChoice || "",
      modelResponse: ai,
      calls,
      maxTurns: Number(loopState?.maxTurns || 0),
      agentContext: modelState.agentContext,
    }),
  });
  const finalAiContentText = ai.text;
  const assistantMessageUid = createMessageUid();
  appendMessage(
    modelContext,
    buildAssistantModelMessageForToolCalls({
      ai,
      contentText: finalAiContentText,
      toolCalls: calls,
      messageUid: assistantMessageUid,
      modelMessageId,
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
    agentContext: modelState.agentContext,
  });

  await stateCommitter.pushAssistantMessage({
    content: finalAiContentText,
    rawModelContent: ai?.content ?? ai?.text ?? null,
    modelAdditionalKwargs: ai?.responseReasoning ? { reasoning: ai.responseReasoning } : null,
    modelResponseMetadata: {
      ...(ai?.responseOutput ? { output: ai.responseOutput } : {}),
      ...(ai?.finishReason ? { finishReason: ai.finishReason } : {}),
      ...(ai?.usage ? { usage: ai.usage } : {}),
    },
    type: calls.length ? "tool_call" : "message",
    toolCalls: calls.length ? formatToolCallsForStorage(calls) : [],
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
    modelMessageId,
    messageUid: assistantMessageUid,
    presentationMessageId,
    chatPresentation: calls.length === 0,
    attachments: await persistModelGeneratedArtifacts({
      aiContent: ai?.text,
      runtime,
      eventListener,
      dialogProcessId,
      modelMessageId,
      turnMessageStore,
    }),
  });

  emitEvent(eventListener, "llm_call_end", {
    turn,
    modelLoopRound,
    mode: "with_tools",
    toolCallCount: calls.length,
  });
  handleRequiredToolChoiceNotFollowed({
    toolCalls: ai.toolCalls,
    adaptedBinding,
    runtime,
    eventListener,
    turn,
    currentModelInfo,
  });

  return {
    ai,
    modelMessageId,
    aiContentText: finalAiContentText,
    calls,
    toolMap,
    stateCommitter,
    turnMessageStore,
    turnTaskStore,
    traces,
  };
}
