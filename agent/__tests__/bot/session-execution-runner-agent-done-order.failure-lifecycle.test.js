/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import {
  assert,
  fs,
  os,
  path,
  createRunner,
  finalizeAgentTurn,
  AGENT_LIFECYCLE_BRANCH_STATE,
  AGENT_LIFECYCLE_EVENT,
  AGENT_LIFECYCLE_STATE,
  loadStoppedModelMessageSnapshot,
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
    runtime: {
      attachmentMetas: [],
      stoppedModelMessageSnapshotCandidate: {
        userId: "u1",
        sessionId: "session-used",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        messages: [],
        messageBlocks: { system: [], history: [], incremental: [] },
      },
    },
    agentRunner: async () => {
      throw new Error("model failed");
    },
    finalizeRunSession: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "hello" }),
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
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "hello" }),
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
