/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_RUN_EVENT } from "#agent/event";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { createMessageRunEventListener } from "../../ws/chat-websocket/message-run/event-listener-stage.js";
import { createTestLifecycleEnvelope } from "../routes/chat-websocket-server.turn-lifecycle.fixtures.js";

function createListener(dispatchResult, runHandle = {}) {
  const calls = [];
  const context = {
    sessionLogConfig: {},
    state: { currentRunMeta: { dialogProcessId: "dialog-1" }, currentTurnScopeId: "scope-1" },
    lifecycle: {},
    dispatchAuthorityEvents: async (request) => {
      calls.push(request);
      return dispatchResult;
    },
  };
  const run = { userId: "u1", sessionId: "root-session", parentSessionId: "" };
  const active = { runHandle, runMeta: { turnScopeId: "scope-1" } };
  const { eventListener } = createMessageRunEventListener(context, run, {}, active);
  return { eventListener, calls };
}

function commitAuthorityEvent(eventListener) {
  return eventListener.onEvent({
    event: AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED,
    data: { envelope: createTestLifecycleEnvelope({ eventId: "evt-stage-1" }) },
  });
}

test("authority_event_send_failed degrades instead of failing the turn", async () => {
  const { eventListener, calls } = createListener({
    dispatched: false,
    reason: "authority_event_send_failed",
    delivered: 0,
  });
  const result = await commitAuthorityEvent(eventListener);
  assert.equal(calls.length, 1);
  assert.equal(result.deliveryDegraded, true);
  assert.equal(result.reason, "authority_event_send_failed");
});

test("non-replayable dispatch failures still throw", async () => {
  const { eventListener } = createListener({
    dispatched: false,
    reason: "authority_outbox_unavailable",
  });
  await assert.rejects(commitAuthorityEvent(eventListener), /authority_outbox_unavailable/);
});

test("missing dispatch reason still throws", async () => {
  const { eventListener } = createListener(null);
  await assert.rejects(commitAuthorityEvent(eventListener), /authority_event_dispatch_failed/);
});

test("successful dispatch passes through unchanged", async () => {
  const dispatched = { dispatched: true, delivered: 1 };
  const { eventListener } = createListener(dispatched);
  assert.equal(await commitAuthorityEvent(eventListener), dispatched);
});

test("transient message events bypass the authority dispatcher", async () => {
  const sent = [];
  const runHandle = {
    transportBinding: {
      id: "binding-1",
      send: async (eventName) => {
        sent.push(eventName);
        return true;
      },
    },
  };
  const { eventListener, calls } = createListener(null, runHandle);
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: "evt-delta-1",
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "root-session",
      turnScopeId: "scope-1",
      messageId: "message-1",
    },
    causality: {},
    ordering: { domain: "message-event", scopeId: "message-1", sequence: 0 },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-10-05T00:00:00.000Z",
    payload: {
      eventType: "llm_delta",
      presentationMessageId: "p-1",
      dialogProcessId: "d-1",
      text: "x",
    },
  });
  const result = await eventListener.onEvent({
    event: AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED,
    data: { envelope },
  });
  assert.deepEqual(result, { dispatched: true, delivered: 1 });
  assert.deepEqual(sent, [MESSAGE_EVENT_WIRE_EVENT]);
  assert.equal(calls.length, 0);
});
