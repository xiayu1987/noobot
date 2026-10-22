/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { HELP_TOOL_NAME } from "../../tools/collaboration/help-tool.js";
import { settleToolCallInTurn } from "../tool-execution/tool-runner.js";
import { TOOL_NAME } from "../../tools/constants/index.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_PHASE_STATUS, HOOK_POINT } from "@noobot/hook-protocol";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import { resolveControlToolOutcome } from "../control-tool-outcome.js";
import { text } from "@noobot/shared/value";

function updateToolFailureState({ modelState, toolCallResult }) {
  const systemRuntime = getSystemRuntimeFromRuntime(modelState.runtime);
  const toolName = text(toolCallResult?.call?.name);
  if (!toolName) return;
  const nextFailureCount = toolCallResult?.success
    ? 0
    : systemRuntime.toolConsecutiveFailureCount + 1;
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
  const { runtime } = modelState;
  const { eventListener } = runtime;
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  emitEvent(eventListener, "tool_calls_detected", { turn, count: calls.length });
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.BEFORE_TOOL_CALLS,
    context: buildHookContext(HOOK_POINT.AGENT.BEFORE_TOOL_CALLS, runtime, {
      phase: "tool_calls",
      status: HOOK_PHASE_STATUS.RUNNING,
      turn,
      toolCallCount: calls.length,
      calls,
      agentContext: modelState.agentContext,
    }),
  });

  const toolCallSettlements = await Promise.all(
    calls.map(async (call) => {
      const tool = toolMap.get(call.name);
      return settleToolCallInTurn({
        call,
        tool,
        turn,
        executionScope: "primary",
        errorLogger,
        runtime,
        agentContext: modelState.agentContext,
        abortSignal: runtime.abortSignal,
      });
    }),
  );
  const toolCallResults = toolCallSettlements.map((settlement) => settlement.result);

  const taskSummaryOutcome = resolveControlToolOutcome(toolCallResults, TOOL_NAME.TASK_SUMMARY);
  const hasHelpCall = toolCallResults.some((result) => text(result?.call?.name) === HELP_TOOL_NAME);

  if (taskSummaryOutcome.accepted) {
    loopState.taskSummaryTriggered = true;
  }

  const commitToolResults = async () => {
    for (const [resultIndex, toolCallResult] of toolCallResults.entries()) {
      const call = calls[resultIndex];
      if (!call) {
        throw new Error("tool result has no authoritative call in its execution batch");
      }
      const toolResultText = String(toolCallResult?.toolResultText || "");
      await stateCommitter.pushToolResult({
        call,
        toolResultText,
        transferEnvelopes: toolCallResult?.transferEnvelopes || [],
      });
      updateToolFailureState({ modelState, toolCallResult });
    }
  };
  await runtime.withCurrentTurnPersistenceBatch(commitToolResults);
  await runtime.consumeUserInterjections();

  const rejectedSettlement = toolCallSettlements.find(
    (settlement) => settlement.status === "rejected",
  );
  if (rejectedSettlement) throw rejectedSettlement.error;

  if (hasHelpCall) {
    systemRuntime.toolConsecutiveFailureCount = 0;
  }
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.AFTER_TOOL_CALLS,
    context: buildHookContext(HOOK_POINT.AGENT.AFTER_TOOL_CALLS, runtime, {
      phase: "tool_calls",
      status: HOOK_PHASE_STATUS.SUCCESS,
      turn,
      toolCallCount: calls.length,
      calls,
      toolCallResults,
      taskSummaryOutcome,
      hasHelpCall,
      agentContext: modelState.agentContext,
    }),
  });

  return {
    toolCallResults,
    taskSummaryOutcome,
    hasHelpCall,
  };
}
