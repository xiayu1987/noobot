/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../src/channel-manager.js";
import { createChannelKey } from "../src/utils.js";
import { createMockSocket } from "./channel-manager.state-consistency.test-helpers.js";

test("live business event broadcast should include channel sessionId without overriding upstream sessionId", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
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

