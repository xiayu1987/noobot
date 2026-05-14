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
import { TASK_SUMMARY_TOOL_NAME } from "../constants/index.js";
import { handleEngineError } from "../error/index.js";
import {
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

export function createTurnOrchestrator({
  resolveLlmForTurnFn = resolveLlmForTurn,
  assertNotAbortedFn = assertNotAborted,
  invokeNoToolsTurnFn = invokeNoToolsTurn,
  invokeWithToolsTurnFn = invokeWithToolsTurn,
  processToolResultsFn = processToolResults,
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
    const isOverMaxTurns = turn > maxTurns;

    try {
      assertNotAbortedFn(abortSignal, runtime);

      if (isOverMaxTurns && loopState?.loopLimitFinalizePrompted === true) {
        const limitMsg = tEngine(runtime, "toolLoopLimitReached", { maxTurns });
        traces.push({ tool: "system", args: { turn, maxTurns }, result: limitMsg });
        emitEvent(eventListener, "tool_loop_limit_reached", { turn, maxTurns });
        return buildLoopResultFn({ output: limitMsg, traces, loopState });
      }

      if (isOverMaxTurns && loopState?.loopLimitFinalizePrompted !== true) {
        if (Array.isArray(loopState?.messages)) {
          loopState.messages.push(
            new HumanMessage({
              content: tEngine(runtime, "toolLoopLimitFinalizePrompt", { maxTurns }),
              additional_kwargs: {
                noobotInternalMessageType: "tool_loop_limit_finalize_prompt",
              },
            }),
          );
        }
        loopState.loopLimitFinalizePrompted = true;
        emitEvent(eventListener, "tool_loop_limit_finalize_prompted", {
          turn,
          maxTurns,
        });
      }

      resolveLlmForTurnFn(modelState);

      if (!Array.isArray(tools) || tools.length === 0) {
        const noToolsResult = await invokeNoToolsTurnFn({ modelState, loopState, turn });
        return buildLoopResultFn({
          output: noToolsResult.output,
          traces,
          loopState,
          turnTaskStore: noToolsResult.turnTaskStore,
          turnMessageStore: noToolsResult.turnMessageStore,
          modelMessages: noToolsResult.modelMessages,
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
        const forceTool = resolveForceToolCall(runtime?.systemRuntime?.config || {});
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
          });
        }
        if (Array.isArray(loopState?.messages)) {
          removeToolChoiceRequiredRetryPrompts(loopState.messages);
          loopState.messages.push(
            new HumanMessage({
              content: tEngine(runtime, "toolChoiceRequiredRetryPrompt"),
              additional_kwargs: {
                noobotInternalMessageType: "tool_choice_required_retry_prompt",
              },
            }),
          );
        }
        loopState.toolChoiceRetryPrompted = true;
        emitEvent(eventListener, "tool_choice_required_retry_prompted", { turn });
        return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
      }
      loopState.toolChoiceRetryPrompted = false;

      if (isOverMaxTurns) {
        const limitMsg = tEngine(runtime, "toolLoopLimitReached", { maxTurns });
        traces.push({
          tool: "system",
          args: { turn, maxTurns, toolCallCount: calls.length },
          result: limitMsg,
        });
        emitEvent(eventListener, "tool_loop_limit_reached", {
          turn,
          maxTurns,
          toolCallCount: calls.length,
          afterFinalizePrompt: true,
        });
        return buildLoopResultFn({
          output: limitMsg,
          traces,
          loopState,
          turnTaskStore,
          turnMessageStore,
          modelMessages: loopState.messages,
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
          parentSessionId: String(systemRuntime?.parentSessionId || "").trim(),
          dialogProcessId: String(systemRuntime?.dialogProcessId || "").trim(),
        },
      });
      throw error;
    }
  }

  return runFunctionCallLoop;
}

export const runFunctionCallLoop = createTurnOrchestrator();
