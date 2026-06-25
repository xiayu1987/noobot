/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import {
  markCurrentTurnModelMessagesSummarized,
  markCurrentTurnStoreSummarized,
} from "../../../context/session/summarized-message-policy.js";
import { emitEvent } from "../../../event/index.js";
import { tEngine } from "../i18n-adapter.js";
import {
  DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS,
  TASK_SUMMARY_TOOL_NAME,
} from "../constants/index.js";
import { handleEngineError } from "../error/index.js";
import {
  maybeFinalizeNoToolsAfterPhaseSummaryOverflow,
  maybePromptHelpToolByFailure,
  maybePromptHelpToolByLoop,
  maybeRequestPhaseSummary,
  removePhaseSummaryPromptMessages,
} from "../loop-control.js";
import { resolveLlmForTurn } from "../model/model-manager.js";
import { assertNotAborted } from "../utils/error-utils.js";
import { processToolResults } from "./response-processor.js";
import { invokeNoToolsTurn, invokeWithToolsTurn } from "./turn-executor.js";
import { buildLoopResult } from "./turn-result-aggregator.js";
import { resolveForceToolCall } from "../../../utils/shared-utils.js";
import { resolveDialogProcessIdFromContext } from "../../../context/session/dialog-process-id-resolver.js";
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../../context/parent-session-id-resolver.js";
import { appendMessage } from "../message-context/message-store.js";
import {
  clearMainFlowFinalNoToolsTurnInstruction,
  consumeMainFlowFinalNoToolsTurnInstruction,
  markMainFlowFinalNoToolsTurnActive,
} from "../main-flow-control.js";

export function createTurnOrchestrator({
  resolveLlmForTurnFn = resolveLlmForTurn,
  assertNotAbortedFn = assertNotAborted,
  invokeNoToolsTurnFn = invokeNoToolsTurn,
  invokeWithToolsTurnFn = invokeWithToolsTurn,
  processToolResultsFn = processToolResults,
  buildLoopResultFn = buildLoopResult,
  removePhaseSummaryPromptMessagesFn = removePhaseSummaryPromptMessages,
  maybeRequestPhaseSummaryFn = maybeRequestPhaseSummary,
  maybeFinalizeNoToolsAfterPhaseSummaryOverflowFn = maybeFinalizeNoToolsAfterPhaseSummaryOverflow,
  maybePromptHelpToolByLoopFn = maybePromptHelpToolByLoop,
  maybePromptHelpToolByFailureFn = maybePromptHelpToolByFailure,
  handleEngineErrorFn = handleEngineError,
} = {}) {
  function removeToolChoiceRequiredRetryPrompts(messages = []) {
    if (!Array.isArray(messages)) return 0;
    let removedCount = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const marker =
        message?.additional_kwargs?.noobotInternalMessageType ||
        message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
        message?.metadata?.noobotInternalMessageType ||
        message?.lc_kwargs?.metadata?.noobotInternalMessageType ||
        "";
      if (marker !== "tool_choice_required_retry_prompt") continue;
      messages.splice(index, 1);
      removedCount += 1;
    }
    return removedCount;
  }

  function resolveTaskSummaryCall(calls = []) {
    return (Array.isArray(calls) ? calls : []).find(
      (call = {}) => String(call?.name || "").trim() === TASK_SUMMARY_TOOL_NAME,
    ) || null;
  }

  function removeLastAssistantToolCallMessage({ loopState: targetLoopState, turnMessageStore = null } = {}) {
    const lastMessage = Array.isArray(targetLoopState?.messages)
      ? targetLoopState.messages[targetLoopState.messages.length - 1]
      : null;
    const lastToolCalls = Array.isArray(lastMessage?.tool_calls)
      ? lastMessage.tool_calls
      : [];
    if (lastToolCalls.length) {
      targetLoopState.messages.pop();
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
          traces,
          loopState,
          turnTaskStore: finalResult.turnTaskStore,
          turnMessageStore: finalResult.turnMessageStore,
          modelMessages: finalResult.modelMessages,
          finalStreaming: finalResult.finalStreaming,
        });
      }

      if (isOverMaxTurns && loopState?.loopLimitFinalizePrompted !== true) {
        appendMessage(loopState, new HumanMessage({
          content: tEngine(runtime, "toolLoopLimitFinalizePrompt", { maxTurns }),
          additional_kwargs: {
            noobotInternalMessageType: "tool_loop_limit_finalize_prompt",
          },
        }), { block: "incremental" });
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
          eventName:
            mainFlowFinalNoToolsInstruction.source === "phase_summary_legacy_flag"
              ? "phase_summary_no_tools_turn_enforced"
              : "main_flow_final_no_tools_turn_enforced",
        });
      }

      if (!Array.isArray(tools) || tools.length === 0) {
        const noToolsResult = await invokeNoToolsTurnFn({ modelState, loopState, turn });
        return buildLoopResultFn({
          output: noToolsResult.output,
          traces,
          loopState,
          turnTaskStore: noToolsResult.turnTaskStore,
          turnMessageStore: noToolsResult.turnMessageStore,
          modelMessages: noToolsResult.modelMessages,
          finalStreaming: noToolsResult.finalStreaming,
        });
      }

      const withToolsResult = await invokeWithToolsTurnFn({ modelState, loopState, turn });
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
      const {
        aiContentText,
        calls,
        turnMessageStore,
        turnTaskStore,
        stateCommitter,
      } = withToolsResult;

      if (!calls.length) {
        if (isOverMaxTurns) {
          loopState.toolChoiceRetryPrompted = false;
          removeToolChoiceRequiredRetryPrompts(loopState.messages);
          return buildLoopResultFn({
            output: aiContentText,
            traces,
            loopState,
            turnTaskStore,
            turnMessageStore,
            modelMessages: loopState.messages,
            finalStreaming: withToolsResult.finalStreaming,
          });
        }
        const forceTool = resolveForceToolCall(systemRuntime?.config || {});
        if (!forceTool) {
          loopState.toolChoiceRetryPrompted = false;
          removeToolChoiceRequiredRetryPrompts(loopState.messages);
          return buildLoopResultFn({
            output: aiContentText,
            traces,
            loopState,
            turnTaskStore,
            turnMessageStore,
            modelMessages: loopState.messages,
            finalStreaming: withToolsResult.finalStreaming,
          });
        }
        if (loopState?.toolChoiceRetryPrompted === true) {
          loopState.toolChoiceRetryPrompted = false;
          return buildLoopResultFn({
            output: aiContentText,
            traces,
            loopState,
            turnTaskStore,
            turnMessageStore,
            modelMessages: loopState.messages,
            finalStreaming: withToolsResult.finalStreaming,
          });
        }
        if (Array.isArray(loopState?.messages)) {
          removeToolChoiceRequiredRetryPrompts(loopState.messages);
        }
        appendMessage(loopState, new HumanMessage({
          content: tEngine(runtime, "toolChoiceRequiredRetryPrompt"),
          additional_kwargs: {
            noobotInternalMessageType: "tool_choice_required_retry_prompt",
          },
        }), { block: "incremental" });
        loopState.toolChoiceRetryPrompted = true;
        emitEvent(eventListener, "tool_choice_required_retry_prompted", { turn });
        return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
      }
      loopState.toolChoiceRetryPrompted = false;

      const taskSummaryCall = resolveTaskSummaryCall(calls);
      if (calls.length > 1 && taskSummaryCall) {
        removeLastAssistantToolCallMessage({ loopState, turnMessageStore });
        appendMessage(loopState, new HumanMessage({
          content: tEngine(runtime, "taskSummarySingleToolPrompt"),
          additional_kwargs: {
            noobotInternalMessageType: "task_summary_single_tool_retry_prompt",
          },
        }), { block: "incremental" });
        emitEvent(eventListener, "task_summary_multi_tool_call_rejected", {
          turn,
          toolCallCount: calls.length,
          taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
        });
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
          traces,
          loopState,
          turnTaskStore: finalResult.turnTaskStore,
          turnMessageStore: finalResult.turnMessageStore,
          modelMessages: finalResult.modelMessages,
          finalStreaming: finalResult.finalStreaming,
        });
      }

      const {
        toolCallResults,
        hasTaskSummaryCall,
        hasRequestHelpCall,
        hasFinalAnswerCall,
      } =
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

      if (hasTaskSummaryCall) {
        removePhaseSummaryPromptMessagesFn(loopState.messages, runtime);
      }

      maybeRequestPhaseSummaryFn({ modelState, loopState, toolCallResults });
      maybePromptHelpToolByLoopFn({ modelState, loopState });
      maybePromptHelpToolByFailureFn({
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
      const systemRuntime = runtime?.systemRuntime || {};
      handleEngineErrorFn({
        error,
        eventListener,
        event: "turn_orchestrator_error",
        metadata: {
          source: "turn-orchestrator",
          turn,
          maxTurns,
          hasTools: Array.isArray(tools) && tools.length > 0,
          sessionId: String(systemRuntime?.sessionId || runtime?.sessionId || "").trim(),
          parentSessionId: resolveParentSessionId({ runtime }),
          dialogProcessId: resolveDialogProcessIdFromContext({ runtime }),
        },
      });
      throw error;
    }
  }

  return runFunctionCallLoop;
}

export const runFunctionCallLoop = createTurnOrchestrator();
