/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_CHANNEL_STATE,
  AGENT_CHANNEL_STATE_SCOPE,
  AGENT_TRANSPORT_EVENT,
  createAgentChannelState,
  createAgentTransportEvent,
  validateAgentChannelState,
  getAgentTransportEventSessionId,
  usesExactAgentTransportPayload,
} from "../src/events.js";

test("transport protocol declares events whose payload cannot be enriched", () => {
  assert.equal(usesExactAgentTransportPayload(AGENT_TRANSPORT_EVENT.ERROR), true);
  assert.equal(usesExactAgentTransportPayload(AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT), true);
  assert.equal(usesExactAgentTransportPayload(AGENT_TRANSPORT_EVENT.CHANNEL_STATE), true);
  assert.equal(usesExactAgentTransportPayload("message_event"), false);
});

test("transport event keeps routing identity separate from authoritative data", () => {
  const data = Object.freeze({ eventType: "attachment.parsed" });
  const envelope = createAgentTransportEvent({
    event: "attachment_lifecycle",
    data,
    channelSessionId: "session-1",
  });

  assert.equal(envelope.data, data);
  assert.deepEqual(envelope.data, { eventType: "attachment.parsed" });
  assert.equal(getAgentTransportEventSessionId(envelope), "session-1");
});

test("transport event rejects missing event identity and non-object data", () => {
  assert.throws(
    () => createAgentTransportEvent({ event: "", data: {} }),
    /missing_transport_event/,
  );
  assert.throws(
    () => createAgentTransportEvent({ event: "delta", data: [] }),
    /invalid_transport_event_data/,
  );
});

const channelStateBase = Object.freeze({
  sessionId: "session-1",
  sourceEvent: "init",
  seq: 0,
  createdAtMs: 1000,
  updatedAtMs: 1000,
});

test("session channel state carries no turn identity", () => {
  const channelState = createAgentChannelState({
    ...channelStateBase,
    scope: AGENT_CHANNEL_STATE_SCOPE.SESSION,
    state: AGENT_CHANNEL_STATE.NO_CONVERSATION,
  });
  assert.equal(channelState.scope, "session");
  assert.equal("turnScopeId" in channelState, false);
  assert.deepEqual(validateAgentChannelState({ ...channelState, turnScopeId: "turn-1" }).errors, [
    "session_channel_state_has_turnScopeId",
  ]);
});

test("turn channel state requires turnScopeId as its owner key", () => {
  const channelState = createAgentChannelState({
    ...channelStateBase,
    scope: AGENT_CHANNEL_STATE_SCOPE.TURN,
    turnScopeId: "turn-1",
    dialogProcessId: "dp-1",
    state: AGENT_CHANNEL_STATE.INTERACTION_PENDING,
    requestId: "req-1",
  });
  assert.equal(channelState.turnScopeId, "turn-1");
  assert.throws(
    () =>
      createAgentChannelState({
        ...channelStateBase,
        scope: AGENT_CHANNEL_STATE_SCOPE.TURN,
        state: AGENT_CHANNEL_STATE.SENDING,
      }),
    /missing_channel_state_turn_scope_id/,
  );
});

test("channel state rejects unknown fields, states and scopes", () => {
  const result = validateAgentChannelState({
    protocolVersion: 1,
    scope: "conversation",
    sessionId: "session-1",
    state: "running",
    sourceEvent: "init",
    seq: 0,
    createdAtMs: 1000,
    updatedAtMs: 1000,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(result.errors, [
    "unknown_channel_state_field:createdAt",
    "invalid_channel_state",
    "invalid_channel_state_scope",
  ]);
});
