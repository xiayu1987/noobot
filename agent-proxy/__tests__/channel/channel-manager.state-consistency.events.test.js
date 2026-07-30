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

  const thinkingEnvelope = manager.pushChannelEvent(channel, "thinking", {
    dialogProcessId: "dp-1",
    seq: 1,
  });
  manager.broadcastChannelEvent(channel, thinkingEnvelope);

  const deltaEnvelope = manager.pushChannelEvent(channel, "delta", {
    sessionId: "upstream-session",
    dialogProcessId: "dp-1",
    seq: 2,
  });
  manager.broadcastChannelEvent(channel, deltaEnvelope);

  const businessEvents = client.sentEvents.filter((item) => item?.event !== "channel_state");
  assert.equal(businessEvents[0]?.data?.sessionId, "session-1");
  assert.equal(businessEvents[1]?.data?.sessionId, "upstream-session");
  assert.equal(businessEvents[0]?.data?.requestId, undefined);
  assert.equal(businessEvents[1]?.data?.requestId, undefined);
  assert.equal(thinkingEnvelope?.data?.sessionId, undefined);
});

test("event replay should include channel sessionId without mutating cached envelope", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";

  const envelope = manager.pushChannelEvent(channel, "thinking", {
    dialogProcessId: "dp-1",
    seq: 1,
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.replayChannelEvents(channel, client, 0);

  assert.equal(client.sentEvents[0]?.data?.sessionId, "session-1");
  assert.equal(envelope?.data?.sessionId, undefined);
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

  const eventSpecs = [
    { event: "thinking", data: { sessionId: "session-1", dialogProcessId: "dp-1", seq: 1 } },
    { event: "delta", data: { sessionId: "session-1", dialogProcessId: "dp-1", seq: 2, text: "A" } },
    {
      event: "interaction_request",
      data: { sessionId: "session-1", dialogProcessId: "dp-1", seq: 3, requestId: "req-1" },
    },
    { event: "delta", data: { sessionId: "session-1", dialogProcessId: "dp-1", seq: 4, text: "B" } },
    { event: "done", data: { sessionId: "session-1", dialogProcessId: "dp-1", seq: 5 } },
  ];

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
    businessEventsA.map((item) => `${item.event}:${Number(item?.data?.seq || 0)}`),
    ["thinking:1", "delta:2", "interaction_request:3", "delta:4", "done:5"],
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
  const authoritative = {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 2,
    eventId: "event-1",
    eventType: "tool_call_start",
    sessionId: "session-1",
    messageId: "message-1",
    presentationMessageId: "message-1",
    sequence: 7,
    timestamp: "2026-07-22T00:00:00.000Z",
    tool: "read_file",
    toolCallId: "tool-1",
    args: {},
  };
  assert.deepEqual(resolveMessageEventTrace("message_event", { event: authoritative }, 9), {
    protocolKind: "message_event",
    transportEvent: "message_event",
    transportSequence: 9,
    eventId: "event-1",
    eventType: "tool_call_start",
    messageId: "message-1",
    authoritativeSequence: 7,
    sessionId: "session-1",
    turnScopeId: "",
    dialogProcessId: "",
  });
  assert.deepEqual(resolveMessageEventTrace("subagent_message_event", { event: authoritative }, 11), {
    protocolKind: "message_event",
    transportEvent: "subagent_message_event",
    transportSequence: 11,
    eventId: "event-1",
    eventType: "tool_call_start",
    messageId: "message-1",
    authoritativeSequence: 7,
    sessionId: "session-1",
    turnScopeId: "",
    dialogProcessId: "",
  });
  assert.equal(resolveMessageEventTrace("thinking", { event: authoritative }, 9).protocolKind, "legacy");
  assert.equal(resolveMessageEventTrace("message_event", { event: { eventId: "loose" } }, 9).protocolKind, "legacy");
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

  const envelope = manager.pushChannelEvent(channel, "thinking", {
    sessionId: "session-1", dialogProcessId: "dp-1", seq: 1,
  });
  manager.broadcastChannelEvent(channel, envelope);

  const deliveries = records.filter(
    (item) =>
      item.event === "agentProxy.channel.broadcast.delivery" &&
      item.data.transportEvent === "thinking",
  );
  assert.deepEqual(deliveries.map((item) => item.data.result), ["skipped"]);
  assert.equal(deliveries[0]?.data?.dropReason, "socket_not_open");
  assert.ok(deliveries.every((item) => item.data.connectionId));
  assert.equal(openSocket.__agentProxyLastSequenceByChannel[channelKey], 1);
  assert.equal(closedSocket.__agentProxyLastSequenceByChannel?.[channelKey], undefined);
});
