/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { tEngine } from "../i18n-adapter.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import { handleEngineError } from "../errors/index.js";
import {
  maybePromptHelpToolByFailure,
  maybePromptHelpToolByLoop,
  maybeRequestTaskCheck,
} from "../loop-control.js";
import { resolveLlmForTurn } from "../../models/runtime/model-manager.js";
import { assertNotAborted } from "../../shared/utils/error-utils.js";
import { processToolResults } from "./response-processor.js";
import { invokeNoToolsTurn, invokeWithToolsTurn } from "./turn-executor.js";
import { buildLoopResult } from "./turn-result-aggregator.js";
import { getSessionIdsFromAgentContext } from "../../context/agent-context-accessor.js";
import { markMainFlowFinalNoToolsTurnActive } from "../main-flow-control.js";
import { consumeSummaryCheckpointCommand } from "../summary-checkpoint-command.js";
import { appendTurnRuntimeInjectedMessage } from "./turn-context-message-appender.js";
import {
  recoverMainFlowNoFinalResponse,
  resetNoFinalResponseRetryStreak,
} from "./no-final-response-recovery.js";
import { requireActiveModelContext } from "../active-model-context.js";

async function attemptTurn(invokeTurn, input) {
  try {
    const result = await invokeTurn(input);
    resetNoFinalResponseRetryStreak(input?.modelState?.runtime);
    return { result };
  } catch (error) {
    if (!recoverMainFlowNoFinalResponse({ error, ...input })) throw error;
    return null;
  }
}

function withNoFinalResponseRecovery(invokeTurn) {
  return async function invokeTurnWithNoFinalResponseRecovery(input = {}) {
    for (;;) {
      const attempt = await attemptTurn(invokeTurn, input);
      if (attempt) return attempt.result;
    }
  };
}

function promptLoopLimitFinalization({
  runtime,
  loopState,
  turn,
  maxTurns,
  bufferTurns,
  overMaxTurnsCount,
}) {
  if (overMaxTurnsCount <= 0 || loopState.loopLimitFinalizePrompted === true) return;
  appendTurnRuntimeInjectedMessage({
    runtime,
    content: tEngine(runtime, "toolLoopLimitFinalizePrompt", { maxTurns }),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.TOOL_LOOP_LIMIT_FINALIZE_PROMPT,
  });
  loopState.loopLimitFinalizePrompted = true;
  emitEvent(runtime.eventListener, "tool_loop_limit_finalize_prompted", {
    turn,
    maxTurns,
    bufferTurns,
    overMaxTurnsCount,
  });
}

function promptRejectedTaskCheck(runtime, turn, rejectedControlToolBatch) {
  appendTurnRuntimeInjectedMessage({
    runtime,
    content: tEngine(runtime, "taskCheckSingleToolPrompt"),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_SINGLE_TOOL_RETRY_PROMPT,
  });
  emitEvent(runtime.eventListener, "task_check_multi_tool_call_rejected", {
    turn,
    ...rejectedControlToolBatch,
  });
}

function reportOrchestratorError({
  error,
  modelState,
  turn,
  maxTurns,
  tools,
  handleEngineErrorFn,
}) {
  const { abortSignal, eventListener } = modelState.runtime;
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
}

export function createTurnOrchestrator({
  resolveLlmForTurnFn = resolveLlmForTurn,
  assertNotAbortedFn = assertNotAborted,
  invokeNoToolsTurnFn: rawInvokeNoToolsTurnFn = invokeNoToolsTurn,
  invokeWithToolsTurnFn: rawInvokeWithToolsTurnFn = invokeWithToolsTurn,
  processToolResultsFn = processToolResults,
  buildLoopResultFn = buildLoopResult,
  maybeRequestTaskCheckFn = maybeRequestTaskCheck,
  maybePromptHelpToolByLoopFn = maybePromptHelpToolByLoop,
  maybePromptHelpToolByFailureFn = maybePromptHelpToolByFailure,
  handleEngineErrorFn = handleEngineError,
} = {}) {
  const invokeNoToolsTurnFn = withNoFinalResponseRecovery(rawInvokeNoToolsTurnFn);
  const invokeWithToolsTurnFn = withNoFinalResponseRecovery(rawInvokeWithToolsTurnFn);

  async function runFunctionCallLoop({ modelState, loopState, turn: firstTurn = 1 }) {
    const { tools, traces, maxTurns } = loopState;
    const { runtime } = modelState;
    const { abortSignal, eventListener } = runtime;
    const loopLimitBufferTurns = TURN_THRESHOLDS.agent.toolLoopLimitBufferTurns;

    async function consumeAcceptedUserInterjections(turn) {
      if (runtime.sealUserInterjectionQueueIfEmpty()) return false;
      const consumed = await runtime.consumeUserInterjections();
      if (
        (!Array.isArray(consumed) || consumed.length === 0) &&
        runtime.sealUserInterjectionQueueIfEmpty()
      )
        return false;
      emitEvent(eventListener, "user_interjections_continued_model_loop", {
        turn,
        nextTurn: turn + 1,
        count: Array.isArray(consumed) ? consumed.length : 0,
      });
      return true;
    }

    async function completeTurn(turn, { output, modelMessageId, turnMessageStore, modelMessages }) {
      if (await consumeAcceptedUserInterjections(turn)) return { nextTurn: turn + 1 };
      return {
        result: buildLoopResultFn({
          output,
          modelMessageId,
          traces,
          loopState,
          turnMessageStore,
          modelMessages,
        }),
      };
    }

    async function invokeFinalNoToolsTurn(turn) {
      markMainFlowFinalNoToolsTurnActive(runtime, true);
      emitEvent(eventListener, "main_flow_final_no_tools_turn_enforced", {
        turn,
      });
      let noToolsResult;
      try {
        noToolsResult = await invokeNoToolsTurnFn({
          modelState,
          loopState,
          turn,
          forceToolChoiceNone: true,
        });
      } finally {
        markMainFlowFinalNoToolsTurnActive(runtime, false);
      }
      return completeTurn(turn, noToolsResult);
    }

    async function executeTurn(turn) {
      assertNotAbortedFn(abortSignal);
      const overMaxTurnsCount = Math.max(0, turn - Number(maxTurns || 0));

      promptLoopLimitFinalization({
        runtime,
        loopState,
        turn,
        maxTurns,
        bufferTurns: loopLimitBufferTurns,
        overMaxTurnsCount,
      });

      if (overMaxTurnsCount > loopLimitBufferTurns) {
        emitEvent(eventListener, "tool_loop_limit_reached", {
          turn,
          maxTurns,
          bufferTurns: loopLimitBufferTurns,
          overMaxTurnsCount,
        });
        return invokeFinalNoToolsTurn(turn);
      }

      resolveLlmForTurnFn(modelState);

      if (!Array.isArray(tools) || tools.length === 0) {
        const noToolsResult = await invokeNoToolsTurnFn({ modelState, loopState, turn });
        return completeTurn(turn, noToolsResult);
      }

      const withToolsResult = await invokeWithToolsTurnFn({ modelState, loopState, turn });
      await consumeSummaryCheckpointCommand({ runtime, eventListener, turn });
      const { rejectedControlToolBatch } = withToolsResult;
      if (rejectedControlToolBatch) {
        promptRejectedTaskCheck(runtime, turn, rejectedControlToolBatch);
        return { nextTurn: turn + 1 };
      }
      const { aiContentText, calls, turnMessageStore, stateCommitter } = withToolsResult;

      if (!calls.length) {
        return completeTurn(turn, {
          output: aiContentText,
          modelMessageId: withToolsResult.modelMessageId,
          turnMessageStore,
          modelMessages: requireActiveModelContext(runtime).messages,
        });
      }

      const { toolCallResults, hasHelpCall } = await processToolResultsFn({
        modelState,
        loopState,
        turn,
        calls,
        toolMap: withToolsResult.toolMap,
        stateCommitter,
      });

      maybeRequestTaskCheckFn({ modelState, loopState, toolCallResults });
      maybePromptHelpToolByLoopFn({ modelState, loopState });
      maybePromptHelpToolByFailureFn({
        modelState,
        loopState,
        hasHelpCall,
      });

      return { nextTurn: turn + Math.max(1, calls.length) };
    }

    let turn = firstTurn;
    let step;
    try {
      while ((step = await executeTurn(turn)).nextTurn !== undefined) turn = step.nextTurn;
      return step.result;
    } catch (error) {
      reportOrchestratorError({
        error,
        modelState,
        turn,
        maxTurns,
        tools,
        handleEngineErrorFn,
      });
      throw error;
    }
  }

  return runFunctionCallLoop;
}

export const runFunctionCallLoop = createTurnOrchestrator();
