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
  TRANSIENT_MESSAGE_EVENT_SEQUENCE,
} from "@noobot/event-protocol/message-event";
import { RUNTIME_EVENT_CATEGORIES } from "@noobot/runtime-events";
import { STREAM_DELTA_DEBUG_TYPE } from "@noobot/shared/runtime-events-config";
import { createOutboundEventSender } from "../ws/chat-websocket/outbound-event-sender.js";

function messageEnvelope({ eventId, sequence, payload }) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "root-session",
      turnScopeId: "turn-1",
      messageId: "message-1",
    },
    causality: { commandId: "command-1" },
    ordering: {
      domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: "message-1",
      sequence,
      aggregateVersion: 2,
    },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload,
  });
}

function createSender() {
  const logs = [];
  const sendEvent = createOutboundEventSender({
    webSocket: { readyState: 1, send: (_packet, callback) => callback() },
    state: {},
    logConnection: (event, data, routing) => logs.push({ event, data, routing }),
    sessionLogConfig: {},
  });
  return { sendEvent, logs };
}

function eventSentRouting(logs, eventId) {
  const entry = logs.find(
    (item) => item.event === "service.authorityOutbox.eventSent" && item.data.eventId === eventId,
  );
  assert.ok(entry, `missing eventSent for ${eventId}`);
  return entry.routing;
}

test("transient delta eventSent is routed to the stream-delta debug category", async () => {
  const { sendEvent, logs } = createSender();
  const delta = messageEnvelope({
    eventId: "evt-delta",
    sequence: TRANSIENT_MESSAGE_EVENT_SEQUENCE,
    payload: {
      eventType: MESSAGE_EVENT_TYPE.LLM_DELTA,
      presentationMessageId: "presentation-1",
      text: "chunk",
    },
  });
  assert.equal(await sendEvent(MESSAGE_EVENT_WIRE_EVENT, delta), true);
  assert.deepEqual(eventSentRouting(logs, "evt-delta"), {
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: STREAM_DELTA_DEBUG_TYPE,
  });
});

test("persistent message event eventSent keeps the default backend-websocket routing", async () => {
  const { sendEvent, logs } = createSender();
  const finalContent = messageEnvelope({
    eventId: "evt-final",
    sequence: 1,
    payload: {
      eventType: MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT,
      presentationMessageId: "presentation-1",
      text: "complete body",
    },
  });
  assert.equal(await sendEvent(MESSAGE_EVENT_WIRE_EVENT, finalContent), true);
  assert.equal(eventSentRouting(logs, "evt-final"), undefined);
});

function createSlowSender(sessionLogConfig) {
  const logs = [];
  const sendEvent = createOutboundEventSender({
    webSocket: {
      readyState: 1,
      bufferedAmount: 0,
      send: (_packet, callback) => setTimeout(() => callback(), 30),
    },
    state: {},
    logConnection: (event, data, routing) => logs.push({ event, data, routing }),
    sessionLogConfig,
  });
  return { sendEvent, logs };
}

function slowFinalContent() {
  return messageEnvelope({
    eventId: "evt-slow",
    sequence: 1,
    payload: {
      eventType: MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT,
      presentationMessageId: "presentation-1",
      text: "body",
    },
  });
}

test("slow websocket send callback is logged to delivery-timing debug when enabled", async () => {
  const { sendEvent, logs } = createSlowSender({
    sessionLogControls: { debug: { backendDeliveryTiming: true } },
  });
  assert.equal(await sendEvent(MESSAGE_EVENT_WIRE_EVENT, slowFinalContent()), true);
  const slow = logs.filter((item) => item.event === "service.websocket.sendCallback.slow");
  assert.equal(slow.length, 1);
  assert.ok(slow[0].data.callbackMs >= 20);
  assert.equal(slow[0].data.failed, false);
  assert.deepEqual(slow[0].routing, {
    category: "debug",
    level: "debug",
    debugType: "delivery-timing",
  });
});

test("slow websocket send callback is not timed when delivery-timing debug is off", async () => {
  const { sendEvent, logs } = createSlowSender({});
  assert.equal(await sendEvent(MESSAGE_EVENT_WIRE_EVENT, slowFinalContent()), true);
  assert.equal(
    logs.some((item) => item.event === "service.websocket.sendCallback.slow"),
    false,
  );
});

test("fast websocket send callback is not logged as slow", async () => {
  const { sendEvent, logs } = createSender();
  const finalContent = messageEnvelope({
    eventId: "evt-fast",
    sequence: 1,
    payload: {
      eventType: MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT,
      presentationMessageId: "presentation-1",
      text: "body",
    },
  });
  assert.equal(await sendEvent(MESSAGE_EVENT_WIRE_EVENT, finalContent), true);
  assert.equal(
    logs.some((item) => item.event === "service.websocket.sendCallback.slow"),
    false,
  );
});
