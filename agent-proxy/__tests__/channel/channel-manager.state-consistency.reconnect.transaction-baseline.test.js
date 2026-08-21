/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { CHANNEL_RETENTION_PHASE, CHANNEL_STATUS } from "../../src/shared/constants.js";
import { createChannelKey } from "../../src/shared/utils.js";
import {
  createMockSocket,
  canonicalMessageEvent,
  FakeUpstreamWebSocket,
  getEvent,
  listEvents,
  sortReconnectSessions,
} from "./channel-manager.state-consistency.test-helpers.js";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_PROTOCOL_VERSION,
} from "@noobot/session-protocol";
import { authoritativeLifecycle } from "./channel-manager.state-consistency.reconnect.fixtures.js";

test("lifecycle replay gap waits for the authoritative snapshot before reconnect completes", async () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-lifecycle-gap";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const forwarded = [];
  channel.upstreamSocket = { readyState: 1, send: (raw) => forwarded.push(JSON.parse(raw)) };
  manager.recordTurnLifecycleEnvelope(channel, {
    eventId: "e3",
    sessionId,
    turnScopeId: "t1",
    revision: 3,
    sequence: 3,
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  const reconnectPromise = manager.handleReconnect(client, {
    currentSessionId: sessionId,
    knownLifecycleSequenceMap: { [sessionId]: 1 },
  });

  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].commandType, "turn.snapshot.get");
  assert.equal(forwarded[0].identity.sessionId, sessionId);
  assert.equal(forwarded[0].options.knownSequence, 1);
  assert.equal(channel.pendingSnapshotRequests.size, 1);
  assert.equal(getEvent(client, "reconnect_data"), null);
  assert.equal(getEvent(client, "reconnect_complete"), null);

  const commandId = forwarded[0].commandId;
  channel.pendingSnapshotRequests.get(commandId).resolve({
    ok: true,
    snapshot: {
      protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
      eventType: "turn.snapshot",
      commandId,
      sessionId,
      sequence: 3,
      activeTurnScopeId: "t1",
      activeTurn: {
        turnScopeId: "t1",
        messageId: "message-1",
        presentationMessageId: "message-1",
        revision: 3,
        sequence: 3,
        state: "processing",
      },
      recentTerminalTurns: [],
      replacedTurns: [
        {
          turnScopeId: "turn-old",
          replacementDialogProcessId: "dialog-t1",
          replacementTurnScopeId: "t1",
          replacementUserMessageId: "user-t1",
          commandId: "replace-turn-old",
          committedVersion: 4,
          replacedTurnScopeIds: ["turn-old"],
          sequence: 2,
          committedAt: "2026-08-02T10:00:00.000Z",
        },
      ],
    },
  });
  await reconnectPromise;

  const reconnectData = getEvent(client, "reconnect_data");
  const entry = reconnectData.data.sessions.find((item) => item.sessionId === sessionId);
  assert.equal("replayRequiresSnapshot" in entry, false);
  assert.deepEqual(entry.replayBatch.events, []);
  assert.equal(entry.replayBatch.snapshot.commandId, commandId);
  assert.equal(entry.replayBatch.snapshotSequence, 3);
  assert.deepEqual(
    entry.replayBatch.snapshot.replacedTurns.map((item) => item.turnScopeId),
    ["turn-old"],
  );
  assert.equal("cacheExpired" in entry.replayBatch, false);
  assert.equal(getEvent(client, "reconnect_complete")?.data?.totalSessions, 1);
  assert.equal("hasRunningTask" in entry, false);
  assert.equal("currentRun" in entry, false);
});

test("reconnect sends the authoritative baseline before channel state snapshots", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-baseline-order";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-baseline-order",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.pushChannelEvent(channel, "interaction_request", {
    sessionId,
    dialogProcessId: "dp-baseline-order",
    turnScopeId: "turn-baseline-order",
    requestId: "request-baseline-order",
    seq: 3,
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.handleReconnect(client, { currentSessionId: sessionId });

  const eventNames = client.sentEvents.map((item) => item.event);
  assert.ok(eventNames.indexOf("reconnect_data") >= 0);
  assert.ok(eventNames.indexOf("channel_state") > eventNames.indexOf("reconnect_data"));
  assert.ok(eventNames.indexOf("reconnect_complete") > eventNames.indexOf("channel_state"));
});

test("reconnect buffers live events until after the authoritative baseline", async () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-reconnect-live-buffer";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-reconnect-live-buffer",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const forwarded = [];
  channel.upstreamSocket = {
    readyState: 1,
    send: (raw) => forwarded.push(JSON.parse(String(raw || "{}"))),
  };
  manager.recordTurnLifecycleEnvelope(channel, {
    eventId: "buffer-gap-3",
    sessionId,
    turnScopeId: "turn-reconnect-live-buffer",
    revision: 3,
    sequence: 3,
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const reconnectPromise = manager.handleReconnect(client, {
    currentSessionId: sessionId,
    knownLifecycleSequenceMap: { [sessionId]: 1 },
  });
  manager.broadcastChannelEvent(channel, {
    sequence: 4,
    event: MESSAGE_EVENT_WIRE_EVENT,
    data: canonicalMessageEvent({
      sessionId,
      turnScopeId: "turn-reconnect-live-buffer",
      sequence: 4,
      text: "buffered-live-event",
    }),
  });
  assert.equal(getEvent(client, MESSAGE_EVENT_WIRE_EVENT), null);

  const commandId = forwarded[0]?.commandId;
  const requester = channel.pendingSnapshotRequests.get(commandId);
  requester.resolve({
    ok: true,
    snapshot: {
      protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
      eventType: "turn.snapshot",
      commandId,
      sessionId,
      sequence: 3,
      activeTurnScopeId: "turn-reconnect-live-buffer",
      activeTurn: {
        turnScopeId: "turn-reconnect-live-buffer",
        messageId: "message-reconnect-live-buffer",
        presentationMessageId: "message-reconnect-live-buffer",
        revision: 3,
        sequence: 3,
        state: "processing",
      },
      recentTerminalTurns: [],
    },
  });
  await reconnectPromise;

  const eventNames = client.sentEvents.map((item) => item.event);
  assert.ok(eventNames.indexOf(MESSAGE_EVENT_WIRE_EVENT) > eventNames.indexOf("reconnect_data"));
  assert.ok(
    eventNames.indexOf("reconnect_complete") > eventNames.indexOf(MESSAGE_EVENT_WIRE_EVENT),
  );
});

test("reconnect rejects the transaction when the authoritative snapshot is unavailable", async () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-reconnect-state-baseline";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-reconnect-state-baseline",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const forwarded = [];
  channel.upstreamSocket = {
    readyState: 1,
    send: (raw) => forwarded.push(JSON.parse(String(raw || "{}"))),
  };
  manager.recordTurnLifecycleEnvelope(channel, {
    eventId: "state-baseline-gap-3",
    sessionId,
    turnScopeId: "turn-reconnect-state-baseline",
    revision: 3,
    sequence: 3,
  });
  manager.updateConversationState(channel, {
    sessionId,
    dialogProcessId: "dp-reconnect-state-baseline",
    state: "processing",
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const reconnectPromise = manager.handleReconnect(client, {
    currentSessionId: sessionId,
    knownLifecycleSequenceMap: { [sessionId]: 1 },
  });

  manager.updateConversationState(channel, {
    sessionId,
    dialogProcessId: "dp-reconnect-state-baseline",
    state: "completed",
  });

  const pendingRequest = channel.pendingSnapshotRequests.get(forwarded[0]?.commandId);
  pendingRequest.resolve({ ok: false, reason: "snapshot_unavailable" });
  await assert.rejects(reconnectPromise, /authoritative_snapshot_failed/);
  assert.equal(getEvent(client, "reconnect_data"), null);
  assert.equal(getEvent(client, "reconnect_complete"), null);
  assert.deepEqual(
    client.sentEvents.filter((item) => item.event === "channel_state"),
    [],
  );
});

test("reconnect removes a channel whose Session is authoritatively deleted", async () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-deleted-before-reconnect";
  const channelKey = createChannelKey({ userId: "user-1", sessionId });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-deleted-before-reconnect",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const forwarded = [];
  channel.upstreamSocket = {
    readyState: 1,
    send: (raw) => forwarded.push(JSON.parse(String(raw || "{}"))),
  };
  manager.recordTurnLifecycleEnvelope(channel, {
    eventId: "deleted-session-active-1",
    sessionId,
    turnScopeId: "turn-deleted-before-reconnect",
    revision: 3,
    sequence: 3,
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  const reconnectPromise = manager.handleReconnect(client, {
    currentSessionId: sessionId,
    knownLifecycleSequenceMap: { [sessionId]: 1 },
  });
  const pendingRequest = channel.pendingSnapshotRequests.get(forwarded[0]?.commandId);
  pendingRequest.resolve({ ok: false, reason: "session_not_found" });
  await reconnectPromise;

  assert.equal(manager.hasChannel(channelKey), false);
  assert.equal(client.__agentProxyChannelKeys.has(channelKey), false);
  assert.deepEqual(getEvent(client, "reconnect_data")?.data?.sessions, []);
  assert.equal(getEvent(client, "reconnect_complete")?.data?.totalSessions, 0);
  assert.deepEqual(
    client.sentEvents.filter((item) => item.event === "channel_state"),
    [],
  );
});

test("a superseded reconnect transaction cannot publish its stale baseline", async (t) => {
  t.mock.method(Date, "now", () => 1787068800000);
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-reconnect-superseded";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-reconnect-superseded",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const forwarded = [];
  channel.upstreamSocket = {
    readyState: 1,
    send: (raw) => forwarded.push(JSON.parse(String(raw || "{}"))),
  };
  manager.recordTurnLifecycleEnvelope(channel, {
    eventId: "superseded-gap-3",
    sessionId,
    turnScopeId: "turn-reconnect-superseded",
    revision: 3,
    sequence: 3,
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const staleReconnect = manager.handleReconnect(client, {
    currentSessionId: sessionId,
    requestId: "reconnect-stale",
    knownLifecycleSequenceMap: { [sessionId]: 1 },
  });

  const currentReconnect = manager.handleReconnect(client, {
    currentSessionId: sessionId,
    requestId: "reconnect-current",
    knownLifecycleSequenceMap: { [sessionId]: 3 },
  });
  assert.notEqual(forwarded[0]?.commandId, forwarded[1]?.commandId);
  assert.equal(channel.pendingSnapshotRequests.has(forwarded[0]?.commandId), false);
  const currentCommandId = forwarded[1]?.commandId;
  channel.pendingSnapshotRequests.get(currentCommandId).resolve({
    ok: true,
    snapshot: {
      protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
      eventType: "turn.snapshot",
      commandId: currentCommandId,
      sessionId,
      sequence: 3,
      activeTurnScopeId: "turn-reconnect-superseded",
      activeTurn: {
        turnScopeId: "turn-reconnect-superseded",
        messageId: "message-superseded-gap-3",
        presentationMessageId: "presentation-superseded-gap-3",
        revision: 3,
        sequence: 3,
        state: "processing",
      },
      recentTerminalTurns: [],
      replacedTurns: [],
    },
  });
  await currentReconnect;
  await staleReconnect;

  assert.deepEqual(
    client.sentEvents
      .filter((item) => item.event === "reconnect_data")
      .map((item) => item.data.requestId),
    ["reconnect-current"],
  );
  assert.deepEqual(
    client.sentEvents
      .filter((item) => item.event === "reconnect_complete")
      .map((item) => item.data.requestId),
    ["reconnect-current"],
  );
});
