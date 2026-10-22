/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnStopCommand } from "@noobot/agent-transport-protocol";
import { resolveUserStopPayload, TURN_EVENT } from "@noobot/session-protocol";
import { createConnectionState } from "../../ws/chat-websocket/connection-state.js";
import { createMessageStopHandler } from "../../ws/chat-websocket/message-stop-handler.js";
import { reserveRun } from "../../ws/chat-websocket/message-run/active-run-stage.js";
import { unregisterActiveRun } from "../../ws/chat-websocket/run-registry.js";

const OWNER = "owner-stop";

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
    identity: { sessionId: "session-stop", turnScopeId },
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
