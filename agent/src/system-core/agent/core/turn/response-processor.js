/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../event/index.js";
import { REQUEST_HELP_TOOL_NAME } from "../../../tools/workflow/request-help-tool.js";
import { executeToolCall } from "../execution/tool-runner.js";
import { TASK_SUMMARY_TOOL_NAME } from "../constants/index.js";
import { assertNotAborted } from "../utils/error-utils.js";
import {
  buildAssistantModelMessageForToolCalls,
  formatToolCallsForStorage,
  normalizeToolResultAttachmentMetas,
} from "./turn-executor.js";
import { FINAL_ANSWER_TOOL_NAME } from "../../../tools/workflow/final-answer-tool.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../../hook/index.js";
import { buildHookContext } from "../hook/hook-context-builder.js";
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../../context/parent-session-id-resolver.js";

function ensurePendingSyntheticToolTurns(loopState = {}) {
  if (!Array.isArray(loopState.pendingSyntheticToolTurns)) {
    loopState.pendingSyntheticToolTurns = [];
  }
  return loopState.pendingSyntheticToolTurns;
}

function isPlainObject(value = null) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeModelMetadata(value = null) {
  if (!isPlainObject(value)) return null;
  const cloned = { ...value };
  delete cloned.tool_calls;
  delete cloned.toolCalls;
  delete cloned.function_call;
  return cloned;
}

function buildSyntheticAiFromPayload(payload = {}, call = {}) {
  return {
    content:
      typeof payload?.rawModelContent === "string" || Array.isArray(payload?.rawModelContent)
        ? payload.rawModelContent
        : String(payload?.content || ""),
    additional_kwargs: sanitizeModelMetadata(payload?.modelAdditionalKwargs) || {},
    response_metadata: sanitizeModelMetadata(payload?.modelResponseMetadata) || {},
    tool_calls: formatToolCallsForStorage([call]),
  };
}

function updateToolFailureState({ modelState, loopState, toolCallResult }) {
  const runtime = modelState?.runtime || {};
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const toolName = String(toolCallResult?.call?.name || "").trim();
  if (!toolName) return;
  const nextFailureCount = toolCallResult?.success
    ? 0
    : Number(loopState.toolConsecutiveFailureCount || 0) + 1;
  loopState.toolConsecutiveFailureCount = nextFailureCount;
  systemRuntime.toolConsecutiveFailureCount = nextFailureCount;
}

export async function commitSyntheticToolTurn({
  modelState,
  loopState,
  pendingTurn,
  turn,
} = {}) {
  if (!pendingTurn || typeof pendingTurn !== "object") {
    return null;
  }
  const call = pendingTurn.call || {};
  const stateCommitter = pendingTurn.stateCommitter;
  const assistantPayload = pendingTurn.assistantPayload || {};
  const toolCallResult = pendingTurn.toolCallResult || {};
  const runtime = modelState?.runtime || {};
  const eventListener = modelState?.eventListener || null;

  emitEvent(eventListener, "synthetic_tool_turn_start", {
    turn,
    tool: call.name,
    toolCallId: call.id || "",
  });

  if (Array.isArray(loopState?.messages)) {
    loopState.messages.push(
      buildAssistantModelMessageForToolCalls({
        ai: buildSyntheticAiFromPayload(assistantPayload, call),
        contentText: assistantPayload.content || "",
        toolCalls: [call],
      }),
    );
  }

  await stateCommitter.pushAssistantMessage({
    content: assistantPayload.content || "",
    rawModelContent: assistantPayload.rawModelContent ?? null,
    modelAdditionalKwargs: assistantPayload.modelAdditionalKwargs ?? null,
    modelResponseMetadata: assistantPayload.modelResponseMetadata ?? null,
    type: assistantPayload.type || "tool_call",
    toolCalls: formatToolCallsForStorage([call]),
    modelAlias: assistantPayload.modelAlias || "",
    modelName: assistantPayload.modelName || "",
  });

  await stateCommitter.pushToolResult({
    call,
    toolResultText: String(toolCallResult?.toolResultText || ""),
  });
  await stateCommitter.appendAttachmentMetas(
    Array.isArray(pendingTurn.extractedAttachmentMetas)
      ? pendingTurn.extractedAttachmentMetas
      : [],
  );
  updateToolFailureState({ modelState, loopState, toolCallResult });

  const hasTaskSummaryCall = String(call?.name || "").trim() === TASK_SUMMARY_TOOL_NAME;
  const hasRequestHelpCall = String(call?.name || "").trim() === REQUEST_HELP_TOOL_NAME;
  const hasFinalAnswerCall = String(call?.name || "").trim() === FINAL_ANSWER_TOOL_NAME;
  if (hasTaskSummaryCall) {
    loopState.taskSummaryTriggered = true;
  }
  if (hasRequestHelpCall) {
    const systemRuntime = getSystemRuntimeFromRuntime(runtime);
    loopState.toolConsecutiveFailureCount = 0;
    systemRuntime.toolConsecutiveFailureCount = 0;
  }

  emitEvent(eventListener, "synthetic_tool_turn_end", {
    turn,
    tool: call.name,
    toolCallId: call.id || "",
  });

  return {
    toolCallResults: [toolCallResult],
    hasTaskSummaryCall,
    hasRequestHelpCall,
    hasFinalAnswerCall,
    turnMessageStore: pendingTurn.turnMessageStore || null,
    turnTaskStore: pendingTurn.turnTaskStore || null,
  };
}

export async function processToolResults({
  modelState,
  loopState,
  turn,
  calls,
  toolMap,
  stateCommitter,
  syntheticAssistantPayload = null,
  turnMessageStore = null,
  turnTaskStore = null,
}) {
  const { errorLogger } = loopState;
  const { eventListener, runtime, abortSignal } = modelState;
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const parentSessionId = resolveParentSessionId({ runtime });

  emitEvent(eventListener, "tool_calls_detected", { turn, count: calls.length });
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.BEFORE_TOOL_CALLS,
    context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_TOOL_CALLS, runtime, {
      phase: "tool_calls",
      status: "start",
      turn,
      toolCallCount: calls.length,
      calls,
      agentContext: modelState?.agentContext || null,
    }),
  });

  const toolCallResults = [];
  for (const call of calls) {
    assertNotAborted(abortSignal, runtime);
    emitEvent(eventListener, "tool_call_start", {
      turn,
      tool: call.name,
      args: call.args || {},
    });
    const tool = toolMap.get(call.name);
    const toolCallResult = await executeToolCall({
      call,
      tool,
      abortSignal,
      eventListener,
      turn,
      errorLogger,
      userId: systemRuntime?.userId || runtime?.userId || "",
      sessionId: systemRuntime?.sessionId || "",
      parentSessionId,
      runtime,
      agentContext: modelState?.agentContext || null,
    });
    toolCallResults.push(toolCallResult);
  }

  const hasTaskSummaryCall = toolCallResults.some(
    (result) => String(result?.call?.name || "").trim() === TASK_SUMMARY_TOOL_NAME,
  );
  const hasRequestHelpCall = toolCallResults.some(
    (result) => String(result?.call?.name || "").trim() === REQUEST_HELP_TOOL_NAME,
  );
  const hasFinalAnswerCall = toolCallResults.some(
    (result) => String(result?.call?.name || "").trim() === FINAL_ANSWER_TOOL_NAME,
  );


  const shouldSplitToolTurns =
    toolCallResults.length > 1 && isPlainObject(syntheticAssistantPayload);
  const pendingSyntheticToolTurns = shouldSplitToolTurns
    ? ensurePendingSyntheticToolTurns(loopState)
    : null;
  const committedToolCallResults = shouldSplitToolTurns
    ? toolCallResults.slice(0, 1)
    : toolCallResults;
  const committedHasTaskSummaryCall = committedToolCallResults.some(
    (result) => String(result?.call?.name || "").trim() === TASK_SUMMARY_TOOL_NAME,
  );
  const committedHasRequestHelpCall = committedToolCallResults.some(
    (result) => String(result?.call?.name || "").trim() === REQUEST_HELP_TOOL_NAME,
  );
  const committedHasFinalAnswerCall = committedToolCallResults.some(
    (result) => String(result?.call?.name || "").trim() === FINAL_ANSWER_TOOL_NAME,
  );
  if (committedHasTaskSummaryCall) {
    loopState.taskSummaryTriggered = true;
  }

  for (let index = 0; index < toolCallResults.length; index += 1) {
    const toolCallResult = toolCallResults[index];
    const call = toolCallResult?.call || {};
    const toolResultText = String(toolCallResult?.toolResultText || "");
    const extractedAttachmentMetas = normalizeToolResultAttachmentMetas(toolCallResult, call);

    if (shouldSplitToolTurns && index > 0) {
      pendingSyntheticToolTurns.push({
        call,
        toolCallResult,
        extractedAttachmentMetas,
        assistantPayload: syntheticAssistantPayload,
        stateCommitter,
        turnMessageStore,
        turnTaskStore,
      });
      continue;
    }

    await stateCommitter.pushToolResult({ call, toolResultText });
    await stateCommitter.appendAttachmentMetas(extractedAttachmentMetas);
    updateToolFailureState({ modelState, loopState, toolCallResult });
  }

  if (committedHasRequestHelpCall) {
    loopState.toolConsecutiveFailureCount = 0;
    systemRuntime.toolConsecutiveFailureCount = 0;
  }
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.AFTER_TOOL_CALLS,
    context: buildHookContext(AGENT_HOOK_POINTS.AFTER_TOOL_CALLS, runtime, {
      phase: "tool_calls",
      status: "success",
      turn,
      toolCallCount: calls.length,
      calls,
      toolCallResults,
      hasTaskSummaryCall,
      hasRequestHelpCall,
      hasFinalAnswerCall,
      agentContext: modelState?.agentContext || null,
    }),
  });

  return {
    toolCallResults: committedToolCallResults,
    hasTaskSummaryCall: committedHasTaskSummaryCall,
    hasRequestHelpCall: committedHasRequestHelpCall,
    hasFinalAnswerCall: committedHasFinalAnswerCall,
  };
}
