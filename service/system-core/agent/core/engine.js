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
import { runFunctionCallLoop } from "./turn-orchestrator.js";

export async function runAgentTurn({ agentContext, userMessage, errorLogger = null }) {
  const { modelState, loopState } = buildAgentState({ agentContext, userMessage, errorLogger });
  return runFunctionCallLoop({ modelState, loopState, turn: 1 });
}
