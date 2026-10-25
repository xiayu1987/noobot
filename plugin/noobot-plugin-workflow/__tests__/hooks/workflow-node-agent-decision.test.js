/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOOK_POINT, createHookManager } from "@noobot/hook-protocol";
import { WORKFLOW_ACTION_TYPE } from "workflow";

import {
  NODE_AGENT_DEFAULT_ACTION,
  resolveNodeAgentDecision,
} from "../../src/core/hooks/node-agent.js";

const POINT = HOOK_POINT.WORKFLOW.NODE_AGENT_EXECUTE;

async function decide(handlers) {
  const manager = createHookManager();
  for (const [id, handler] of Object.entries(handlers)) manager.on(POINT, handler, { id });
  const emitted = await manager.emit(POINT, {});
  return resolveNodeAgentDecision(emitted.outcomes);
}

test("node agent decision: no subscriber or all abstain advances the declared default", async () => {
  assert.equal(await decide({}), NODE_AGENT_DEFAULT_ACTION);
  assert.equal(await decide({ observer: () => undefined }), NODE_AGENT_DEFAULT_ACTION);
  assert.equal(NODE_AGENT_DEFAULT_ACTION.type, WORKFLOW_ACTION_TYPE.SUBMIT);
});

test("node agent decision: single decider action is taken with only its type", async () => {
  const action = await decide({
    observer: () => undefined,
    reviewer: () => ({ action: { type: WORKFLOW_ACTION_TYPE.BACK, extra: true } }),
  });
  assert.deepEqual(action, { type: WORKFLOW_ACTION_TYPE.BACK });
});

test("node agent decision: malformed decision is rejected with handler id", async () => {
  for (const value of [null, {}, { action: null }, { action: { type: "Submit" } }]) {
    await assert.rejects(
      decide({ reviewer: () => value }),
      (error) => error.code === "WORKFLOW_NODE_ACTION_INVALID" && error.handlerId === "reviewer",
    );
  }
});

test("node agent decision: multiple deciders conflict instead of first-wins", async () => {
  await assert.rejects(
    decide({
      first: () => ({ action: { type: WORKFLOW_ACTION_TYPE.SUBMIT } }),
      second: () => ({ action: { type: WORKFLOW_ACTION_TYPE.STOP } }),
    }),
    (error) =>
      error.code === "WORKFLOW_NODE_ACTION_CONFLICT" &&
      error.handlerIds.join(",") === "first,second",
  );
});

test("node agent decision: subscriber failure fails the flow instead of abstaining", async () => {
  await assert.rejects(
    decide({
      broken: () => {
        throw new Error("decider crashed");
      },
    }),
    (error) => error.code === "HOOK_EXECUTION_FAILED" && /decider crashed/.test(error.message),
  );
});
