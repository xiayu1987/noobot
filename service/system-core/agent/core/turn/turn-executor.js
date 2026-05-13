/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filterSummarizedMessages } from "../../../context/summarized-message-policy.js";
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../../../context/current-turn-store.js";
import {
  adaptToolsForBinding,
  appendToolCompatibilityLog,
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

export async function invokeNoToolsTurn({ modelState, loopState, turn }) {
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
  const modelResponse = await invokeLlmWithTransientRetry({
    modelState,
    turn,
    mode: "no_tools",
    invoke: ({ callbacks }) =>
      invokeLlm.invoke(filterSummarizedMessages(messages), {
        callbacks,
        signal: abortSignal,
      }),
  });
  const responseContentText = normalizeAiTextContent(modelResponse?.content);
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
  });

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
  const invokeLlm = resolveInvokeLlm(modelState, "with_tools");

  const adaptedBinding = adaptToolsForBinding(tools, modelState);
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

  emitEvent(eventListener, "llm_call_start", { turn, mode: "with_tools" });

  const ai = await invokeLlmWithTransientRetry({
    modelState,
    turn,
    mode: "with_tools",
    invoke: ({ callbacks }) => {
      const boundLlm = Object.keys(adaptedBinding?.bindOptions || {}).length
        ? invokeLlm.bindTools(boundTools, adaptedBinding.bindOptions)
        : invokeLlm.bindTools(boundTools);
      return boundLlm.invoke(filterSummarizedMessages(messages), {
        callbacks,
        signal: abortSignal,
      });
    },
  });

  const aiContentText = normalizeAiTextContent(ai.content);
  messages.push(ai);

  const turnMessageStore = resolveTurnMessagesStore(currentTurnMessages, turnMessages);
  const turnTaskStore = resolveTurnTasksStore(currentTurnTasks, loopState.turnTasks || []);
  const currentModelInfo = resolveCurrentModelInfo(modelState);

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

  const stateCommitter = createStateCommitter({
    messages,
    traces,
    turnMessageStore,
    dialogProcessId,
    runtime,
  });

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
