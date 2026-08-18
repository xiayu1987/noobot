/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import { createRunEventListener } from "../ws/chat-websocket/run-event-listener.js";

function createListener(overrides = {}) {
  const frames = [];
  const listener = createRunEventListener({
    sendEvent: (event, data) => {
      frames.push({ event, data });
      return true;
    },
    sessionId: "root-session",
    registerActiveRun: () => {},
    getCurrentRunMeta: () => ({ turnScopeId: "turn-1", dialogProcessId: "dialog-1" }),
    getCurrentRunHandle: () => null,
    getCurrentTurnScopeId: () => "turn-1",
    ...overrides,
  });
  return { listener, frames };
}

function messageEnvelope() {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: "event-1",
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "root-session",
      turnScopeId: "turn-1",
      messageId: "message-1",
    },
    causality: { commandId: "command-1" },
    ordering: {
      domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: "message-1",
      sequence: 1,
      aggregateVersion: 2,
    },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: {
      eventType: MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT,
      presentationMessageId: "presentation-1",
      text: "complete body",
    },
  });
}

test("run-event-listener forwards the committed Turn receipt only through its explicit contract", () => {
  const { listener, frames } = createListener();
  listener.onEvent({
    event: "turn_committed",
    data: {
      sessionId: "root-session",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      aggregateVersion: 7,
      userMessage: {
        messageUid: "sm_1",
        messageId: "frontend-user-1",
        role: "user",
        sessionId: "root-session",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        attachments: [],
      },
    },
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "turn_committed");
  assert.equal(frames[0].data.aggregateVersion, 7);
});

test("run-event-listener dispatches a canonical authority commit without rebuilding its envelope", () => {
  const dispatched = [];
  const { listener, frames } = createListener({
    onAuthorityEventCommitted: (envelope, options) => {
      dispatched.push({ envelope, options });
      return true;
    },
  });
  const envelope = messageEnvelope();
  const result = listener.onEvent({
    event: "authority_event_committed",
    data: { envelope, persistenceScope: { kind: "session" } },
  });
  assert.equal(result, true);
  assert.deepEqual(dispatched, [
    { envelope, options: { persistenceScope: { kind: "session" } } },
  ]);
  assert.deepEqual(frames, []);
});

test("run-event-listener rejects malformed authority commits", () => {
  const { listener, frames } = createListener({ onAuthorityEventCommitted: () => true });
  assert.throws(
    () => listener.onEvent({ event: "authority_event_committed", data: { envelope: {} } }),
    /invalid committed authority event/,
  );
  assert.deepEqual(frames, []);
});

test("run-event-listener uses Agent lifecycle only for local run coordination", () => {
  const running = [];
  const { listener, frames } = createListener({ onRootRunning: (data) => running.push(data) });
  listener.onEvent({
    event: "agent_lifecycle_state_changed",
    data: {
      state: "running",
      sessionId: "root-session",
      turnScopeId: "turn-1",
      dialogProcessId: "dialog-1",
    },
  });
  assert.equal(running.length, 1);
  assert.deepEqual(frames, []);
});

test("run-event-listener rejects every event outside the private run contract", () => {
  const { listener, frames } = createListener();
  for (const event of [
    "llm_delta",
    "done",
    "user_stopped",
    "workflow_node_state_committed",
    "attachment_lifecycle",
    "tool_call_start",
    "unknown_event",
  ]) {
    assert.throws(
      () => listener.onEvent({ event, data: {} }),
      new RegExp(`unsupported agent run event: ${event}`),
    );
  }
  assert.deepEqual(frames, []);
});
