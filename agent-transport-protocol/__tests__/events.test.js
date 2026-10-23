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
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandReceipt,
  createAgentCommandRejection,
  validateAgentCommandRejection,
  createAgentTransportError,
  validateAgentTransportError,
  AGENT_TRANSPORT_ERROR_CODE,
  createAgentChannelState,
  createAgentChannelFrame,
  createAgentDirectFrame,
  parseAgentTransportFrame,
  validateAgentChannelState,
  usesExactAgentTransportPayload,
} from "../src/events.js";

test("transport protocol declares events whose payload cannot be enriched", () => {
  assert.equal(usesExactAgentTransportPayload(AGENT_TRANSPORT_EVENT.ERROR), true);
  assert.equal(usesExactAgentTransportPayload(AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT), true);
  assert.equal(usesExactAgentTransportPayload(AGENT_TRANSPORT_EVENT.CHANNEL_STATE), true);
  assert.equal(usesExactAgentTransportPayload("message_event"), false);
});

test("channel frame keeps routing identity separate from authoritative data", () => {
  const data = Object.freeze({ eventType: "attachment.parsed" });
  const frame = createAgentChannelFrame({
    event: "attachment_lifecycle",
    data,
    channelSessionId: "session-1",
  });

  assert.equal(frame.data, data);
  assert.equal(frame.channelSessionId, "session-1");
  assert.deepEqual(parseAgentTransportFrame(JSON.parse(JSON.stringify(frame))), frame);
});

test("channel frame requires a canonical channel session", () => {
  for (const channelSessionId of [undefined, "", " session-1"]) {
    assert.throws(
      () => createAgentChannelFrame({ event: "attachment_lifecycle", data: {}, channelSessionId }),
      /missing_channel_session_id/,
    );
  }
});

test("direct frame only carries transport-owned events", () => {
  const frame = createAgentDirectFrame({ event: AGENT_TRANSPORT_EVENT.READY, data: {} });
  assert.deepEqual(Object.keys(frame), ["event", "data"]);
  assert.throws(
    () => createAgentDirectFrame({ event: "attachment_lifecycle", data: {} }),
    /channel_event_sent_direct:attachment_lifecycle/,
  );
  assert.throws(
    () => parseAgentTransportFrame({ event: "attachment_lifecycle", data: {} }),
    /channel_event_sent_direct/,
  );
});

test("channel frame rejects transport-owned direct events", () => {
  assert.throws(
    () =>
      createAgentChannelFrame({
        event: AGENT_TRANSPORT_EVENT.READY,
        data: {},
        channelSessionId: "session-1",
      }),
    /direct_event_sent_on_channel:transport_ready/,
  );
  assert.throws(
    () =>
      parseAgentTransportFrame({
        event: AGENT_TRANSPORT_EVENT.RECONNECT_COMPLETE,
        data: {},
        channelSessionId: "session-1",
      }),
    /direct_event_sent_on_channel/,
  );
});

test("command receipts travel only on channel frames and rejections only direct", () => {
  const receipt = createAgentCommandReceipt({
    command: { commandId: "command-1", commandType: "send", identity: { sessionId: "session-1" } },
    outcome: AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED,
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
  assert.throws(
    () => createAgentDirectFrame({ event: AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, data: receipt }),
    /channel_event_sent_direct:transport_command_receipt/,
  );
  const rejection = createAgentCommandRejection({
    command: {
      commandId: "command-1",
      commandType: "send",
      identity: { sessionId: "session-1", parentSessionId: "", turnScopeId: "" },
    },
    error: { code: "PERMISSION_DENIED", message: "permission denied" },
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(rejection.identity, { sessionId: "session-1" });
  assert.equal(Object.hasOwn(rejection, "outcome"), false);
  assert.throws(
    () =>
      createAgentChannelFrame({
        event: AGENT_TRANSPORT_EVENT.COMMAND_REJECTED,
        data: rejection,
        channelSessionId: "session-1",
      }),
    /direct_event_sent_on_channel:transport_command_rejected/,
  );
  assert.equal(
    createAgentDirectFrame({ event: AGENT_TRANSPORT_EVENT.COMMAND_REJECTED, data: rejection }).data,
    rejection,
  );
});

test("command rejection requires canonical command, session and error facts", () => {
  const command = { commandId: "command-1", commandType: "send", identity: { sessionId: "s" } };
  assert.throws(
    () =>
      createAgentCommandRejection({
        command,
        error: { code: "", message: "m" },
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    /missing_rejection_code/,
  );
  assert.deepEqual(
    validateAgentCommandRejection({
      ...createAgentCommandRejection({
        command,
        error: { code: "c", message: "m" },
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
      outcome: "failed",
    }).errors,
    ["unknown_rejection_field:outcome"],
  );
  assert.deepEqual(
    validateAgentCommandRejection({
      ...createAgentCommandRejection({
        command,
        error: { code: "c", message: "m" },
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
      identity: { sessionId: " s" },
    }).errors,
    ["invalid_rejection_identity_field:sessionId", "missing_session_id"],
  );
});

test("transport error carries an enumerated code and projects canonical identity", () => {
  const occurredAt = "2026-01-01T00:00:00.000Z";
  const errorEvent = createAgentTransportError({
    code: AGENT_TRANSPORT_ERROR_CODE.UPSTREAM_UNAVAILABLE,
    message: "upstream unavailable",
    identity: { sessionId: "s", turnScopeId: "", parentSessionId: "p" },
    occurredAt,
  });
  assert.deepEqual(errorEvent.identity, { sessionId: "s" });
  assert.throws(
    () =>
      createAgentTransportError({
        code: "agentProxy upstream is unavailable",
        message: "m",
        identity: {},
        occurredAt,
      }),
    /invalid_transport_error_code/,
  );
  assert.deepEqual(validateAgentTransportError({ ...errorEvent, commandId: "c" }).errors, [
    "unknown_transport_error_field:commandId",
  ]);
  assert.deepEqual(validateAgentTransportError({ ...errorEvent, message: " m" }).errors, [
    "missing_transport_error_message",
  ]);
  assert.deepEqual(
    validateAgentTransportError({ ...errorEvent, identity: { sessionId: "" } }).errors,
    ["invalid_transport_error_identity_field:sessionId"],
  );
});

test("command receipt outcome is matched exactly without case folding", () => {
  assert.throws(
    () =>
      createAgentCommandReceipt({
        command: {
          commandId: "command-1",
          commandType: "send",
          identity: { sessionId: "session-1" },
        },
        outcome: "Completed",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    /invalid_outcome/,
  );
});

test("transport frame rejects missing event, non-object data and unknown fields", () => {
  assert.throws(() => createAgentDirectFrame({ event: "", data: {} }), /missing_transport_event/);
  assert.throws(
    () => createAgentDirectFrame({ event: AGENT_TRANSPORT_EVENT.READY, data: [] }),
    /invalid_transport_event_data/,
  );
  assert.throws(
    () => parseAgentTransportFrame({ event: AGENT_TRANSPORT_EVENT.READY, data: {}, seq: 1 }),
    /unknown_transport_frame_field:seq/,
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

test("frames validate transport-owned payloads at the boundary", () => {
  const validError = createAgentTransportError({
    code: AGENT_TRANSPORT_ERROR_CODE.RECONNECT_FAILED,
    message: "reconnect failed",
    identity: { sessionId: "s-1" },
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(
    parseAgentTransportFrame({ event: AGENT_TRANSPORT_EVENT.ERROR, data: validError }).data,
    validError,
  );
  assert.throws(
    () =>
      parseAgentTransportFrame({
        event: AGENT_TRANSPORT_EVENT.ERROR,
        data: { ...validError, code: "replayed_failure" },
      }),
    /invalid_transport_error_code/,
  );
  assert.throws(
    () =>
      parseAgentTransportFrame({
        event: AGENT_TRANSPORT_EVENT.CHANNEL_STATE,
        data: { protocolVersion: 1, sessionId: "s-1" },
        channelSessionId: "s-1",
      }),
    /invalid_channel_state/,
  );
  assert.throws(
    () =>
      createAgentChannelFrame({
        event: AGENT_TRANSPORT_EVENT.CHANNEL_ERROR,
        data: { ...validError, message: "" },
        channelSessionId: "s-1",
      }),
    /missing_transport_error_message/,
  );
});
