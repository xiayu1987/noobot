/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createModelContext } from "@noobot/context-protocol";
import { createTurnOrchestrator } from "../../../src/runtime/turn/orchestrator.js";
import { isMainFlowFinalNoToolsTurnEngaged } from "../../../src/runtime/main-flow-control.js";
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

test("loop-limit final turns reset their active flag before continuing interjections", async () => {
  const runtime = createLoopRuntime({ interjectionBatches: [[{ commandId: "command-1" }]] });
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

  const result = await run({
    modelState: { runtime, agentContext: createTestAgentExecutionScope(runtime) },
    loopState: {
      tools: [{}],
      traces: [],
      maxTurns: 1,
      turnMessages: [],
      loopLimitFinalizePrompted: true,
    },
    turn: 10,
  });

  assert.equal(result.output, "final");
  assert.deepEqual(engagedByTurn, [
    [10, true],
    [11, true],
  ]);
  assert.equal(isMainFlowFinalNoToolsTurnEngaged(runtime), false);
});
