/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOT_DISPATCH_ROOT_OWNER,
  createBotDispatchHandled,
  createBotDispatchPass,
  resolveBotDispatchOutcome,
} from "@noobot/agent-transport-protocol/bot-dispatch";
import {
  AGENT_TURN_RESULT_ERROR_CODE,
  createAgentTurnResult,
} from "@noobot/agent-transport-protocol/agent-turn-result";

function turnResult(fields = {}) {
  return createAgentTurnResult({
    output: "done",
    traces: [],
    turnMessages: [],
    turnTasks: [],
    modelMessages: [],
    modelLoopRound: 0,
    ...fields,
  });
}

test("dispatch protocol resolves one explicit owner", () => {
  const workflow = createBotDispatchHandled({ owner: "workflow", result: turnResult() });
  const result = resolveBotDispatchOutcome({
    outcomes: [
      { status: "ok", value: createBotDispatchPass({ owner: "audit" }) },
      { status: "ok", value: workflow },
    ],
  });
  assert.equal(result, workflow);
});

test("dispatch protocol rejects competing execution owners", () => {
  assert.throws(
    () =>
      resolveBotDispatchOutcome({
        outcomes: [
          {
            status: "ok",
            value: createBotDispatchHandled({ owner: "workflow", result: turnResult() }),
          },
          {
            status: "ok",
            value: createBotDispatchHandled({ owner: "other", result: turnResult() }),
          },
        ],
      }),
    (error) => error?.code === "BOT_DISPATCH_OWNERSHIP_CONFLICT",
  );
});

test("failed dispatch outcome cannot carry a successful result payload", () => {
  const outcome = createBotDispatchHandled({
    owner: "workflow",
    failure: { code: "WORKFLOW_NODE_FAILED", message: "node failed" },
  });
  assert.equal(outcome.failure.code, "WORKFLOW_NODE_FAILED");
  assert.equal(Object.hasOwn(outcome, "result"), false);
  assert.throws(
    () =>
      createBotDispatchHandled({
        owner: "workflow",
        result: turnResult(),
        failure: { code: "WORKFLOW_NODE_FAILED", message: "node failed" },
      }),
    /exactly one of result or failure/,
  );
  assert.throws(
    () => createBotDispatchHandled({ owner: "workflow", failure: { code: "X" } }),
    /requires code and message/,
  );
  assert.throws(() => createBotDispatchHandled({ owner: "workflow" }), /exactly one/);
});

test("agent turn result protocol accepts only the registered shape", () => {
  const result = turnResult({ modelMessageId: "mm_1" });
  assert.equal(result.modelMessageId, "mm_1");
  const invalid = [
    null,
    { output: "x" },
    { ...turnResult(), output: 1 },
    { ...turnResult(), turnTasks: null },
    { ...turnResult(), modelLoopRound: -1 },
    { ...turnResult(), modelLoopRound: 1.5 },
    { ...turnResult(), modelMessageId: 1 },
    { ...turnResult(), modelMessages: undefined },
    { ...turnResult(), workflow: {} },
  ];
  for (const value of invalid) {
    assert.throws(
      () => createAgentTurnResult(value),
      (error) => error?.code === AGENT_TURN_RESULT_ERROR_CODE,
    );
    assert.throws(() => createBotDispatchHandled({ owner: "workflow", result: value }));
  }
});

test("dispatch protocol routes unclaimed turns to the explicit root owner", () => {
  const result = resolveBotDispatchOutcome({ outcomes: [] });
  assert.equal(result.disposition, "pass");
  assert.equal(result.owner, BOT_DISPATCH_ROOT_OWNER);
  assert.throws(() => createBotDispatchPass({}), /pass bot dispatch outcome requires owner/);
});
