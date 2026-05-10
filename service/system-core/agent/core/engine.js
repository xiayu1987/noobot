/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SystemMessage } from "@langchain/core/messages";
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
  if (systemRuntime.needsPhaseSummary === true) return false;
  if (nextCount < threshold) return false;

  systemRuntime.needsPhaseSummary = true;
  if (Array.isArray(loopState?.messages)) {
    loopState.messages.push(new SystemMessage(tEngine(runtime, "phaseSummaryPrompt")));
  }
  emitEvent(modelState?.eventListener || null, "phase_summary_required", {
    loopCount: nextCount,
    threshold,
  });
  return true;
}

async function runFunctionCallLoop({ modelState, loopState, turn = 1 }) {
  const {
    tools,
    messages,
    traces,
    turnMessages,
    currentTurnMessages,
    currentTurnTasks,
    dialogProcessId,
    maxTurns,
    consecutiveToolFailures,
    errorLogger,
  } = loopState;
  const {
    eventListener,
    runtime,
    globalConfig,
    userConfig,
    defaultModelSpec,
    abortSignal,
  } = modelState;
  assertNotAborted(abortSignal, runtime);

  if (turn > maxTurns) {
    const limitMsg = tEngine(runtime, "toolLoopLimitReached", { maxTurns });
    traces.push({ tool: "system", args: { turn, maxTurns }, result: limitMsg });
    emitEvent(eventListener, "tool_loop_limit_reached", { turn, maxTurns });
    return {
      output: limitMsg,
      traces,
      turnMessages: finalizeTurnMessagesBeforeReturn({
        fallbackMessages: Array.isArray(turnMessages) ? turnMessages : [],
      }),
      turnTasks: Array.isArray(loopState?.turnTasks) ? loopState.turnTasks : [],
    };
  }

  resolveLlmForTurn(modelState);

  if (!Array.isArray(tools) || tools.length === 0) {
    emitEvent(eventListener, "llm_call_start", {
      turn,
      mode: "no_tools",
    });
    const llmCallbacks = createStreamingCallbacks(eventListener);
    const modelResponse = await modelState.llm.invoke(
      filterSummarizedMessages(messages),
      {
      callbacks: llmCallbacks,
      signal: abortSignal,
      },
    );
    const responseContentText = normalizeAiTextContent(modelResponse?.content);
    messages.push(modelResponse);
    const turnMessageStore = resolveTurnMessagesStore(
      currentTurnMessages,
      turnMessages,
    );
    const currentModelInfo = resolveCurrentModelInfo(modelState);
    const turnTaskStore = resolveTurnTasksStore(
      currentTurnTasks,
      loopState.turnTasks || [],
    );
    const stateCommitter = createStateCommitter({
      messages,
      traces,
      turnMessageStore,
      dialogProcessId,
      runtime,
    });
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
    emitEvent(eventListener, "llm_call_end", {
      turn,
      hasToolCalls: false,
      mode: "no_tools",
    });
    return {
      output: responseContentText,
      traces,
      turnMessages: finalizeTurnMessagesBeforeReturn({
        modelMessages: messages,
        turnMessageStore,
      }),
      turnTasks: turnTaskStore.toArray(),
    };
  }

  const toolMap = new Map(
    tools.map((toolDefinition) => [toolDefinition.name, toolDefinition]),
  );
  emitEvent(eventListener, "llm_call_start", { turn });
  const llmCallbacks = createStreamingCallbacks(eventListener);

  const ai = await modelState.llm.bindTools(tools).invoke(
    filterSummarizedMessages(messages),
    {
    callbacks: llmCallbacks,
    signal: abortSignal,
    },
  );
  const aiContentText = normalizeAiTextContent(ai.content);
  messages.push(ai);
  const turnMessageStore = resolveTurnMessagesStore(
    currentTurnMessages,
    turnMessages,
  );
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  const turnTaskStore = resolveTurnTasksStore(
    currentTurnTasks,
    loopState.turnTasks || [],
  );
  const calls = ai.tool_calls || [];
  const stateCommitter = createStateCommitter({
    messages,
    traces,
    turnMessageStore,
    dialogProcessId,
    runtime,
  });
  stateCommitter.pushAssistantMessage({
    content: aiContentText,
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

  if (!calls.length)
    return {
      output: aiContentText,
      traces,
      turnMessages: finalizeTurnMessagesBeforeReturn({
        modelMessages: messages,
        turnMessageStore,
      }),
      turnTasks: turnTaskStore.toArray(),
    };

  emitEvent(eventListener, "tool_calls_detected", {
    turn,
    count: calls.length,
  });
  const toolCallResults = await Promise.all(calls.map(async (call) => {
    assertNotAborted(abortSignal, runtime);
    emitEvent(eventListener, "tool_call_start", {
      turn,
      tool: call.name,
      args: call.args || {},
    });
    const tool = toolMap.get(call.name);
    return executeToolCall({
      call,
      tool,
      abortSignal,
      eventListener,
      turn,
      errorLogger,
      userId: runtime?.systemRuntime?.userId || "",
      sessionId: runtime?.systemRuntime?.sessionId || "",
      parentSessionId: runtime?.systemRuntime?.parentSessionId || "",
    });
  }));
  const hasTaskSummaryCall = toolCallResults.some(
    (toolCallResult) =>
      String(toolCallResult?.call?.name || "").trim() === TASK_SUMMARY_TOOL_NAME,
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
    const currentConsecutiveFailures = Number(
      consecutiveToolFailures?.[toolName] || 0,
    );
    const nextConsecutiveFailures = toolCallResult?.success
      ? 0
      : currentConsecutiveFailures + 1;
    consecutiveToolFailures[toolName] = nextConsecutiveFailures;
    if (nextConsecutiveFailures < TOOL_CONSECUTIVE_FAILURE_LIMIT) continue;
    const limitMsg = tEngine(runtime, "toolConsecutiveFailureLimitReached", {
      toolName,
      maxFails: TOOL_CONSECUTIVE_FAILURE_LIMIT,
    });
    traces.push({
      tool: "system",
      args: {
        turn,
        toolName,
        maxFails: TOOL_CONSECUTIVE_FAILURE_LIMIT,
      },
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
    loopState.turnMessages = turnMessageStore.toArray();
    loopState.turnTasks = turnTaskStore.toArray();
    return {
      output: limitMsg,
      traces,
      turnMessages: finalizeTurnMessagesBeforeReturn({
        modelMessages: messages,
        turnMessageStore,
      }),
      turnTasks: turnTaskStore.toArray(),
    };
  }

  loopState.turnMessages = turnMessageStore.toArray();
  loopState.turnTasks = turnTaskStore.toArray();
  if (hasTaskSummaryCall) {
    removePhaseSummaryPromptMessages(messages, runtime);
  }
  maybeRequestPhaseSummary({ modelState, loopState, toolCallResults });
  // 仅在显式调用 task_summary 时，才在 loop 中途即时同步 summarized 标记；
  // 其他自动打标统一在完整对话结束返回时处理。
  if (hasTaskSummaryCall) {
    markCurrentTurnModelMessagesSummarized(messages, {
      taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
    });
    markCurrentTurnStoreSummarized(turnMessageStore, {
      taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
    });
  }
  loopState.turnMessages = turnMessageStore.toArray();
  return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
}

export async function runAgentTurn({ agentContext, userMessage, errorLogger = null }) {
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
  if (runtime?.systemRuntime && typeof runtime.systemRuntime === "object") {
    const loopCount = Number(runtime.systemRuntime.toolLoopExecutionCount || 0);
    runtime.systemRuntime.toolLoopExecutionCount =
      Number.isFinite(loopCount) && loopCount > 0 ? loopCount : 0;
    runtime.systemRuntime.phaseSummaryLoopCount =
      runtime.systemRuntime.toolLoopExecutionCount;
    runtime.systemRuntime.needsPhaseSummary =
      runtime.systemRuntime.needsPhaseSummary === true;
  }

  const selectedModelSpec = resolveDefaultModelSpec({
    globalConfig,
    userConfig,
  });
  const runtimeMaxTurns = Number(sys?.config?.maxToolLoopTurns || 0);
  const configMaxTurns = Number(effectiveConfig?.maxToolLoopTurns || DEFAULT_MAX_TOOL_LOOP_TURNS);
  const maxToolLoopTurns =
    Number.isFinite(runtimeMaxTurns) && runtimeMaxTurns > 0
      ? runtimeMaxTurns
      : configMaxTurns;
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

  const messages = buildContextMessages(agentContext, {
    currentUserMessage: userMessage,
  });
  if (runtime?.systemRuntime && typeof runtime.systemRuntime === "object") {
    runtime.systemRuntime.currentTurnUserMessage = String(userMessage || "").trim();
  }

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
  return await runFunctionCallLoop({ modelState, loopState, turn: 1 });
}
