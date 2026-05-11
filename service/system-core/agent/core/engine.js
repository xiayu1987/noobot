/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChatModel, resolveDefaultModelSpec } from "../../model/index.js";
import { mergeConfig } from "../../config/index.js";
import { emitEvent } from "../../event/index.js";
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../../context/current-turn-store.js";
import {
  filterSummarizedMessages,
  markCurrentTurnArraySummarized,
  markCurrentTurnModelMessagesSummarized,
  markCurrentTurnStoreSummarized,
} from "../../context/summarized-message-policy.js";
import { buildContextMessages } from "./context/message-builder.js";
import { tEngine } from "./i18n-adapter.js";
import {
  extractAttachmentMetasFromToolResult,
  persistModelGeneratedArtifacts,
} from "./media/artifact-service.js";
import {
  createStreamingCallbacks,
  resolveCurrentModelInfo,
  resolveLlmForTurn,
} from "./model/model-manager.js";
import { createStateCommitter } from "./execution/state-committer.js";
import { executeToolCall } from "./execution/tool-runner.js";
import {
  TOOL_CONSECUTIVE_FAILURE_LIMIT,
  DEFAULT_MAX_TOOL_LOOP_TURNS,
  DEFAULT_PHASE_SUMMARY_LOOP_TURNS,
} from "./constants.js";
import { assertNotAborted } from "./utils/error-utils.js";

const TASK_SUMMARY_TOOL_NAME = "task_summary";

function normalizeAiTextContent(aiContent) {
  if (typeof aiContent === "string") return String(aiContent || "");
  if (!Array.isArray(aiContent)) return String(aiContent || "");
  const textParts = aiContent
    .map((contentPart) => {
      if (!contentPart || typeof contentPart !== "object") return "";
      if (typeof contentPart?.text === "string") return contentPart.text;
      if (typeof contentPart?.content === "string") return contentPart.content;
      return "";
    })
    .filter(Boolean);
  return textParts.join("\n");
}

function resolvePhaseSummaryLoopTurns(effectiveConfig = {}) {
  const taskSummaryConfig =
    effectiveConfig?.tools?.[TASK_SUMMARY_TOOL_NAME] &&
    typeof effectiveConfig.tools[TASK_SUMMARY_TOOL_NAME] === "object"
      ? effectiveConfig.tools[TASK_SUMMARY_TOOL_NAME]
      : {};
  const configuredValue = Number(
    taskSummaryConfig.phase_summary_loop_turns ??
      taskSummaryConfig.phaseSummaryLoopTurns ??
      taskSummaryConfig.max_tool_loop_turns ??
      taskSummaryConfig.maxToolLoopTurns ??
      DEFAULT_PHASE_SUMMARY_LOOP_TURNS,
  );
  if (!Number.isFinite(configuredValue) || configuredValue <= 0) return 0;
  return Math.floor(configuredValue);
}

function hasTaskSummaryTool(tools = []) {
  return (Array.isArray(tools) ? tools : []).some(
    (toolDefinition) =>
      String(toolDefinition?.name || "").trim() === TASK_SUMMARY_TOOL_NAME,
  );
}

function removePhaseSummaryPromptMessages(messages = [], runtime = {}) {
  if (!Array.isArray(messages)) return 0;
  let removedCount = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const content = String(message?.content || "").trim();
    const type =
      typeof message?._getType === "function"
        ? String(message._getType() || "")
        : String(message?.lc_kwargs?.type || message?.type || "");
    if (type !== "system" && message?.constructor?.name !== "SystemMessage") {
      continue;
    }
    if (content !== tEngine(runtime, "phaseSummaryPrompt")) continue;
    messages.splice(index, 1);
    removedCount += 1;
  }
  return removedCount;
}

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


function maybeRequestPhaseSummary({ modelState, loopState, toolCallResults = [] }) {
  const runtime = modelState?.runtime || {};
  const systemRuntime =
    runtime?.systemRuntime && typeof runtime.systemRuntime === "object"
      ? runtime.systemRuntime
      : null;
  if (!systemRuntime) return false;
  const hasTaskSummaryCall = (Array.isArray(toolCallResults) ? toolCallResults : [])
    .some(
      (toolCallResult) =>
        String(toolCallResult?.call?.name || "").trim() === TASK_SUMMARY_TOOL_NAME,
    );
  if (hasTaskSummaryCall) return false;

  const currentCount = Number(systemRuntime.toolLoopExecutionCount || 0);
  const nextCount = Number.isFinite(currentCount) && currentCount >= 0
    ? currentCount + 1
    : 1;
  systemRuntime.toolLoopExecutionCount = nextCount;
  systemRuntime.phaseSummaryLoopCount = nextCount;

  const threshold = Number(loopState?.phaseSummaryLoopTurns || 0);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  if (!hasTaskSummaryTool(loopState?.tools || [])) return false;
  if (nextCount < threshold) return false;

  systemRuntime.needsPhaseSummary = true;
  if (Array.isArray(loopState?.messages)) {
    loopState.messages.push(new HumanMessage(tEngine(runtime, "phaseSummaryPrompt")));
  }
  emitEvent(modelState?.eventListener || null, "phase_summary_required", {
    loopCount: nextCount,
    threshold,
  });
  return true;
}

/**
 * Handles the no-tools branch: invokes LLM without tools and returns result.
 */
async function _invokeNoTools({ modelState, loopState, turn }) {
  const { messages, traces, turnMessages, currentTurnMessages, currentTurnTasks, dialogProcessId, errorLogger } = loopState;
  const { eventListener, runtime, abortSignal } = modelState;

  emitEvent(eventListener, "llm_call_start", { turn, mode: "no_tools" });
  const llmCallbacks = createStreamingCallbacks(eventListener);
  const modelResponse = await modelState.llm.invoke(
    filterSummarizedMessages(messages),
    { callbacks: llmCallbacks, signal: abortSignal },
  );
  const responseContentText = normalizeAiTextContent(modelResponse?.content);
  messages.push(modelResponse);

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages, turnMessages);
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const stateCommitter = createStateCommitter({ messages, traces, turnMessageStore, dialogProcessId, runtime });

  stateCommitter.pushAssistantMessage({
    content: responseContentText,
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

/**
 * Invokes LLM with tools bound. Returns { ai, aiContentText, calls, turnMessageStore, turnTaskStore, stateCommitter, currentModelInfo }
 * or null if no tool_calls were returned (in which case caller should return the result directly).
 */
async function _invokeWithTools({ modelState, loopState, turn }) {
  const { messages, traces, tools, turnMessages, currentTurnMessages, currentTurnTasks, dialogProcessId } = loopState;
  const { eventListener, runtime, abortSignal } = modelState;

  const toolMap = new Map(tools.map((t) => [t.name, t]));
  emitEvent(eventListener, "llm_call_start", { turn });
  const llmCallbacks = createStreamingCallbacks(eventListener);

  const ai = await modelState.llm.bindTools(tools).invoke(
    filterSummarizedMessages(messages),
    { callbacks: llmCallbacks, signal: abortSignal },
  );
  const aiContentText = normalizeAiTextContent(ai.content);
  messages.push(ai);

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages, turnMessages);
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const calls = ai.tool_calls || [];
  const stateCommitter = createStateCommitter({ messages, traces, turnMessageStore, dialogProcessId, runtime });

  stateCommitter.pushAssistantMessage({
    content: aiContentText,
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

/**
 * Executes tool calls, processes results, handles consecutive failures.
 * Returns { toolCallResults, hasTaskSummaryCall, shouldTerminate, limitMsg }
 * where shouldTerminate indicates if a consecutive failure limit was hit.
 */
async function _processToolResults({
  modelState,
  loopState,
  turn,
  calls,
  toolMap,
  stateCommitter,
  currentModelInfo,
}) {
  const { traces, consecutiveToolFailures, errorLogger } = loopState;
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

    const currentConsecutiveFailures = Number(consecutiveToolFailures?.[toolName] || 0);
    const nextConsecutiveFailures = toolCallResult?.success ? 0 : currentConsecutiveFailures + 1;
    consecutiveToolFailures[toolName] = nextConsecutiveFailures;

    if (nextConsecutiveFailures >= TOOL_CONSECUTIVE_FAILURE_LIMIT) {
      const limitMsg = tEngine(runtime, "toolConsecutiveFailureLimitReached", {
        toolName,
        maxFails: TOOL_CONSECUTIVE_FAILURE_LIMIT,
      });
      traces.push({
        tool: "system",
        args: { turn, toolName, maxFails: TOOL_CONSECUTIVE_FAILURE_LIMIT },
        result: limitMsg,
      });
      emitEvent(eventListener, "tool_consecutive_failure_limit_reached", {
        turn,
        tool: toolName,
        failureCount: nextConsecutiveFailures,
        maxFails: TOOL_CONSECUTIVE_FAILURE_LIMIT,
        reason: String(toolCallResult?.failureReason || ""),
      });
      stateCommitter.pushAssistantMessage({
        content: limitMsg,
        type: "message",
        toolCalls: [],
        modelAlias: currentModelInfo.modelAlias,
        modelName: currentModelInfo.modelName,
      });
      return { toolCallResults, hasTaskSummaryCall, shouldTerminate: true, limitMsg };
    }
  }

  return { toolCallResults, hasTaskSummaryCall, shouldTerminate: false, limitMsg: null };
}

async function runFunctionCallLoop({ modelState, loopState, turn = 1 }) {
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
  const { aiContentText, calls, turnMessageStore, turnTaskStore, stateCommitter, currentModelInfo, toolMap } =
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
  const { toolCallResults, hasTaskSummaryCall, shouldTerminate, limitMsg } =
    await _processToolResults({
      modelState,
      loopState,
      turn,
      calls,
      toolMap,
      stateCommitter,
      currentModelInfo,
    });

  if (shouldTerminate) {
    return buildLoopResult({
      output: limitMsg,
      traces,
      loopState,
      turnTaskStore,
      turnMessageStore,
      modelMessages: loopState.messages,
    });
  }

  // ── Sync turn state before recursive call ──
  loopState.turnMessages = turnMessageStore.toArray();
  loopState.turnTasks = turnTaskStore.toArray();

  // ── Phase summary & recursive call ──
  if (hasTaskSummaryCall) {
    removePhaseSummaryPromptMessages(loopState.messages, runtime);
  }
  maybeRequestPhaseSummary({ modelState, loopState, toolCallResults });

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


/**
 * Resolves runtime config, creates LLM, builds messages, and assembles
 * modelState + loopState for the function-call loop.
 */
function buildAgentState({ agentContext, userMessage, errorLogger }) {
  const runtime = agentContext?.execution?.controllers?.runtime || {};
  const sys = runtime.systemRuntime || {};
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const eventListener = runtime.eventListener || null;
  const abortSignal = runtime.abortSignal || null;
  const dialogProcessId = sys.dialogProcessId || "";
  const tools = Array.isArray(agentContext?.payload?.tools?.registry)
    ? agentContext.payload.tools.registry
    : [];

  // Normalize phase-summary loop counters on systemRuntime
  if (runtime?.systemRuntime && typeof runtime.systemRuntime === "object") {
    const loopCount = Number(runtime.systemRuntime.toolLoopExecutionCount || 0);
    runtime.systemRuntime.toolLoopExecutionCount =
      Number.isFinite(loopCount) && loopCount > 0 ? loopCount : 0;
    runtime.systemRuntime.phaseSummaryLoopCount =
      runtime.systemRuntime.toolLoopExecutionCount;
    runtime.systemRuntime.needsPhaseSummary =
      runtime.systemRuntime.needsPhaseSummary === true;
    runtime.systemRuntime.currentTurnUserMessage = String(userMessage || "").trim();
  }

  const selectedModelSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
  const runtimeMaxTurns = Number(sys?.config?.maxToolLoopTurns || 0);
  const configMaxTurns = Number(effectiveConfig?.maxToolLoopTurns || DEFAULT_MAX_TOOL_LOOP_TURNS);
  const maxToolLoopTurns =
    Number.isFinite(runtimeMaxTurns) && runtimeMaxTurns > 0 ? runtimeMaxTurns : configMaxTurns;
  const phaseSummaryLoopTurns = resolvePhaseSummaryLoopTurns(effectiveConfig);

  const llm = createChatModel({
    globalConfig,
    userConfig,
    streaming: Boolean(eventListener?.onEvent),
  });
  emitEvent(eventListener, "model_selected", {
    alias: selectedModelSpec?.alias || "",
    model: selectedModelSpec?.model || "",
  });

  const messages = buildContextMessages(agentContext, { currentUserMessage: userMessage });

  const modelState = {
    llm,
    activeModelName: selectedModelSpec?.model || "",
    activeModelAlias: selectedModelSpec?.alias || "",
    eventListener,
    runtime,
    globalConfig,
    userConfig,
    defaultModelSpec: selectedModelSpec,
    abortSignal,
  };

  const loopState = {
    tools,
    messages,
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: runtime?.currentTurnMessages || null,
    currentTurnTasks: runtime?.currentTurnTasks || null,
    dialogProcessId,
    maxTurns:
      Number.isFinite(maxToolLoopTurns) && maxToolLoopTurns > 0
        ? maxToolLoopTurns
        : DEFAULT_MAX_TOOL_LOOP_TURNS,
    phaseSummaryLoopTurns,
    taskSummaryTriggered: false,
    consecutiveToolFailures: {},
    errorLogger,
  };

  return { modelState, loopState };
}

export async function runAgentTurn({ agentContext, userMessage, errorLogger = null }) {
  const { modelState, loopState } = buildAgentState({ agentContext, userMessage, errorLogger });
  return runFunctionCallLoop({ modelState, loopState, turn: 1 });
}
