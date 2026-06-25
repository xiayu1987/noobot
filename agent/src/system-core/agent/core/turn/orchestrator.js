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
  maybePromptHelpToolByFailure,
  maybePromptHelpToolByLoop,
  maybeRequestPhaseSummary,
  removePhaseSummaryPromptMessages,
} from "../loop-control.js";
import { resolveLlmForTurn } from "../model/model-manager.js";
import { assertNotAborted } from "../utils/error-utils.js";
import { commitSyntheticToolTurn, processToolResults } from "./response-processor.js";
import { invokeNoToolsTurn, invokeWithToolsTurn } from "./turn-executor.js";
import { buildLoopResult } from "./turn-result-aggregator.js";
import { resolveForceToolCall } from "../../../utils/shared-utils.js";
import { resolveDialogProcessIdFromContext } from "../../../context/session/dialog-process-id-resolver.js";
import { getSystemRuntimeFromRuntime } from "../../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../../context/parent-session-id-resolver.js";
import { appendMessage } from "../message-context/message-store.js";

export function createTurnOrchestrator({
  resolveLlmForTurnFn = resolveLlmForTurn,
  assertNotAbortedFn = assertNotAborted,
  invokeNoToolsTurnFn = invokeNoToolsTurn,
  invokeWithToolsTurnFn = invokeWithToolsTurn,
  processToolResultsFn = processToolResults,
  commitSyntheticToolTurnFn = commitSyntheticToolTurn,
  buildLoopResultFn = buildLoopResult,
  removePhaseSummaryPromptMessagesFn = removePhaseSummaryPromptMessages,
  maybeRequestPhaseSummaryFn = maybeRequestPhaseSummary,
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

  async function runFunctionCallLoop({ modelState, loopState, turn = 1 }) {
    const { tools, traces, maxTurns } = loopState;
    const { abortSignal, runtime, eventListener } = modelState;
    const overMaxTurnsCount = Math.max(0, Number(turn || 0) - Number(maxTurns || 0));
    const loopLimitBufferTurns = DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS;
    const isOverMaxTurns = overMaxTurnsCount > 0;
    const isBeyondLoopLimitBuffer = overMaxTurnsCount > loopLimitBufferTurns;

    try {
      assertNotAbortedFn(abortSignal, runtime);

      if (
        Array.isArray(loopState?.pendingSyntheticToolTurns) &&
        loopState.pendingSyntheticToolTurns.length
      ) {
        const pendingTurn = loopState.pendingSyntheticToolTurns.shift();
        const syntheticResult = await commitSyntheticToolTurnFn({
          modelState,
          loopState,
          pendingTurn,
          turn,
        });
        const {
          toolCallResults = [],
          hasTaskSummaryCall = false,
          hasRequestHelpCall = false,
          hasFinalAnswerCall = false,
          turnMessageStore = pendingTurn?.turnMessageStore || null,
          turnTaskStore = pendingTurn?.turnTaskStore || null,
        } = syntheticResult || {};

        if (turnMessageStore && typeof turnMessageStore.toArray === "function") {
          loopState.turnMessages = turnMessageStore.toArray();
        }
        if (turnTaskStore && typeof turnTaskStore.toArray === "function") {
          loopState.turnTasks = turnTaskStore.toArray();
        }

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
          if (turnMessageStore) {
            markCurrentTurnStoreSummarized(turnMessageStore, {
              taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
            });
          }
        }

        if (hasFinalAnswerCall) {
          const finalResult = await invokeNoToolsTurnFn({
            modelState,
            loopState,
            turn: turn + 1,
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

        return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
      }

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
      if (systemRuntime?.phaseSummaryNoToolsNextTurn === true) {
        systemRuntime.phaseSummaryNoToolsNextTurn = false;
        emitEvent(eventListener, "phase_summary_no_tools_turn_enforced", { turn });
        const noToolsResult = await invokeNoToolsTurnFn({
          modelState,
          loopState,
          turn,
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

      if (isBeyondLoopLimitBuffer) {
        const lastMessage = Array.isArray(loopState?.messages)
          ? loopState.messages[loopState.messages.length - 1]
          : null;
        const lastToolCalls = Array.isArray(lastMessage?.tool_calls)
          ? lastMessage.tool_calls
          : [];
        if (lastToolCalls.length) {
          loopState.messages.pop();
        }
        if (turnMessageStore && typeof turnMessageStore.updateLast === "function") {
          turnMessageStore.updateLast(
            { type: "message", tool_calls: [] },
            (item = {}) => item?.role === "assistant" && item?.type === "tool_call",
          );
        }
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
          syntheticAssistantPayload: withToolsResult.syntheticAssistantPayload,
          turnMessageStore,
          turnTaskStore,
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
        const finalResult = await invokeNoToolsTurnFn({
          modelState,
          loopState,
          turn: turn + 1,
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

      return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
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
