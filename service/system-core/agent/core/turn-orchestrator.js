/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filterSummarizedMessages,
  markCurrentTurnModelMessagesSummarized,
  markCurrentTurnStoreSummarized,
  markCurrentTurnArraySummarized,
} from "../../context/summarized-message-policy.js";
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../../context/current-turn-store.js";
import {
  resolveInvokeLlm,
  adaptToolsForBinding,
  appendToolCompatibilityLog,
} from "../../model/index.js";
import { emitEvent } from "../../event/index.js";
import { tEngine } from "./i18n-adapter.js";
import {
  extractAttachmentMetasFromToolResult,
  persistModelGeneratedArtifacts,
} from "./media/artifact-service.js";
import { resolveCurrentModelInfo, resolveLlmForTurn } from "./model/model-manager.js";
import { createStateCommitter } from "./execution/state-committer.js";
import { executeToolCall } from "./execution/tool-runner.js";
import { assertNotAborted } from "./utils/error-utils.js";
import { invokeLlmWithTransientRetry, normalizeAiTextContent } from "./llm-invoker.js";
import { TASK_SUMMARY_TOOL_NAME } from "./constants.js";
import { REQUEST_HELP_TOOL_NAME } from "../../tools/request-help-tool.js";
import {
  removePhaseSummaryPromptMessages,
  maybeRequestPhaseSummary,
  maybePromptHelpToolByLoop,
  maybePromptHelpToolByFailure,
} from "./loop-control.js";

// ── Message Summarization ──

function autoMarkCurrentTurnSummarized({
  turnMessageStore = null,
  fallbackMessages = [],
}) {
  if (turnMessageStore) {
    markCurrentTurnStoreSummarized(turnMessageStore, {
      taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
    });
    return turnMessageStore.toArray();
  }
  return markCurrentTurnArraySummarized(fallbackMessages, {
    taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
  });
}

function finalizeTurnMessagesBeforeReturn({
  modelMessages = [],
  turnMessageStore = null,
  fallbackMessages = [],
} = {}) {
  markCurrentTurnModelMessagesSummarized(modelMessages, {
    taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
  });
  return autoMarkCurrentTurnSummarized({
    turnMessageStore,
    fallbackMessages,
  });
}

/**
 * Centralized loop result builder.
 * Eliminates duplicated finalizeTurnMessagesBeforeReturn calls and
 * turnMessages/turnTasks assignments across all return paths.
 */
function buildLoopResult({
  output,
  traces,
  loopState,
  turnTaskStore = null,
  turnMessageStore = null,
  modelMessages = [],
} = {}) {
  const finalTurnMessages = finalizeTurnMessagesBeforeReturn({
    modelMessages,
    turnMessageStore,
    fallbackMessages: Array.isArray(loopState?.turnMessages) ? loopState.turnMessages : [],
  });
  return {
    output,
    traces,
    turnMessages: finalTurnMessages,
    turnTasks: turnTaskStore
      ? turnTaskStore.toArray()
      : Array.isArray(loopState?.turnTasks)
        ? loopState.turnTasks
        : [],
  };
}

// ── No-Tools Invocation ──

async function _invokeNoTools({ modelState, loopState, turn }) {
  const { messages, traces, turnMessages, currentTurnMessages, currentTurnTasks, dialogProcessId, errorLogger } = loopState;
  const { eventListener, runtime, abortSignal } = modelState;

  const invokeLlm = resolveInvokeLlm(modelState, "no_tools");
  emitEvent(eventListener, "llm_call_start", { turn, mode: "no_tools" });
  const modelResponse = await invokeLlmWithTransientRetry({
    modelState,
    turn,
    mode: "no_tools",
    invoke: ({ callbacks }) =>
      invokeLlm.invoke(
        filterSummarizedMessages(messages),
        { callbacks, signal: abortSignal },
      ),
  });
  const responseContentText = normalizeAiTextContent(modelResponse?.content);
  messages.push(modelResponse);

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages, turnMessages);
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const stateCommitter = createStateCommitter({ messages, traces, turnMessageStore, dialogProcessId, runtime });

  stateCommitter.pushAssistantMessage({
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

  return buildLoopResult({
    output: responseContentText,
    traces,
    loopState,
    turnTaskStore,
    turnMessageStore,
    modelMessages: messages,
  });
}

// ── Tools Invocation ──

async function _invokeWithTools({ modelState, loopState, turn }) {
  const { messages, traces, tools, turnMessages, currentTurnMessages, currentTurnTasks, dialogProcessId } = loopState;
  const { eventListener, runtime, abortSignal } = modelState;
  const invokeLlm = resolveInvokeLlm(modelState, "with_tools");

  const adaptedBinding = adaptToolsForBinding(tools, modelState);
  const boundTools = Array.isArray(adaptedBinding?.tools)
    ? adaptedBinding.tools
    : [];
  const toolMap = new Map(boundTools.map((t) => [t.name, t]));

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

  emitEvent(eventListener, "llm_call_start", { turn, mode: "with_tools" });

  const ai = await invokeLlmWithTransientRetry({
    modelState,
    turn,
    mode: "with_tools",
    invoke: ({ callbacks }) => {
      const boundLlm = Object.keys(adaptedBinding?.bindOptions || {}).length
        ? invokeLlm.bindTools(boundTools, adaptedBinding.bindOptions)
        : invokeLlm.bindTools(boundTools);
      return boundLlm.invoke(
        filterSummarizedMessages(messages),
        { callbacks, signal: abortSignal },
      );
    },
  });
  const aiContentText = normalizeAiTextContent(ai.content);
  messages.push(ai);

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages, turnMessages);
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const calls = ai.tool_calls || [];
  const stateCommitter = createStateCommitter({ messages, traces, turnMessageStore, dialogProcessId, runtime });

  stateCommitter.pushAssistantMessage({
    content: aiContentText,
    rawModelContent: ai?.content ?? null,
    modelAdditionalKwargs: ai?.additional_kwargs ?? null,
    modelResponseMetadata: ai?.response_metadata ?? null,
    type: calls.length ? "tool_call" : "message",
    toolCalls: calls.length
      ? calls.map((call) => ({
          id: call.id || "",
          type: "function",
          function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
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
  emitEvent(eventListener, "llm_call_end", { turn, hasToolCalls: Boolean(calls.length) });

  return { ai, aiContentText, calls, turnMessageStore, turnTaskStore, stateCommitter, currentModelInfo, toolMap };
}

// ── Tool Result Processing ──

async function _processToolResults({
  modelState,
  loopState,
  turn,
  calls,
  toolMap,
  stateCommitter,
}) {
  const { errorLogger } = loopState;
  const { eventListener, runtime, abortSignal } = modelState;

  emitEvent(eventListener, "tool_calls_detected", { turn, count: calls.length });

  const toolCallResults = await Promise.all(calls.map(async (call) => {
    assertNotAborted(abortSignal, runtime);
    emitEvent(eventListener, "tool_call_start", { turn, tool: call.name, args: call.args || {} });
    const tool = toolMap.get(call.name);
    return executeToolCall({
      call, tool, abortSignal, eventListener, turn, errorLogger,
      userId: runtime?.systemRuntime?.userId || runtime?.userId || "",
      sessionId: runtime?.systemRuntime?.sessionId || "",
      parentSessionId: runtime?.systemRuntime?.parentSessionId || "",
    });
  }));

  const hasTaskSummaryCall = toolCallResults.some(
    (r) => String(r?.call?.name || "").trim() === TASK_SUMMARY_TOOL_NAME,
  );
  const hasRequestHelpCall = toolCallResults.some(
    (r) => String(r?.call?.name || "").trim() === REQUEST_HELP_TOOL_NAME,
  );
  if (hasTaskSummaryCall) {
    loopState.taskSummaryTriggered = true;
  }

  for (const toolCallResult of toolCallResults) {
    const call = toolCallResult?.call || {};
    const toolResultText = String(toolCallResult?.toolResultText || "");
    stateCommitter.pushToolResult({ call, toolResultText });

    const fallbackExtractedAttachmentMetas = extractAttachmentMetasFromToolResult(
      call?.name || "",
      toolResultText,
    );
    const extractedAttachmentMetas =
      Array.isArray(toolCallResult?.extractedAttachmentMetas) &&
      toolCallResult.extractedAttachmentMetas.length
        ? toolCallResult.extractedAttachmentMetas
        : fallbackExtractedAttachmentMetas;
    stateCommitter.appendAttachmentMetas(extractedAttachmentMetas);

    const toolName = String(call?.name || "").trim();
    if (!toolName) continue;
    const nextFailureCount = toolCallResult?.success
      ? 0
      : Number(loopState.toolConsecutiveFailureCount || 0) + 1;
    loopState.toolConsecutiveFailureCount = nextFailureCount;
    if (runtime?.systemRuntime && typeof runtime.systemRuntime === "object") {
      runtime.systemRuntime.toolConsecutiveFailureCount = nextFailureCount;
    }
  }

  if (hasRequestHelpCall) {
    loopState.toolConsecutiveFailureCount = 0;
    if (runtime?.systemRuntime && typeof runtime.systemRuntime === "object") {
      runtime.systemRuntime.toolConsecutiveFailureCount = 0;
    }
  }

  return { toolCallResults, hasTaskSummaryCall, hasRequestHelpCall };
}

// ── Main Loop ──

export async function runFunctionCallLoop({ modelState, loopState, turn = 1 }) {
  const { tools, traces, maxTurns } = loopState;
  const { abortSignal, runtime, eventListener } = modelState;

  assertNotAborted(abortSignal, runtime);

  // ── Turn limit check ──
  if (turn > maxTurns) {
    const limitMsg = tEngine(runtime, "toolLoopLimitReached", { maxTurns });
    traces.push({ tool: "system", args: { turn, maxTurns }, result: limitMsg });
    emitEvent(eventListener, "tool_loop_limit_reached", { turn, maxTurns });
    return buildLoopResult({ output: limitMsg, traces, loopState });
  }

  resolveLlmForTurn(modelState);

  // ── No-tools branch ──
  if (!Array.isArray(tools) || tools.length === 0) {
    return _invokeNoTools({ modelState, loopState, turn });
  }

  // ── LLM call with tools ──
  const { aiContentText, calls, turnMessageStore, turnTaskStore, stateCommitter, toolMap } =
    await _invokeWithTools({ modelState, loopState, turn });

  // No tool calls → return immediately
  if (!calls.length) {
    return buildLoopResult({
      output: aiContentText,
      traces,
      loopState,
      turnTaskStore,
      turnMessageStore,
      modelMessages: loopState.messages,
    });
  }

  // ── Execute tools and process results ──
  const { toolCallResults, hasTaskSummaryCall, hasRequestHelpCall } =
    await _processToolResults({
      modelState,
      loopState,
      turn,
      calls,
      toolMap,
      stateCommitter,
    });

  // ── Sync turn state before recursive call ──
  loopState.turnMessages = turnMessageStore.toArray();
  loopState.turnTasks = turnTaskStore.toArray();

  // ── Phase summary & recursive call ──
  if (hasTaskSummaryCall) {
    removePhaseSummaryPromptMessages(loopState.messages, runtime);
  }
  maybeRequestPhaseSummary({ modelState, loopState, toolCallResults });
  maybePromptHelpToolByLoop({ modelState, loopState });
  maybePromptHelpToolByFailure({
    modelState,
    loopState,
    hasRequestHelpCall,
  });

  if (hasTaskSummaryCall) {
    markCurrentTurnModelMessagesSummarized(loopState.messages, {
      taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
    });
    markCurrentTurnStoreSummarized(turnMessageStore, {
      taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
    });
  }

  return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
}
