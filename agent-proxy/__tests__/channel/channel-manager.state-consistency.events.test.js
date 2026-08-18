/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { createChannelKey, ensureConnectionId, resolveMessageEventTrace } from "../../src/shared/utils.js";
import { createMockSocket } from "./channel-manager.state-consistency.test-helpers.js";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";

function messageEnvelope({
  sequence = 1,
  sessionId = "session-1",
  turnScopeId = "turn-1",
  messageId = "message-1",
  eventType = MESSAGE_EVENT_TYPE.LLM_DELTA,
  text = "content",
} = {}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: `event-${sequence}`,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId,
      turnScopeId,
      messageId,
    },
    causality: { commandId: "command-1" },
    ordering: {
      domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: messageId,
      sequence,
      aggregateVersion: sequence,
    },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: {
      eventType,
      presentationMessageId: messageId,
      text,
    },
  });
}

test("live business event broadcast should include channel sessionId without overriding upstream sessionId", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-1",
    requestId: "stream-command-request",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);

  const thinkingEnvelope = manager.pushChannelEvent(
    channel,
    MESSAGE_EVENT_WIRE_EVENT,
    messageEnvelope({ sequence: 1 }),
  );
  manager.broadcastChannelEvent(channel, thinkingEnvelope);

  const deltaEnvelope = manager.pushChannelEvent(
    channel,
    MESSAGE_EVENT_WIRE_EVENT,
    messageEnvelope({ sequence: 2, sessionId: "upstream-session" }),
  );
  manager.broadcastChannelEvent(channel, deltaEnvelope);

  const businessEvents = client.sentEvents.filter((item) => item?.event !== "channel_state");
  assert.equal(businessEvents[0]?.channelSessionId, "session-1");
  assert.equal(businessEvents[0]?.data?.identity?.sessionId, "session-1");
  assert.equal(businessEvents[1]?.data?.identity?.sessionId, "upstream-session");
  assert.equal(businessEvents[1]?.channelSessionId, "session-1");
  assert.equal(businessEvents[0]?.data?.requestId, undefined);
  assert.equal(businessEvents[1]?.data?.requestId, undefined);
  assert.equal(thinkingEnvelope?.data?.identity?.sessionId, "session-1");
});

test("event replay should include channel sessionId without mutating cached envelope", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";

  const envelope = manager.pushChannelEvent(
    channel,
    MESSAGE_EVENT_WIRE_EVENT,
    messageEnvelope({ sequence: 1 }),
  );
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.replayChannelEvents(channel, client, 0);

  assert.equal(client.sentEvents[0]?.channelSessionId, "session-1");
  assert.equal(client.sentEvents[0]?.data?.identity?.sessionId, "session-1");
  assert.equal(envelope?.data?.identity?.sessionId, "session-1");
});

test("broadcast event order should be identical across same-channel clients", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  const clientA = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const clientB = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });
  manager.attachSubscriber(channel, clientA);
  manager.attachSubscriber(channel, clientB);

  const eventSpecs = Array.from({ length: 5 }, (_, index) => ({
    event: MESSAGE_EVENT_WIRE_EVENT,
    data: messageEnvelope({
      sequence: index + 1,
      eventType: index % 2 ? MESSAGE_EVENT_TYPE.THINKING : MESSAGE_EVENT_TYPE.LLM_DELTA,
      text: `content-${index + 1}`,
    }),
  }));

  for (const spec of eventSpecs) {
    const envelope = manager.pushChannelEvent(channel, spec.event, spec.data);
    manager.broadcastChannelEvent(channel, envelope);
  }

  const businessEventsA = clientA.sentEvents.filter((item) => item?.event !== "channel_state");
  const businessEventsB = clientB.sentEvents.filter((item) => item?.event !== "channel_state");
  assert.equal(businessEventsA.length, eventSpecs.length);
  assert.equal(businessEventsB.length, eventSpecs.length);
  assert.deepEqual(clientA.sentEvents, clientB.sentEvents);
  assert.deepEqual(
    businessEventsA.map((item) => `${item.event}:${Number(item?.data?.ordering?.sequence || 0)}`),
    ["message_event:1", "message_event:2", "message_event:3", "message_event:4", "message_event:5"],
  );
  assert.equal(clientA.__agentProxyLastSequenceByChannel[channelKey], 5);
  assert.equal(clientB.__agentProxyLastSequenceByChannel[channelKey], 5);
});

test("connection ids are stable per socket and isolated between sockets", () => {
  const socketA = createMockSocket();
  const socketB = createMockSocket();
  assert.equal(ensureConnectionId(socketA), ensureConnectionId(socketA));
  assert.notEqual(ensureConnectionId(socketA), ensureConnectionId(socketB));
});

test("message event tracing only accepts the shared authoritative envelope", () => {
  const authoritative = messageEnvelope({ sequence: 7 });
  assert.deepEqual(resolveMessageEventTrace(MESSAGE_EVENT_WIRE_EVENT, authoritative, 9), {
    protocolKind: "message_event",
    transportEvent: "message_event",
    transportSequence: 9,
    eventId: "event-7",
    eventType: MESSAGE_EVENT_WIRE_EVENT,
    messageId: "message-1",
    authoritativeSequence: 7,
    sessionId: "session-1",
    turnScopeId: "turn-1",
    dialogProcessId: "",
  });
  assert.equal(resolveMessageEventTrace("subagent_message_event", authoritative, 11).protocolKind, "non_message_event");
  assert.equal(resolveMessageEventTrace("thinking", authoritative, 9).protocolKind, "non_message_event");
  assert.equal(resolveMessageEventTrace(MESSAGE_EVENT_WIRE_EVENT, { eventId: "loose" }, 9).protocolKind, "non_message_event");
});

test("broadcast only records unsuccessful delivery results", () => {
  const records = [];
  const manager = new ChannelManager({ OPEN: 1 }, {
    sessionLogClient: { log: (_apiKey, event) => records.push(event) },
  });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.ownerApiKey = "api-key-1";
  const openSocket = createMockSocket();
  const closedSocket = createMockSocket();
  closedSocket.readyState = 3;
  channel.subscribers.add(openSocket);
  channel.subscribers.add(closedSocket);

  const envelope = manager.pushChannelEvent(
    channel,
    MESSAGE_EVENT_WIRE_EVENT,
    messageEnvelope({ sequence: 1 }),
  );
  manager.broadcastChannelEvent(channel, envelope);

  const deliveries = records.filter(
    (item) =>
      item.event === "agentProxy.channel.broadcast.delivery" &&
      item.data.transportEvent === MESSAGE_EVENT_WIRE_EVENT,
  );
  assert.deepEqual(deliveries.map((item) => item.data.result), ["skipped"]);
  assert.equal(deliveries[0]?.data?.dropReason, "socket_not_open");
  assert.ok(deliveries.every((item) => item.data.connectionId));
  assert.equal(openSocket.__agentProxyLastSequenceByChannel[channelKey], 1);
  assert.equal(closedSocket.__agentProxyLastSequenceByChannel?.[channelKey], undefined);
});
