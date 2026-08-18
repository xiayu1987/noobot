/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { REQUEST_HELP_TOOL_NAME } from "../../tools/collaboration/request-help-tool.js";
import { settleToolCallInTurn } from "../tool-execution/tool-runner.js";
import { DEFAULT_TASK_SUMMARY_TOOL_NAME as TASK_SUMMARY_TOOL_NAME } from "@noobot/context-protocol/policy/summary";
import { FINAL_ANSWER_TOOL_NAME } from "../../tools/collaboration/final-answer-tool.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import {
  getSessionIdsFromAgentContext,
  getSystemRuntimeFromRuntime,
} from "../../context/agent-context-accessor.js";

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
  const executionIdentity = getSessionIdsFromAgentContext(modelState.agentContext);
  emitEvent(eventListener, "tool_calls_detected", { turn, count: calls.length });
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.BEFORE_TOOL_CALLS,
    context: buildHookContext(HOOK_POINT.AGENT.BEFORE_TOOL_CALLS, runtime, {
      phase: "tool_calls",
      status: "start",
      turn,
      toolCallCount: calls.length,
      calls,
      agentContext: modelState?.agentContext || null,
    }),
  });

  const toolCallSettlements = await Promise.all(
    calls.map(async (call) => {
      const tool = toolMap.get(call.name);
      return settleToolCallInTurn({
        call,
        tool,
        abortSignal,
        eventListener,
        turn,
        errorLogger,
        userId: executionIdentity.userId,
        sessionId: executionIdentity.sessionId,
        parentSessionId: executionIdentity.parentSessionId,
        runtime,
        agentContext: modelState?.agentContext || null,
      });
    }),
  );
  const toolCallResults = toolCallSettlements.map((settlement) => settlement.result);

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

  const commitToolResults = async () => {
    for (const toolCallResult of toolCallResults) {
      const call = toolCallResult?.call || {};
      const toolResultText = String(toolCallResult?.toolResultText || "");
      await stateCommitter.pushToolResult({
        call,
        toolResultText,
        transferEnvelopes: toolCallResult?.transferEnvelopes || [],
      });
      updateToolFailureState({ modelState, loopState, toolCallResult });
    }
  };
  if (typeof runtime?.withCurrentTurnPersistenceBatch === "function") {
    await runtime.withCurrentTurnPersistenceBatch(commitToolResults);
  } else {
    await commitToolResults();
  }

  const rejectedSettlement = toolCallSettlements.find(
    (settlement) => settlement.status === "rejected",
  );
  if (rejectedSettlement) throw rejectedSettlement.error;

  if (hasRequestHelpCall) {
    loopState.toolConsecutiveFailureCount = 0;
    systemRuntime.toolConsecutiveFailureCount = 0;
  }
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.AFTER_TOOL_CALLS,
    context: buildHookContext(HOOK_POINT.AGENT.AFTER_TOOL_CALLS, runtime, {
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
    toolCallResults,
    hasTaskSummaryCall,
    hasRequestHelpCall,
    hasFinalAnswerCall,
  };
}
