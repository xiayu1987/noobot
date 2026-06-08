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
import { normalizeToolResultAttachmentMetas } from "./turn-executor.js";
import { FINAL_ANSWER_TOOL_NAME } from "../../../tools/workflow/final-answer-tool.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../../hook/index.js";
import { buildHookContext } from "../hook/hook-context-builder.js";
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../../context/parent-session-id-resolver.js";

export async function processToolResults({
  modelState,
  loopState,
  turn,
  calls,
  toolMap,
  stateCommitter,
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

  if (hasTaskSummaryCall) {
    loopState.taskSummaryTriggered = true;
  }

  for (const toolCallResult of toolCallResults) {
    const call = toolCallResult?.call || {};
    const toolResultText = String(toolCallResult?.toolResultText || "");
    await stateCommitter.pushToolResult({ call, toolResultText });

    const extractedAttachmentMetas = normalizeToolResultAttachmentMetas(toolCallResult, call);
    await stateCommitter.appendAttachmentMetas(extractedAttachmentMetas);

    const toolName = String(call?.name || "").trim();
    if (!toolName) continue;

    const nextFailureCount = toolCallResult?.success
      ? 0
      : Number(loopState.toolConsecutiveFailureCount || 0) + 1;
    loopState.toolConsecutiveFailureCount = nextFailureCount;
    systemRuntime.toolConsecutiveFailureCount = nextFailureCount;
  }

  if (hasRequestHelpCall) {
    loopState.toolConsecutiveFailureCount = 0;
    systemRuntime.toolConsecutiveFailureCount = 0;
  }

  return {
    toolCallResults,
    hasTaskSummaryCall,
    hasRequestHelpCall,
    hasFinalAnswerCall,
  };
}
