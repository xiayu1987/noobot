/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { createModelContext } from "@noobot/context-protocol";
import { createSessionDeletedError } from "@noobot/session-protocol";
import {
  assert,
  createRunner,
  AGENT_LIFECYCLE_BRANCH_STATE,
  AGENT_LIFECYCLE_STATE,
  collectLifecycleStates,
} from "./session-execution-runner-agent-done-order.fixtures.js";

test("runSession does not persist stopped snapshot for non-abort errors", async () => {
  const callOrder = [];
  const events = [];
  const eventListener = {
    onEvent(event) {
      events.push(event);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    runtime: createTestRuntimeContext({
      activeMessageContext: createModelContext({
        messageBlocks: { system: [], history: [], incremental: [] },
      }),
      stoppedModelMessageSnapshotCandidate: {
        userId: "u1",
        sessionId: "session-used",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      },
    }),
    agentRunner: async () => {
      throw new Error("model failed");
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () =>
      runner.runAcceptedSession({
        turnScopeId: "turn-default",
        userId: "u1",
        sessionId: "s1",
        message: "hello",
      }),
    /model failed/,
  );

  assert.equal(
    events.some((item) => item.event === "stopped_model_message_snapshot_saved"),
    false,
  );
  assert.equal(
    events.some((item) => item.event === "stopped_model_message_snapshot_save_skipped"),
    false,
  );
});

test("runSession emits failed branch lifecycle state for non-abort errors", async () => {
  const callOrder = [];
  const events = [];
  const eventListener = {
    onEvent(event) {
      events.push(event);
    },
  };
  const runner = createRunner({
    callOrder,
    eventListener,
    agentRunner: async () => {
      throw new Error("model failed");
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () =>
      runner.runAcceptedSession({
        turnScopeId: "turn-default",
        userId: "u1",
        sessionId: "s1",
        message: "hello",
      }),
    /model failed/,
  );

  assert.deepEqual(collectLifecycleStates(events), [
    AGENT_LIFECYCLE_STATE.INITIALIZING,
    AGENT_LIFECYCLE_STATE.RUNNING,
    AGENT_LIFECYCLE_BRANCH_STATE.FAILED,
  ]);
  const failedEvent = events.find(
    (item) => item.data?.state === AGENT_LIFECYCLE_BRANCH_STATE.FAILED,
  );
  assert.equal(failedEvent.data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.FAILED);
  assert.equal(failedEvent.data.error, "model failed");
});

test("runSession fails the lifecycle when the session is deleted during finalization", async () => {
  const events = [];
  const deleted = createSessionDeletedError({ userId: "u1", sessionId: "s1" });
  const runner = createRunner({
    callOrder: [],
    eventListener: {
      onEvent(event) {
        events.push(event);
      },
    },
    finalizeRunSession: async () => {
      throw deleted;
    },
  });

  await assert.rejects(
    () =>
      runner.runAcceptedSession({
        turnScopeId: "turn-default",
        userId: "u1",
        sessionId: "s1",
        message: "hello",
      }),
    (error) => error.code === deleted.code && error.statusCode === 410,
  );

  const states = collectLifecycleStates(events);
  assert.equal(states.at(-1), AGENT_LIFECYCLE_BRANCH_STATE.FAILED);
  assert.equal(states.includes(AGENT_LIFECYCLE_STATE.COMPLETED), false);
});
