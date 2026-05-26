/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Agent Engine — thin coordinator.
 *
 * Responsibilities:
 *   1. Build agent state (modelState + loopState) via state-builder.
 *   2. Delegate the function-call loop to turn-orchestrator.
 *
 * All heavy logic (LLM invocation, retry, tool execution, loop control,
 * state commitment) has been extracted into semantic modules:
 *   - llm-invoker.js      : LLM call + transient retry + error classification
 *   - loop-control.js     : phase-summary / help-prompt threshold checks
 *   - turn-orchestrator.js: no-tools / with-tools invocation, tool result
 *                           processing, recursive loop
 *   - state-builder.js    : config resolution, counter normalization, state assembly
 */

import { buildAgentState } from "./state-builder.js";
import { runFunctionCallLoop } from "./turn/orchestrator.js";
import { runAgentRuntimeHook, AGENT_HOOK_POINTS } from "../../hook/index.js";
import { isAbortError } from "./utils/error-utils.js";
import { buildHookContext } from "./hook/hook-context-builder.js";

export async function runAgentTurn({ agentContext, userMessage, errorLogger = null }) {
  const runtime = agentContext?.execution?.controllers?.runtime || {};
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.BEFORE_TURN,
    context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_TURN, runtime, {
      phase: "agent_turn",
      status: "start",
      startedAt,
      agentContext,
      userMessage,
    }),
  });
  const { modelState, loopState } = buildAgentState({ agentContext, userMessage, errorLogger });
  try {
    const result = await runFunctionCallLoop({ modelState, loopState, turn: 1 });
    const beforeFinalAtMs = Date.now();
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.BEFORE_FINAL_OUTPUT,
      context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_FINAL_OUTPUT, runtime, {
        phase: "agent_turn",
        status: "success",
        startedAt,
        endedAt: new Date(beforeFinalAtMs).toISOString(),
        durationMs: beforeFinalAtMs - startedAtMs,
        agentContext,
        userMessage,
        result,
      }),
    });
    const endedAtMs = Date.now();
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.AFTER_TURN,
      context: buildHookContext(AGENT_HOOK_POINTS.AFTER_TURN, runtime, {
        phase: "agent_turn",
        status: "success",
        startedAt,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: endedAtMs - startedAtMs,
        agentContext,
        userMessage,
        result,
      }),
    });
    return result;
  } catch (error) {
    const failedAtMs = Date.now();
    if (isAbortError(error) || isAbortError(error?.cause)) {
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.ON_ABORT,
        context: buildHookContext(AGENT_HOOK_POINTS.ON_ABORT, runtime, {
          phase: "agent_turn",
          status: "abort",
          startedAt,
          endedAt: new Date(failedAtMs).toISOString(),
          durationMs: failedAtMs - startedAtMs,
          agentContext,
          userMessage,
          error,
        }),
      });
    }
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.ON_ERROR,
      context: buildHookContext(AGENT_HOOK_POINTS.ON_ERROR, runtime, {
        phase: "agent_turn",
        status: "error",
        startedAt,
        endedAt: new Date(failedAtMs).toISOString(),
        durationMs: failedAtMs - startedAtMs,
        agentContext,
        userMessage,
        error,
      }),
    });
    throw error;
  }
}
