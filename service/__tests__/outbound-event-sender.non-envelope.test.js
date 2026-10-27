/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createOutboundEventSender } from "../ws/chat-websocket/outbound-event-sender.js";

function createSender() {
  const logs = [];
  const packets = [];
  const sendEvent = createOutboundEventSender({
    webSocket: {
      readyState: 1,
      send: (packet, callback) => {
        packets.push(packet);
        callback();
      },
    },
    state: {},
    logConnection: (event, data) => logs.push({ event, data }),
  });
  return { sendEvent, logs, packets };
}

function rejection(logs) {
  const entries = logs.filter(
    (item) => item.event === "service.websocket.nonEnvelopeEventRejected",
  );
  assert.equal(entries.length, 1);
  return entries[0].data;
}

test("outbound sender rejects non-envelope events the transport protocol does not register", async () => {
  const { sendEvent, logs, packets } = createSender();
  const result = await sendEvent("attachment_lifecycle", {
    sessionId: "root-session",
    eventType: "parsed",
  });
  assert.equal(result, false);
  assert.deepEqual(packets, []);
  assert.deepEqual(rejection(logs), {
    eventName: "attachment_lifecycle",
    nonEnvelopeKind: "",
    errors: ["unregistered_non_envelope_event"],
  });
});

test("outbound sender rejects session receipts that violate the protocol contract", async () => {
  const { sendEvent, logs, packets } = createSender();
  const result = await sendEvent("turn_committed", {
    sessionId: "root-session",
    turnScopeId: "turn-1",
  });
  assert.equal(result, false);
  assert.deepEqual(packets, []);
  const rejected = rejection(logs);
  assert.equal(rejected.eventName, "turn_committed");
  assert.ok(rejected.nonEnvelopeKind, "session receipt must be classified by the protocol");
  assert.ok(rejected.errors.includes("user_message_missing"), rejected.errors.join(","));
});
