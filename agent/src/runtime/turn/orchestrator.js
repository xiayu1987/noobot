/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  collectScopedMessagesToSummarize,
  DEFAULT_TASK_SUMMARY_TOOL_NAME as TASK_SUMMARY_TOOL_NAME,
  DEFAULT_TASK_CHECK_TOOL_NAME as TASK_CHECK_TOOL_NAME,
} from "@noobot/context-protocol/summary-policy";
import { emitEvent } from "../../events/index.js";
import { tEngine } from "../i18n-adapter.js";
import { DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS } from "../constants/index.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/injected-message-policy";
import { handleEngineError } from "../errors/index.js";
import {
  maybeFinalizeNoToolsAfterPhaseSummaryOverflow,
  maybePromptHelpToolByFailure,
  maybePromptHelpToolByLoop,
  maybeRequestPhaseSummary,
  maybeRequestTaskCheck,
} from "../loop-control.js";
import { resolveLlmForTurn } from "../../models/runtime/model-manager.js";
import { assertNotAborted } from "../utils/error-utils.js";
import { processToolResults } from "./response-processor.js";
import { invokeNoToolsTurn, invokeWithToolsTurn } from "./turn-executor.js";
import { buildLoopResult } from "./turn-result-aggregator.js";
import {
  getSessionIdsFromAgentContext,
  getSystemRuntimeFromRuntime,
} from "../../context/agent-context-accessor.js";
import { removeContextMessagesByIds } from "@noobot/context-protocol/context-mutation";
import { getMessageId } from "@noobot/context-protocol/message-store";
import {
  clearMainFlowFinalNoToolsTurnInstruction,
  consumeMainFlowFinalNoToolsTurnInstruction,
  markMainFlowFinalNoToolsTurnActive,
  requestMainFlowSummaryCheckpoint,
} from "../main-flow-control.js";
import { consumeSummaryCheckpointCommand } from "../summary-checkpoint-command.js";
import { appendTurnContextControlMessage } from "./turn-context-message-appender.js";

export function createTurnOrchestrator({
  resolveLlmForTurnFn = resolveLlmForTurn,
  assertNotAbortedFn = assertNotAborted,
  invokeNoToolsTurnFn = invokeNoToolsTurn,
  invokeWithToolsTurnFn = invokeWithToolsTurn,
  processToolResultsFn = processToolResults,
  buildLoopResultFn = buildLoopResult,
  maybeRequestPhaseSummaryFn = maybeRequestPhaseSummary,
  maybeRequestTaskCheckFn = maybeRequestTaskCheck,
  maybeFinalizeNoToolsAfterPhaseSummaryOverflowFn = maybeFinalizeNoToolsAfterPhaseSummaryOverflow,
  maybePromptHelpToolByLoopFn = maybePromptHelpToolByLoop,
  maybePromptHelpToolByFailureFn = maybePromptHelpToolByFailure,
  handleEngineErrorFn = handleEngineError,
} = {}) {
  function resolveTaskSummaryCall(calls = []) {
    return (
      (Array.isArray(calls) ? calls : []).find(
        (call = {}) => String(call?.name || "").trim() === TASK_SUMMARY_TOOL_NAME,
      ) || null
    );
  }

  function resolveTaskCheckCall(calls = []) {
    return (
      (Array.isArray(calls) ? calls : []).find(
        (call = {}) => String(call?.name || "").trim() === TASK_CHECK_TOOL_NAME,
      ) || null
    );
  }

  function removeLastAssistantToolCallMessage({
    loopState: targetLoopState,
    turnMessageStore = null,
  } = {}) {
    const modelMessages = targetLoopState?.modelContext?.messages;
    const lastMessage = Array.isArray(modelMessages)
      ? modelMessages[modelMessages.length - 1]
      : null;
    const lastToolCalls = Array.isArray(lastMessage?.tool_calls) ? lastMessage.tool_calls : [];
    if (lastToolCalls.length) {
      const messageId = getMessageId(lastMessage);
      if (!messageId) {
        throw new Error("assistant tool-call message requires a canonical context message id");
      }
      removeContextMessagesByIds(targetLoopState.modelContext, [messageId]);
    }
    if (turnMessageStore && typeof turnMessageStore.removeLast === "function") {
      turnMessageStore.removeLast(
        (item = {}) => item?.role === "assistant" && item?.type === "tool_call",
      );
    }
  }

  async function runFunctionCallLoop({ modelState, loopState, turn = 1 }) {
    const { tools, traces, maxTurns } = loopState;
    const { abortSignal, runtime, eventListener } = modelState;
    const overMaxTurnsCount = Math.max(0, Number(turn || 0) - Number(maxTurns || 0));
    const loopLimitBufferTurns = DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS;
    const isOverMaxTurns = overMaxTurnsCount > 0;
    const isBeyondLoopLimitBuffer = overMaxTurnsCount > loopLimitBufferTurns;

    async function invokeFinalNoToolsTurn({
      finalTurn = turn,
      instruction = null,
      eventName = "main_flow_final_no_tools_turn_enforced",
    } = {}) {
      const systemRuntime = getSystemRuntimeFromRuntime(runtime);
      markMainFlowFinalNoToolsTurnActive(systemRuntime, true);
      emitEvent(eventListener, eventName, {
        turn: finalTurn,
        reason: String(instruction?.reason || "").trim(),
        source: String(instruction?.source || "").trim(),
      });
      try {
        const noToolsResult = await invokeNoToolsTurnFn({
          modelState,
          loopState,
          turn: finalTurn,
          forceToolChoiceNone: true,
        });
        return buildLoopResultFn({
          output: noToolsResult.output,
          assistantMessageId: noToolsResult.assistantMessageId,
          traces,
          loopState,
          turnTaskStore: noToolsResult.turnTaskStore,
          turnMessageStore: noToolsResult.turnMessageStore,
          modelMessages: noToolsResult.modelMessages,
          finalStreaming: noToolsResult.finalStreaming,
        });
      } finally {
        markMainFlowFinalNoToolsTurnActive(systemRuntime, false);
        clearMainFlowFinalNoToolsTurnInstruction(systemRuntime);
      }
    }

    try {
      assertNotAbortedFn(abortSignal, runtime);

      if (isBeyondLoopLimitBuffer && loopState?.loopLimitFinalizePrompted === true) {
        emitEvent(eventListener, "tool_loop_limit_reached", {
          turn,
          maxTurns,
          bufferTurns: loopLimitBufferTurns,
          overMaxTurnsCount,
        });
        const finalResult = await invokeNoToolsTurnFn({
          modelState,
          loopState,
          turn,
          forceToolChoiceNone: true,
        });
        return buildLoopResultFn({
          output: finalResult.output,
          assistantMessageId: finalResult.assistantMessageId,
          traces,
          loopState,
          turnTaskStore: finalResult.turnTaskStore,
          turnMessageStore: finalResult.turnMessageStore,
          modelMessages: finalResult.modelMessages,
          finalStreaming: finalResult.finalStreaming,
        });
      }

      if (isOverMaxTurns && loopState?.loopLimitFinalizePrompted !== true) {
        appendTurnContextControlMessage({
          runtime,
          loopState,
          content: tEngine(runtime, "toolLoopLimitFinalizePrompt", { maxTurns }),
          internalType: CONTEXT_INJECTED_MESSAGE_TYPE.TOOL_LOOP_LIMIT_FINALIZE_PROMPT,
        });
        loopState.loopLimitFinalizePrompted = true;
        emitEvent(eventListener, "tool_loop_limit_finalize_prompted", {
          turn,
          maxTurns,
          bufferTurns: loopLimitBufferTurns,
          overMaxTurnsCount,
        });
      }

      resolveLlmForTurnFn(modelState);

      const systemRuntime = getSystemRuntimeFromRuntime(runtime);
      maybeFinalizeNoToolsAfterPhaseSummaryOverflowFn({ modelState, loopState });
      const mainFlowFinalNoToolsInstruction =
        consumeMainFlowFinalNoToolsTurnInstruction(systemRuntime);
      if (mainFlowFinalNoToolsInstruction) {
        return invokeFinalNoToolsTurn({
          finalTurn: turn,
          instruction: mainFlowFinalNoToolsInstruction,
          eventName: "main_flow_final_no_tools_turn_enforced",
        });
      }

      if (!Array.isArray(tools) || tools.length === 0) {
        const noToolsResult = await invokeNoToolsTurnFn({ modelState, loopState, turn });
        return buildLoopResultFn({
          output: noToolsResult.output,
          assistantMessageId: noToolsResult.assistantMessageId,
          traces,
          loopState,
          turnTaskStore: noToolsResult.turnTaskStore,
          turnMessageStore: noToolsResult.turnMessageStore,
          modelMessages: noToolsResult.modelMessages,
          finalStreaming: noToolsResult.finalStreaming,
        });
      }

      const withToolsResult = await invokeWithToolsTurnFn({ modelState, loopState, turn });
      await consumeSummaryCheckpointCommand({ runtime, loopState, eventListener, turn });
      if (withToolsResult?.mainFlowFinalNoToolsRequested === true) {
        const instruction =
          consumeMainFlowFinalNoToolsTurnInstruction(systemRuntime) ||
          withToolsResult.mainFlowFinalNoToolsInstruction ||
          null;
        return invokeFinalNoToolsTurn({
          finalTurn: turn,
          instruction,
          eventName: "main_flow_final_no_tools_turn_enforced",
        });
      }
      const { aiContentText, calls, turnMessageStore, turnTaskStore, stateCommitter } =
        withToolsResult;

      if (!calls.length) {
        if (isOverMaxTurns) {
          loopState.toolChoiceRetryPrompted = false;
          return buildLoopResultFn({
            output: aiContentText,
            assistantMessageId: withToolsResult.assistantMessageId,
            traces,
            loopState,
            turnTaskStore,
            turnMessageStore,
            modelMessages: loopState.modelContext.messages,
            finalStreaming: withToolsResult.finalStreaming,
          });
        }
        loopState.toolChoiceRetryPrompted = false;
        return buildLoopResultFn({
          output: aiContentText,
          assistantMessageId: withToolsResult.assistantMessageId,
          traces,
          loopState,
          turnTaskStore,
          turnMessageStore,
          modelMessages: loopState.modelContext.messages,
          finalStreaming: withToolsResult.finalStreaming,
        });
      }
      loopState.toolChoiceRetryPrompted = false;

      const taskSummaryCall = resolveTaskSummaryCall(calls);
      const taskCheckCall = resolveTaskCheckCall(calls);
      const controlToolCall = taskSummaryCall || taskCheckCall;
      if (calls.length > 1 && controlToolCall) {
        removeLastAssistantToolCallMessage({ loopState, turnMessageStore });
        appendTurnContextControlMessage({
          runtime,
          loopState,
          content: tEngine(
            runtime,
            taskSummaryCall ? "taskSummarySingleToolPrompt" : "taskCheckSingleToolPrompt",
          ),
          internalType: taskSummaryCall
            ? CONTEXT_INJECTED_MESSAGE_TYPE.TASK_SUMMARY_SINGLE_TOOL_RETRY_PROMPT
            : CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_SINGLE_TOOL_RETRY_PROMPT,
        });
        emitEvent(
          eventListener,
          taskSummaryCall
            ? "task_summary_multi_tool_call_rejected"
            : "task_check_multi_tool_call_rejected",
          {
            turn,
            toolCallCount: calls.length,
            controlToolName: String(controlToolCall?.name || "").trim(),
            ...(taskSummaryCall ? { taskSummaryToolName: TASK_SUMMARY_TOOL_NAME } : {}),
            ...(taskCheckCall ? { taskCheckToolName: TASK_CHECK_TOOL_NAME } : {}),
          },
        );
        return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
      }

      if (isBeyondLoopLimitBuffer) {
        removeLastAssistantToolCallMessage({ loopState, turnMessageStore });
        emitEvent(eventListener, "tool_loop_limit_reached", {
          turn,
          maxTurns,
          bufferTurns: loopLimitBufferTurns,
          overMaxTurnsCount,
          toolCallCount: calls.length,
          afterFinalizePrompt: true,
        });
        const finalResult = await invokeNoToolsTurnFn({
          modelState,
          loopState,
          turn,
          forceToolChoiceNone: true,
        });
        return buildLoopResultFn({
          output: finalResult.output,
          assistantMessageId: finalResult.assistantMessageId,
          traces,
          loopState,
          turnTaskStore: finalResult.turnTaskStore,
          turnMessageStore: finalResult.turnMessageStore,
          modelMessages: finalResult.modelMessages,
          finalStreaming: finalResult.finalStreaming,
        });
      }

      const { toolCallResults, hasTaskSummaryCall, hasRequestHelpCall, hasFinalAnswerCall } =
        await processToolResultsFn({
          modelState,
          loopState,
          turn,
          calls,
          toolMap: withToolsResult.toolMap,
          stateCommitter,
        });

      loopState.turnMessages = turnMessageStore.toArray();
      loopState.turnTasks = turnTaskStore.toArray();

      maybeRequestPhaseSummaryFn({ modelState, loopState, toolCallResults });
      maybeRequestTaskCheckFn({ modelState, loopState, toolCallResults });
      maybePromptHelpToolByLoopFn({ modelState, loopState });
      maybePromptHelpToolByFailureFn({
        modelState,
        loopState,
        hasRequestHelpCall,
      });

      if (hasTaskSummaryCall) {
        const incrementalMessages = Array.isArray(
          loopState?.modelContext?.messageBlocks?.incremental,
        )
          ? loopState.modelContext.messageBlocks.incremental
          : [];
        const summaryTargets = collectScopedMessagesToSummarize(incrementalMessages, {
          maxMessages: incrementalMessages.length,
          limitToProvidedMessagesOnly: true,
          retentionMessages: incrementalMessages,
          taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
        }).messages;
        requestMainFlowSummaryCheckpoint(runtime, {
          source: "task_summary",
          summarizedMessageIds: summaryTargets
            .map((message) =>
              String(
                message?.messageUid || message?.additional_kwargs?.noobotMessageId || "",
              ).trim(),
            )
            .filter(Boolean),
        });
        await consumeSummaryCheckpointCommand({ runtime, loopState, eventListener, turn });
      }

      if (hasFinalAnswerCall) {
        const nextTurn = turn + Math.max(1, calls.length);
        const finalResult = await invokeNoToolsTurnFn({
          modelState,
          loopState,
          turn: nextTurn,
          forceToolChoiceNone: true,
        });
        return buildLoopResultFn({
          output: finalResult.output,
          assistantMessageId: finalResult.assistantMessageId,
          traces,
          loopState,
          turnTaskStore: finalResult.turnTaskStore,
          turnMessageStore: finalResult.turnMessageStore,
          modelMessages: finalResult.modelMessages,
          finalStreaming: finalResult.finalStreaming,
        });
      }

      return runFunctionCallLoop({
        modelState,
        loopState,
        turn: turn + Math.max(1, calls.length),
      });
    } catch (error) {
      const executionIdentity = getSessionIdsFromAgentContext(modelState.agentContext);
      handleEngineErrorFn({
        error,
        eventListener,
        event: "turn_orchestrator_error",
        metadata: {
          source: "turn-orchestrator",
          turn,
          maxTurns,
          hasTools: Array.isArray(tools) && tools.length > 0,
          sessionId: executionIdentity.sessionId,
          parentSessionId: executionIdentity.parentSessionId,
          dialogProcessId: executionIdentity.dialogProcessId,
        },
      });
      throw error;
    }
  }

  return runFunctionCallLoop;
}

export const runFunctionCallLoop = createTurnOrchestrator();
