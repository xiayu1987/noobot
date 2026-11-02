/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createModelContext } from "@noobot/context-protocol";
import { MAIN_FLOW_CONTROL_REASON } from "@noobot/context-protocol/policy/main-flow-control";
import { createTurnOrchestrator } from "../../../src/runtime/turn/orchestrator.js";
import {
  isMainFlowFinalNoToolsTurnEngaged,
  requestMainFlowFinalNoToolsTurn,
} from "../../../src/runtime/main-flow-control.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";

function createLoopRuntime({ interjectionBatches = [] } = {}) {
  const pending = [...interjectionBatches];
  const runtime = createTestRuntimeContext({
    identity: { sessionId: "session-1", dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
    systemRuntime: {},
    sealUserInterjectionQueueIfEmpty: () => pending.length === 0,
    consumeUserInterjections: async () => pending.shift(),
  });
  runtime.activeMessageContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
    activeTurnIdentity: { dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
  });
  return runtime;
}

const passiveLoopControls = {
  resolveLlmForTurnFn: () => {},
  assertNotAbortedFn: () => {},
  buildLoopResultFn: ({ output }) => ({ output }),
  maybeRequestPhaseSummaryFn: () => {},
  maybeRequestTaskCheckFn: () => {},
  maybePromptHelpToolByLoopFn: () => {},
  maybePromptHelpToolByFailureFn: () => {},
};

function runLoop(run, runtime) {
  return run({
    modelState: { runtime, agentContext: createTestAgentExecutionScope(runtime) },
    loopState: { tools: [{}], traces: [], maxTurns: 10000, turnMessages: [] },
  });
}

test("an error raised deep in the loop is reported exactly once with its own turn", async () => {
  const runtime = createLoopRuntime();
  const failingTurn = 200;
  const failure = new Error("run timeout");
  const reported = [];
  const run = createTurnOrchestrator({
    ...passiveLoopControls,
    invokeWithToolsTurnFn: async ({ turn }) => {
      if (turn === failingTurn) throw failure;
      return {
        aiContentText: "",
        calls: [{ id: `call-${turn}`, name: "noop", args: {} }],
        turnMessageStore: runtime.currentTurnMessages,
        stateCommitter: {},
      };
    },
    processToolResultsFn: async () => ({ toolCallResults: [] }),
    handleEngineErrorFn: (input) => reported.push(input),
  });

  await assert.rejects(runLoop(run, runtime), failure);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].error, failure);
  assert.equal(reported[0].event, "turn_orchestrator_error");
  assert.equal(reported[0].metadata.turn, failingTurn);
});

test("turns continued by interjections after a final no-tools turn are not final turns", async () => {
  const runtime = createLoopRuntime({ interjectionBatches: [[{ commandId: "command-1" }]] });
  requestMainFlowFinalNoToolsTurn(runtime, {
    reason: MAIN_FLOW_CONTROL_REASON.TASK_SUMMARY_COMPLETE,
    source: "test",
  });
  const engagedByTurn = [];
  const run = createTurnOrchestrator({
    ...passiveLoopControls,
    invokeNoToolsTurnFn: async ({ turn }) => {
      engagedByTurn.push([turn, isMainFlowFinalNoToolsTurnEngaged(runtime)]);
      return { output: "final", turnMessageStore: runtime.currentTurnMessages };
    },
    invokeWithToolsTurnFn: async ({ turn }) => {
      engagedByTurn.push([turn, isMainFlowFinalNoToolsTurnEngaged(runtime)]);
      return {
        aiContentText: "after interjection",
        calls: [],
        turnMessageStore: runtime.currentTurnMessages,
      };
    },
  });

  const result = await runLoop(run, runtime);

  assert.equal(result.output, "after interjection");
  assert.deepEqual(engagedByTurn, [
    [1, true],
    [2, false],
  ]);
  assert.equal(isMainFlowFinalNoToolsTurnEngaged(runtime), false);
});
