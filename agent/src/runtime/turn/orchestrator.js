/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { collectScopedMessagesToSummarize } from "@noobot/context-protocol/policy/summary";
import { TOOL_NAME } from "../../tools/constants/index.js";
import { emitEvent } from "../../events/index.js";
import { tEngine } from "../i18n-adapter.js";
import { DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS } from "../constants/index.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import { handleEngineError } from "../errors/index.js";
import {
  maybeFinalizeNoToolsAfterPhaseSummaryOverflow,
  maybePromptHelpToolByFailure,
  maybePromptHelpToolByLoop,
  maybeRequestPhaseSummary,
  maybeRequestTaskCheck,
} from "../loop-control.js";
import { resolveLlmForTurn } from "../../models/runtime/model-manager.js";
import { assertNotAborted } from "../../shared/utils/error-utils.js";
import { processToolResults } from "./response-processor.js";
import { invokeNoToolsTurn, invokeWithToolsTurn } from "./turn-executor.js";
import { buildLoopResult } from "./turn-result-aggregator.js";
import { getSessionIdsFromAgentContext } from "../../context/agent-context-accessor.js";
import { resolveContextSessionMessageUid } from "@noobot/context-protocol/message/codec";
import {
  clearMainFlowFinalNoToolsTurnInstruction,
  consumeMainFlowFinalNoToolsTurnInstruction,
  markMainFlowFinalNoToolsTurnActive,
  requestMainFlowSummaryCheckpoint,
} from "../main-flow-control.js";
import { consumeSummaryCheckpointCommand } from "../summary-checkpoint-command.js";
import { appendTurnContextControlMessage } from "./turn-context-message-appender.js";
import {
  recoverMainFlowNoFinalResponse,
  resetNoFinalResponseRetryStreak,
} from "./no-final-response-recovery.js";
import { text } from "@noobot/shared/value";
import { requireActiveModelContext } from "../active-model-context.js";

function withNoFinalResponseRecovery(invokeTurn) {
  return async function invokeTurnWithNoFinalResponseRecovery(input = {}) {
    for (;;) {
      try {
        const result = await invokeTurn(input);
        resetNoFinalResponseRetryStreak(input?.modelState?.runtime);
        return result;
      } catch (error) {
        if (!recoverMainFlowNoFinalResponse({ error, ...input })) throw error;
      }
    }
  };
}

export function createTurnOrchestrator({
  resolveLlmForTurnFn = resolveLlmForTurn,
  assertNotAbortedFn = assertNotAborted,
  invokeNoToolsTurnFn: rawInvokeNoToolsTurnFn = invokeNoToolsTurn,
  invokeWithToolsTurnFn: rawInvokeWithToolsTurnFn = invokeWithToolsTurn,
  processToolResultsFn = processToolResults,
  buildLoopResultFn = buildLoopResult,
  maybeRequestPhaseSummaryFn = maybeRequestPhaseSummary,
  maybeRequestTaskCheckFn = maybeRequestTaskCheck,
  maybeFinalizeNoToolsAfterPhaseSummaryOverflowFn = maybeFinalizeNoToolsAfterPhaseSummaryOverflow,
  maybePromptHelpToolByLoopFn = maybePromptHelpToolByLoop,
  maybePromptHelpToolByFailureFn = maybePromptHelpToolByFailure,
  handleEngineErrorFn = handleEngineError,
} = {}) {
  const invokeNoToolsTurnFn = withNoFinalResponseRecovery(rawInvokeNoToolsTurnFn);
  const invokeWithToolsTurnFn = withNoFinalResponseRecovery(rawInvokeWithToolsTurnFn);

  async function runFunctionCallLoop({ modelState, loopState, turn = 1 }) {
    const { tools, traces, maxTurns } = loopState;
    const { runtime } = modelState;
    const { abortSignal, eventListener } = runtime;
    const overMaxTurnsCount = Math.max(0, Number(turn || 0) - Number(maxTurns || 0));
    const loopLimitBufferTurns = DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS;
    const isOverMaxTurns = overMaxTurnsCount > 0;
    const isBeyondLoopLimitBuffer = overMaxTurnsCount > loopLimitBufferTurns;

    async function continueForAcceptedUserInterjections(nextTurn = turn + 1) {
      if (runtime.sealUserInterjectionQueueIfEmpty()) return null;
      const consumed = await runtime.consumeUserInterjections();
      if (!Array.isArray(consumed) || consumed.length === 0) {
        if (runtime.sealUserInterjectionQueueIfEmpty()) return null;
      }
      emitEvent(eventListener, "user_interjections_continued_model_loop", {
        turn,
        nextTurn,
        count: Array.isArray(consumed) ? consumed.length : 0,
      });
      return runFunctionCallLoop({ modelState, loopState, turn: nextTurn });
    }

    async function invokeFinalNoToolsTurn({
      finalTurn = turn,
      instruction = null,
      eventName = "main_flow_final_no_tools_turn_enforced",
    } = {}) {
      markMainFlowFinalNoToolsTurnActive(runtime, true);
      emitEvent(eventListener, eventName, {
        turn: finalTurn,
        reason: text(instruction?.reason),
        source: text(instruction?.source),
      });
      try {
        const noToolsResult = await invokeNoToolsTurnFn({
          modelState,
          loopState,
          turn: finalTurn,
          forceToolChoiceNone: true,
        });
        const continuedResult = await continueForAcceptedUserInterjections(turn + 1);
        if (continuedResult) return continuedResult;
        return buildLoopResultFn({
          output: noToolsResult.output,
          modelMessageId: noToolsResult.modelMessageId,
          traces,
          loopState,
          turnMessageStore: noToolsResult.turnMessageStore,
          modelMessages: noToolsResult.modelMessages,
        });
      } finally {
        markMainFlowFinalNoToolsTurnActive(runtime, false);
        clearMainFlowFinalNoToolsTurnInstruction(runtime);
      }
    }

    try {
      assertNotAbortedFn(abortSignal);

      if (isOverMaxTurns && loopState?.loopLimitFinalizePrompted !== true) {
        appendTurnContextControlMessage({
          runtime,
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

      if (isBeyondLoopLimitBuffer) {
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
        const continuedResult = await continueForAcceptedUserInterjections(turn + 1);
        if (continuedResult) return continuedResult;
        return buildLoopResultFn({
          output: finalResult.output,
          modelMessageId: finalResult.modelMessageId,
          traces,
          loopState,
          turnMessageStore: finalResult.turnMessageStore,
          modelMessages: finalResult.modelMessages,
        });
      }

      resolveLlmForTurnFn(modelState);

      maybeFinalizeNoToolsAfterPhaseSummaryOverflowFn({ modelState, loopState });
      const mainFlowFinalNoToolsInstruction = consumeMainFlowFinalNoToolsTurnInstruction(runtime);
      if (mainFlowFinalNoToolsInstruction) {
        return invokeFinalNoToolsTurn({
          finalTurn: turn,
          instruction: mainFlowFinalNoToolsInstruction,
          eventName: "main_flow_final_no_tools_turn_enforced",
        });
      }

      if (!Array.isArray(tools) || tools.length === 0) {
        const noToolsResult = await invokeNoToolsTurnFn({ modelState, loopState, turn });
        const continuedResult = await continueForAcceptedUserInterjections(turn + 1);
        if (continuedResult) return continuedResult;
        return buildLoopResultFn({
          output: noToolsResult.output,
          modelMessageId: noToolsResult.modelMessageId,
          traces,
          loopState,
          turnMessageStore: noToolsResult.turnMessageStore,
          modelMessages: noToolsResult.modelMessages,
        });
      }

      const withToolsResult = await invokeWithToolsTurnFn({ modelState, loopState, turn });
      await consumeSummaryCheckpointCommand({ runtime, eventListener, turn });
      if (withToolsResult?.mainFlowFinalNoToolsRequested === true) {
        return invokeFinalNoToolsTurn({
          finalTurn: turn,
          instruction: consumeMainFlowFinalNoToolsTurnInstruction(runtime),
          eventName: "main_flow_final_no_tools_turn_enforced",
        });
      }
      const { rejectedControlToolBatch } = withToolsResult;
      if (rejectedControlToolBatch) {
        const isTaskSummary = rejectedControlToolBatch.controlToolName === TOOL_NAME.TASK_SUMMARY;
        appendTurnContextControlMessage({
          runtime,
          content: tEngine(
            runtime,
            isTaskSummary ? "taskSummarySingleToolPrompt" : "taskCheckSingleToolPrompt",
          ),
          internalType: isTaskSummary
            ? CONTEXT_INJECTED_MESSAGE_TYPE.TASK_SUMMARY_SINGLE_TOOL_RETRY_PROMPT
            : CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_SINGLE_TOOL_RETRY_PROMPT,
        });
        emitEvent(
          eventListener,
          isTaskSummary
            ? "task_summary_multi_tool_call_rejected"
            : "task_check_multi_tool_call_rejected",
          { turn, ...rejectedControlToolBatch },
        );
        return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
      }
      const { aiContentText, calls, turnMessageStore, stateCommitter } = withToolsResult;

      if (!calls.length) {
        const continuedResult = await continueForAcceptedUserInterjections(turn + 1);
        if (continuedResult) return continuedResult;
        return buildLoopResultFn({
          output: aiContentText,
          modelMessageId: withToolsResult.modelMessageId,
          traces,
          loopState,
          turnMessageStore,
          modelMessages: requireActiveModelContext(runtime).messages,
        });
      }

      const { toolCallResults, taskSummaryOutcome, hasHelpCall } = await processToolResultsFn({
        modelState,
        loopState,
        turn,
        calls,
        toolMap: withToolsResult.toolMap,
        stateCommitter,
      });

      maybeRequestPhaseSummaryFn({ modelState, loopState, toolCallResults });
      maybeRequestTaskCheckFn({ modelState, loopState, toolCallResults });
      maybePromptHelpToolByLoopFn({ modelState, loopState });
      maybePromptHelpToolByFailureFn({
        modelState,
        loopState,
        hasHelpCall,
      });

      if (taskSummaryOutcome?.accepted === true) {
        const incrementalMessages = requireActiveModelContext(runtime).messageBlocks.incremental;
        const summaryTargets = collectScopedMessagesToSummarize(incrementalMessages, {
          maxMessages: incrementalMessages.length,
          limitToProvidedMessagesOnly: true,
          retentionMessages: incrementalMessages,
        }).messages;
        const summarizedMessageUids = [
          ...new Set(summaryTargets.map(resolveContextSessionMessageUid).filter(Boolean)),
        ];
        if (summarizedMessageUids.length) {
          requestMainFlowSummaryCheckpoint(runtime, {
            source: "task_summary",
            summarizedMessageUids,
          });
          await consumeSummaryCheckpointCommand({ runtime, eventListener, turn });
        }
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
        abortSignal,
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
