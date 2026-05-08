/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createChatModel, resolveDefaultModelSpec } from "../../model/index.js";
import { mergeConfig } from "../../config/index.js";
import { emitEvent } from "../../event/index.js";
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../../context/current-turn-store.js";
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
import { assertNotAborted } from "./utils/error-utils.js";
import { normalizeAiTextContent } from "./utils/text-utils.js";
import { createStateCommitter } from "./execution/state-committer.js";
import { executeToolCall } from "./execution/tool-runner.js";
import { TOOL_CONSECUTIVE_FAILURE_LIMIT } from "./constants.js";

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
  } = loopState;
  const {
    eventListener,
    runtime,
    globalConfig,
    userConfig,
    defaultModelSpec,
    abortSignal,
  } = modelState;
  assertNotAborted(abortSignal);

  if (turn > maxTurns) {
    const limitMsg = tEngine(runtime, "toolLoopLimitReached", { maxTurns });
    traces.push({ tool: "system", args: { turn, maxTurns }, result: limitMsg });
    emitEvent(eventListener, "tool_loop_limit_reached", { turn, maxTurns });
    return {
      output: limitMsg,
      traces,
      turnMessages: Array.isArray(turnMessages) ? turnMessages : [],
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
    const modelResponse = await modelState.llm.invoke(messages, {
      callbacks: llmCallbacks,
      signal: abortSignal,
    });
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
      turnMessages: turnMessageStore.toArray(),
      turnTasks: turnTaskStore.toArray(),
    };
  }

  const toolMap = new Map(
    tools.map((toolDefinition) => [toolDefinition.name, toolDefinition]),
  );
  emitEvent(eventListener, "llm_call_start", { turn });
  const llmCallbacks = createStreamingCallbacks(eventListener);

  const ai = await modelState.llm.bindTools(tools).invoke(messages, {
    callbacks: llmCallbacks,
    signal: abortSignal,
  });
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
      turnMessages: turnMessageStore.toArray(),
      turnTasks: turnTaskStore.toArray(),
    };

  emitEvent(eventListener, "tool_calls_detected", {
    turn,
    count: calls.length,
  });
  const toolCallResults = await Promise.all(calls.map(async (call) => {
    assertNotAborted(abortSignal);
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
    });
  }));
  for (const toolCallResult of toolCallResults) {
    const call = toolCallResult?.call || {};
    const toolResultText = String(toolCallResult?.toolResultText || "");
    stateCommitter.pushToolResult({ call, toolResultText });
    // Keep compatibility with previous behavior and ensure helper stays in flow.
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
      turnMessages: turnMessageStore.toArray(),
      turnTasks: turnTaskStore.toArray(),
    };
  }

  loopState.turnMessages = turnMessageStore.toArray();
  loopState.turnTasks = turnTaskStore.toArray();
  return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
}

export async function runAgentTurn({ agentContext, userMessage }) {
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

  const selectedModelSpec = resolveDefaultModelSpec({
    globalConfig,
    userConfig,
  });
  const runtimeMaxTurns = Number(sys?.config?.maxToolLoopTurns || 0);
  const configMaxTurns = Number(effectiveConfig?.maxToolLoopTurns || 4);
  const maxToolLoopTurns =
    Number.isFinite(runtimeMaxTurns) && runtimeMaxTurns > 0
      ? runtimeMaxTurns
      : configMaxTurns;
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
        : 4,
    consecutiveToolFailures: {},
  };
  return await runFunctionCallLoop({ modelState, loopState, turn: 1 });
}
