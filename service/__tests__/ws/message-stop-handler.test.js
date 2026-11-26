/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnStopCommand, ROOT_PARENT_SESSION_ID } from "@noobot/agent-transport-protocol";
import {
  decideTurnTransition,
  resolveUserStopPayload,
  TURN_ACTION,
  TURN_EVENT,
  TURN_STATE,
} from "@noobot/session-protocol";
import { createConnectionState } from "../../ws/chat-websocket/connection-state.js";
import { createMessageStopHandler } from "../../ws/chat-websocket/message-stop-handler.js";
import { reserveRun } from "../../ws/chat-websocket/message-run/active-run-stage.js";
import { finalizeRunResult } from "../../ws/chat-websocket/message-run/terminal-stage.js";
import { unregisterActiveRun } from "../../ws/chat-websocket/run-registry.js";
import { useProvisionedRuntimeEventsWorkspace } from "../runtime-events-root.test-helpers.js";

const OWNER = "owner-stop";

useProvisionedRuntimeEventsWorkspace([OWNER], { [OWNER]: ["session-stop"] });

function createStopHarness() {
  const state = createConnectionState({ locale: "zh-CN" });
  const lifecycle = [];
  const handleStop = createMessageStopHandler({
    state,
    canonicalRunOwnerId: OWNER,
    sendEvent: () => {},
    translateText: (key) => key,
    rejectTurnInteractions: () => {},
    commitTurnLifecycle: async (input) => {
      lifecycle.push(input);
      return { applied: true, turn: { dialogProcessId: `dialog-${input.turnScopeId}` } };
    },
  });
  return { state, lifecycle, handleStop };
}

function stopCommand(turnScopeId) {
  return createTurnStopCommand({
    identity: {
      sessionId: "session-stop",
      parentSessionId: ROOT_PARENT_SESSION_ID,
      turnScopeId,
    },
    concurrency: { expectedTurnRevision: 1 },
    stop: {},
  });
}

function reserve(state, turnScopeId) {
  return reserveRun(
    { state, canonicalRunOwnerId: OWNER },
    { sessionId: "session-stop", turnScopeId },
    null,
  );
}

test("stop arriving after reservation and before activation aborts the reserved run", async () => {
  const { state, lifecycle, handleStop } = createStopHarness();
  const handle = reserve(state, "turn-reserved");
  try {
    await handleStop(stopCommand("turn-reserved"));
    assert.equal(handle.abortController.signal.aborted, true);
    const stopPayload = resolveUserStopPayload({ abortSignal: handle.abortController.signal });
    assert.equal(stopPayload.turnScopeId, "turn-reserved");
    assert.equal(
      lifecycle.some((item) => item.eventType === TURN_EVENT.STOP_COMPLETED),
      false,
    );
  } finally {
    unregisterActiveRun(handle);
  }
});

test("stopping another turn does not touch the current connection run", async () => {
  const { state, lifecycle, handleStop } = createStopHarness();
  const handle = reserve(state, "turn-current");
  const runMeta = { turnScopeId: "turn-current" };
  state.currentRunMeta = runMeta;
  try {
    await handleStop(stopCommand("turn-other"));
    assert.equal(handle.abortController.signal.aborted, false);
    assert.equal(state.currentAbortController, handle.abortController);
    assert.equal(state.currentRunMeta, runMeta);
    const completed = lifecycle.find((item) => item.eventType === TURN_EVENT.STOP_COMPLETED);
    assert.equal(completed?.turnScopeId, "turn-other");
  } finally {
    unregisterActiveRun(handle);
  }
});

async function assertSettlementOrder(t, firstEvent) {
  const state = createConnectionState({ locale: "zh-CN" });
  const turnScopeId = "turn-concurrent-stop";
  const handle = reserve(state, turnScopeId);
  t.after(() => unregisterActiveRun(handle));
  const persisted = Promise.withResolvers();
  const delivered = Promise.withResolvers();
  let turn = { state: TURN_STATE.PROCESSING, executionState: "sending", action: TURN_ACTION.SEND };
  const commits = [];
  async function commitTurnLifecycle({ eventType, phase }) {
    commits.push(eventType);
    const decision = decideTurnTransition({ current: turn, eventType, phase });
    if (!decision.allowed) return { applied: false, reason: decision.reason };
    turn = { ...turn, state: decision.nextState, dialogProcessId: "dialog-concurrent-stop" };
    if (eventType === TURN_EVENT.STOP_ACCEPTED) turn.action = TURN_ACTION.STOP;
    if (eventType === firstEvent) {
      persisted.resolve();
      await delivered.promise;
    }
    return { applied: true, turn };
  }
  const receipts = [];
  const handleStop = createMessageStopHandler({
    state: createConnectionState({ locale: "zh-CN" }),
    canonicalRunOwnerId: OWNER,
    sendEvent: (...args) => receipts.push(args),
    translateText: (key) => key,
    rejectTurnInteractions: () => {},
    commitTurnLifecycle,
  });
  const finalizeUserStopped = t.mock.fn();
  const finalizeCompleted = t.mock.fn();
  const run = { sessionId: "session-stop", turnScopeId };
  const context = {
    state,
    lifecycle: {},
    commitTurnLifecycle,
    finalizeUserStopped,
    finalizeCompleted,
    buildRunStateSnapshot: () => ({ abortSignal: state.currentAbortSignal }),
  };
  const settle = () => finalizeRunResult(context, run, { commandId: "send-command" });
  const stop = () => handleStop(stopCommand(turnScopeId));
  const stopWins = firstEvent === TURN_EVENT.STOP_ACCEPTED;
  const first = stopWins ? stop() : settle();
  await persisted.promise;
  const second = stopWins ? settle() : stop();
  const done = Promise.allSettled([first, second]);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(commits, [firstEvent]);
  } finally {
    delivered.resolve();
    for (const result of await done) {
      if (result.status === "rejected") throw result.reason;
    }
  }
  return { commits, finalizeCompleted, finalizeUserStopped, handle, receipts };
}

test("natural run return waits for an accepted stop to reach the run across sockets", async (t) => {
  const result = await assertSettlementOrder(t, TURN_EVENT.STOP_ACCEPTED);
  assert.deepEqual(result.commits, [TURN_EVENT.STOP_ACCEPTED]);
  assert.equal(result.finalizeCompleted.mock.callCount(), 0);
  assert.equal(result.finalizeUserStopped.mock.callCount(), 1);
  assert.equal(result.handle.abortController.signal.aborted, true);
});

test("normal completion claimed first rejects a later stop across sockets", async (t) => {
  const result = await assertSettlementOrder(t, TURN_EVENT.PROCESSING_COMPLETED);
  assert.deepEqual(result.commits, [TURN_EVENT.PROCESSING_COMPLETED, TURN_EVENT.STOP_ACCEPTED]);
  assert.equal(result.finalizeCompleted.mock.callCount(), 1);
  assert.equal(result.finalizeUserStopped.mock.callCount(), 0);
  assert.equal(result.handle.abortController.signal.aborted, false);
  assert.equal(result.receipts.length, 1);
});
