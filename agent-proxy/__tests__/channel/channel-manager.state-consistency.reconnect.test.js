/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { createChannelKey } from "../../src/shared/utils.js";
import { createMockSocket, getEvent, listEvents, sortReconnectSessions } from "./channel-manager.state-consistency.test-helpers.js";
import { TURN_LIFECYCLE_PROTOCOL_VERSION } from "@noobot/authoritative-state/contracts";

function authoritativeLifecycle(fields = {}) {
  const eventType = String(fields.eventType || "").trim();
  const terminal = eventType === "turn.completed" || eventType === "turn.stop_completed";
  return {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    messageId: "message-1",
    presentationMessageId: "message-1",
    ...(terminal ? { completionCommitId: "commit-1", summaryVersion: 1 } : {}),
    ...fields,
  };
}

test("authoritative lifecycle replay is session-scoped, ordered, and deduplicated", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-lifecycle-window" }),
    { userId: "user-1", sessionId: "session-lifecycle-window" },
  );
  for (const envelope of [
    { eventId: "e2", sessionId: "session-lifecycle-window", turnScopeId: "t1", revision: 2, sequence: 2 },
    { eventId: "e1", sessionId: "session-lifecycle-window", turnScopeId: "t1", revision: 1, sequence: 1 },
    { eventId: "e2", sessionId: "session-lifecycle-window", turnScopeId: "t1", revision: 2, sequence: 2 },
    { eventId: "other", sessionId: "other-session", turnScopeId: "t2", revision: 1, sequence: 1 },
  ]) manager.pushChannelEvent(channel, "turn_lifecycle", envelope);

  assert.deepEqual(
    manager.getTurnLifecycleReplay(channel, "session-lifecycle-window", 0),
    { events: [
      { eventId: "e1", sessionId: "session-lifecycle-window", turnScopeId: "t1", revision: 1, sequence: 1 },
      { eventId: "e2", sessionId: "session-lifecycle-window", turnScopeId: "t1", revision: 2, sequence: 2 },
    ], requiresSnapshot: false },
  );
  assert.deepEqual(
    manager.getTurnLifecycleReplay(channel, "session-lifecycle-window", 1).events.map((item) => item.eventId),
    ["e2"],
  );
});

test("reconnect derives an active run only from the authoritative lifecycle window", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-authoritative-running";
  const turnScopeId = "turn-authoritative-running";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
    turnScopeId,
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    eventType: "turn.action_accepted",
    eventId: "active-1",
    commandId: "command-active",
    sessionId,
    turnScopeId,
    dialogProcessId: "dp-authoritative-running",
    revision: 1,
    sequence: 1,
    state: "action_requesting",
    phase: "action",
  }));
  manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    eventType: "turn.processing_started",
    eventId: "active-2",
    commandId: "command-active",
    sessionId,
    turnScopeId,
    dialogProcessId: "dp-authoritative-running",
    revision: 2,
    sequence: 2,
    state: "processing",
    phase: "processing",
  }));
  manager.pushChannelEvent(channel, "delta", {
    sessionId,
    turnScopeId,
    dialogProcessId: "dp-authoritative-running",
    seq: 3,
    content: "buffered after refresh",
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.handleReconnect(client, { currentSessionId: sessionId });

  const session = getEvent(client, "reconnect_data").data.sessions[0];
  assert.equal(session.hasRunningTask, true);
  assert.equal(session.currentRun.sessionId, sessionId);
  assert.equal(session.currentRun.turnScopeId, turnScopeId);
  assert.equal(session.currentRun.dialogProcessId, "dp-authoritative-running");
  assert.equal(session.currentRun.state, "sending");
  assert.equal(session.currentRun.lifecycleState, "processing");
  assert.equal(session.currentRun.authoritativeLifecycle, true);
  assert.equal(session.dialogProcesses[0].messages.some((item) => item.event === "delta"), true);
});

test("terminal lifecycle removes the reconnect active-run projection", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-authoritative-terminal";
  const turnScopeId = "turn-authoritative-terminal";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1", sessionId, turnScopeId,
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  for (const envelope of [
    { eventType: "turn.processing_started", eventId: "terminal-1", state: "processing", phase: "processing", revision: 1, sequence: 1 },
    { eventType: "turn.completed", eventId: "terminal-2", state: "completed", phase: "completion", revision: 2, sequence: 2 },
  ]) {
    manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
      commandId: "command-terminal",
      sessionId,
      turnScopeId,
      dialogProcessId: "dp-authoritative-terminal",
      ...envelope,
    }));
  }
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.handleReconnect(client, { currentSessionId: sessionId });

  const session = getEvent(client, "reconnect_data").data.sessions[0];
  assert.equal(session.hasRunningTask, false);
  assert.equal(session.currentRun, null);
});

test("reconnect aggregates lifecycle authority across channels of the same session", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-multi-channel-active";
  const turnScopeId = "turn-multi-channel-active";
  const firstChannel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId, parentDialogProcessId: "parent-a" }),
    { userId: "user-1", sessionId, parentDialogProcessId: "parent-a" },
  );
  const secondChannel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId, parentDialogProcessId: "parent-b" }),
    { userId: "user-1", sessionId, parentDialogProcessId: "parent-b" },
  );
  for (const channel of [firstChannel, secondChannel]) {
    channel.ownerApiKey = "api-key-1";
    channel.ownerUserId = "user-1";
  }
  manager.pushChannelEvent(firstChannel, "turn_lifecycle", authoritativeLifecycle({
    eventType: "turn.action_accepted",
    eventId: "multi-active-1",
    commandId: "multi-active-command",
    sessionId,
    turnScopeId,
    dialogProcessId: "dp-multi-active",
    revision: 1,
    sequence: 1,
    state: "action_requesting",
    phase: "action",
  }));
  manager.pushChannelEvent(secondChannel, "turn_lifecycle", authoritativeLifecycle({
    eventType: "turn.processing_started",
    eventId: "multi-active-2",
    commandId: "multi-active-command",
    sessionId,
    turnScopeId,
    dialogProcessId: "dp-multi-active",
    revision: 2,
    sequence: 2,
    state: "processing",
    phase: "processing",
  }));
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.handleReconnect(client, { currentSessionId: sessionId });

  const session = getEvent(client, "reconnect_data").data.sessions[0];
  assert.equal(session.hasRunningTask, true);
  assert.equal(session.currentRun.eventId, "multi-active-2");
  assert.equal(session.currentRun.turnScopeId, turnScopeId);
  assert.deepEqual(
    session.lifecycleEvents.map((item) => item.data.eventId),
    ["multi-active-1", "multi-active-2"],
  );
});

test("latest terminal lifecycle wins across channels of the same session", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-multi-channel-terminal";
  const turnScopeId = "turn-multi-channel-terminal";
  const activeChannel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId, parentDialogProcessId: "parent-active" }),
    { userId: "user-1", sessionId },
  );
  const terminalChannel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId, parentDialogProcessId: "parent-terminal" }),
    { userId: "user-1", sessionId },
  );
  for (const channel of [activeChannel, terminalChannel]) {
    channel.ownerApiKey = "api-key-1";
    channel.ownerUserId = "user-1";
  }
  for (const [channel, envelope] of [
    [activeChannel, { eventType: "turn.processing_started", eventId: "multi-terminal-1", state: "processing", phase: "processing", revision: 1, sequence: 1 }],
    [terminalChannel, { eventType: "turn.completed", eventId: "multi-terminal-2", state: "completed", phase: "completion", revision: 2, sequence: 2 }],
  ]) {
    manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
      commandId: "multi-terminal-command",
      sessionId,
      turnScopeId,
      dialogProcessId: "dp-multi-terminal",
      ...envelope,
    }));
  }
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.handleReconnect(client, { currentSessionId: sessionId });

  const session = getEvent(client, "reconnect_data").data.sessions[0];
  assert.equal(session.hasRunningTask, false);
  assert.equal(session.currentRun, null);
  assert.deepEqual(
    session.lifecycleEvents.map((item) => item.data.eventId),
    ["multi-terminal-1", "multi-terminal-2"],
  );
});

test("parent and parallel child lifecycle windows coexist without cross-session replay", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "parent-session" }),
    { userId: "user-1", sessionId: "parent-session" },
  );
  for (const envelope of [
    { eventId: "parent-1", sessionId: "parent-session", turnScopeId: "parent-turn", revision: 1, sequence: 1 },
    { eventId: "child-a-1", sessionId: "child-a", parentSessionId: "parent-session", turnScopeId: "child-a-turn", revision: 1, sequence: 1 },
    { eventId: "child-b-1", sessionId: "child-b", parentSessionId: "parent-session", turnScopeId: "child-b-turn", revision: 1, sequence: 1 },
    { eventId: "child-a-2", sessionId: "child-a", parentSessionId: "parent-session", turnScopeId: "child-a-turn", revision: 2, sequence: 2 },
  ]) manager.pushChannelEvent(channel, "turn_lifecycle", envelope);

  assert.deepEqual(manager.getTurnLifecycleReplay(channel, "parent-session", 0).events.map((e) => e.eventId), ["parent-1"]);
  assert.deepEqual(manager.getTurnLifecycleReplay(channel, "child-a", 0).events.map((e) => e.eventId), ["child-a-1", "child-a-2"]);
  assert.deepEqual(manager.getTurnLifecycleReplay(channel, "child-b", 0).events.map((e) => e.eventId), ["child-b-1"]);
  assert.equal(manager.getTurnLifecycleReplay(channel, "child-a", 0).events.every((e) => e.parentSessionId === "parent-session"), true);
});

test("lifecycle replay gap waits for the authoritative snapshot before reconnect completes", async () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-lifecycle-gap";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1", sessionId,
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const forwarded = [];
  channel.upstreamSocket = { readyState: 1, send: (raw) => forwarded.push(JSON.parse(raw)) };
  manager.recordTurnLifecycleEnvelope(channel, {
    eventId: "e3", sessionId, turnScopeId: "t1", revision: 3, sequence: 3,
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  const reconnectPromise = manager.handleReconnect(client, {
    currentSessionId: sessionId,
    knownLifecycleSequenceMap: { [sessionId]: 1 },
  });

  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].commandType, "turn.snapshot.get");
  assert.equal(forwarded[0].knownSequence, 1);
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
    },
  });
  await reconnectPromise;

  const reconnectData = getEvent(client, "reconnect_data");
  const entry = reconnectData.data.sessions.find((item) => item.sessionId === sessionId);
  assert.equal(entry.lifecycleSnapshotRequested, true);
  assert.deepEqual(entry.lifecycleEvents, []);
  assert.equal(entry.turnLifecycleSnapshot.commandId, commandId);
  assert.equal(getEvent(client, "reconnect_complete")?.data?.totalSessions, 1);
  assert.equal(entry.hasRunningTask, false);
  assert.equal(entry.currentRun, null);
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
    event: "delta",
    data: {
      sessionId,
      dialogProcessId: "dp-reconnect-live-buffer",
      turnScopeId: "turn-reconnect-live-buffer",
      seq: 4,
      text: "buffered-live-event",
    },
  });
  assert.equal(getEvent(client, "delta"), null);

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
  assert.ok(eventNames.indexOf("delta") > eventNames.indexOf("reconnect_data"));
  assert.ok(eventNames.indexOf("reconnect_complete") > eventNames.indexOf("delta"));
});

test("reconnect freezes channel state before buffering newer channel events", async () => {
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
  await reconnectPromise;

  const channelStates = client.sentEvents.filter((item) =>
    item.event === "channel_state" &&
    item.data.dialogProcessId === "dp-reconnect-state-baseline");
  assert.deepEqual(channelStates.map((item) => item.data.state), ["processing", "completed"]);
  const eventNames = client.sentEvents.map((item) => item.event);
  assert.ok(eventNames.indexOf("reconnect_data") < eventNames.indexOf("channel_state"));
  assert.ok(eventNames.lastIndexOf("channel_state") < eventNames.indexOf("reconnect_complete"));
});

test("a superseded reconnect transaction cannot publish its stale baseline", async () => {
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

  await manager.handleReconnect(client, {
    currentSessionId: sessionId,
    requestId: "reconnect-current",
    knownLifecycleSequenceMap: { [sessionId]: 3 },
  });
  const staleRequest = channel.pendingSnapshotRequests.get(forwarded[0]?.commandId);
  staleRequest.resolve({ ok: false, reason: "snapshot_unavailable" });
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

test("channel_state inherits turnScopeId from start payload when upstream omits it", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-turn-scope" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-turn-scope",
    turnScopeId: "turn-scope-1",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.pushChannelEvent(channel, "thinking", {
    sessionId: "session-turn-scope",
    dialogProcessId: "dp-turn-scope",
    seq: 1,
  });

  const channelState = listEvents(client, "channel_state").at(-1);
  assert.equal(channelState?.data?.dialogProcessId, "dp-turn-scope");
  assert.equal(channelState?.data?.turnScopeId, "turn-scope-1");
});



test("reconnect does not derive authoritative sending state from a running transport", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-snapshot-running" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-snapshot-running",
    turnScopeId: "turn-scope-snapshot-running",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-snapshot-running",
    lastReceivedSeqMap: {},
  });

  const firstState = client.sentEvents.find((eventItem) => eventItem?.event === "channel_state");
  assert.equal(firstState?.data?.state, "no_conversation");
  assert.equal(
    client.sentEvents.some(
      (eventItem) => eventItem?.event === "channel_state" && eventItem?.data?.state === "sending",
    ),
    false,
  );
});

test("reconnect leaves business state empty for a running transport without authoritative events", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-running-empty" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-running-empty",
    turnScopeId: "turn-scope-running",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-running-empty",
    lastReceivedSeqMap: {},
  });

  const reconnectData = getEvent(client, "reconnect_data");
  assert.ok(reconnectData);
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-running-empty",
  );
  assert.equal(sessionEntry?.hasRunningTask, false);
  assert.equal(sessionEntry?.currentRun, null);
  const stateList = Array.isArray(sessionEntry?.conversationStates)
    ? sessionEntry.conversationStates
    : [];
  assert.equal(stateList.some((stateItem) => stateItem?.state === "no_conversation"), true);
  assert.equal(stateList.some((stateItem) => stateItem?.state === "sending"), false);
});

test("reconnect does not manufacture an error when a transport socket disappears", () => {
  const manager = new ChannelManager({ CONNECTING: 0, OPEN: 1 });
  const sessionId = "session-orphaned-running";
  const channelKey = createChannelKey({ userId: "user-1", sessionId });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-orphaned-running",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamEverConnected = true;
  channel.upstreamSocket = null;
  channel.upstreamClosed = true;

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, { currentSessionId: sessionId, lastReceivedSeqMap: {} });

  const reconnectData = getEvent(client, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === sessionId,
  );
  assert.equal(channel.status, "running");
  assert.equal(sessionEntry?.hasRunningTask, false);
  assert.equal(sessionEntry?.currentRun, null);
  assert.equal(
    (sessionEntry?.conversationStates || []).some((item) => item?.state === "sending"),
    false,
  );
});

test("reconnect keeps transport status separate from authoritative running state", () => {
  const manager = new ChannelManager({ CONNECTING: 0, OPEN: 1 });
  const sessionId = "session-live-running";
  const channelKey = createChannelKey({ userId: "user-1", sessionId });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-live-running",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamEverConnected = true;
  channel.upstreamSocket = { readyState: 1 };
  channel.upstreamClosed = false;

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, { currentSessionId: sessionId, lastReceivedSeqMap: {} });

  const reconnectData = getEvent(client, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === sessionId,
  );
  assert.equal(channel.status, "running");
  assert.equal(sessionEntry?.hasRunningTask, false);
  assert.equal(sessionEntry?.currentRun, null);
});


test("reconnect does not infer a running Turn from same-user transport identity", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-user-fallback" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-user-fallback",
    turnScopeId: "turn-scope-user-fallback",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-old";
  channel.ownerUserId = "user-1";

  const reconnectClient = createMockSocket({ apiKey: "api-key-new", userId: "" });
  manager.handleReconnect(reconnectClient, {
    userId: "user-1",
    currentSessionId: "session-user-fallback",
    lastReceivedSeqMap: {},
  });

  const reconnectData = getEvent(reconnectClient, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-user-fallback",
  );
  assert.equal(sessionEntry?.hasRunningTask, false);
  assert.equal(
    (sessionEntry?.conversationStates || []).some(
      (stateItem) =>
        stateItem?.state === "sending" &&
        String(stateItem?.turnScopeId || "") === "turn-scope-user-fallback",
    ),
    false,
  );
});

test("reconnect state should be consistent for all same-user clients across channel statuses", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const statusMatrix = [
    { status: "idle", hasRunningTask: false },
    { status: "connecting", hasRunningTask: false },
    { status: "running", hasRunningTask: false },
    { status: "done", hasRunningTask: false },
    { status: "user_stopped", hasRunningTask: false },
    { status: "error", hasRunningTask: false },
  ];

  for (const item of statusMatrix) {
    const sessionId = `session-${item.status}`;
    const dpId = `dp-${item.status}`;
    const channelKey = createChannelKey({ userId: "user-1", sessionId });
    const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId });
    channel.ownerApiKey = "api-key-1";
    channel.ownerUserId = "user-1";
    manager.pushChannelEvent(channel, "thinking", {
      sessionId,
      dialogProcessId: dpId,
      seq: 1,
      text: item.status,
    });
    channel.status = item.status;
  }

  const clientA = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const clientB = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });

  manager.handleReconnect(clientA, { currentSessionId: "", lastReceivedSeqMap: {} });
  manager.handleReconnect(clientB, { currentSessionId: "", lastReceivedSeqMap: {} });

  const reconnectDataA = getEvent(clientA, "reconnect_data");
  const reconnectDataB = getEvent(clientB, "reconnect_data");
  assert.ok(reconnectDataA, "clientA should receive reconnect_data");
  assert.ok(reconnectDataB, "clientB should receive reconnect_data");

  const normalizedSessionsA = sortReconnectSessions(reconnectDataA.data);
  const normalizedSessionsB = sortReconnectSessions(reconnectDataB.data);
  assert.deepEqual(
    normalizedSessionsA,
    normalizedSessionsB,
    "all same-user clients should see identical reconnect states",
  );

  for (const item of statusMatrix) {
    const sessionEntry = normalizedSessionsA.find(
      (entry) => entry.sessionId === `session-${item.status}`,
    );
    assert.ok(sessionEntry, `missing session for status=${item.status}`);
    assert.equal(
      sessionEntry.hasRunningTask,
      item.hasRunningTask,
      `unexpected hasRunningTask for status=${item.status}`,
    );
    if (["done", "user_stopped", "error"].includes(item.status)) {
      assert.equal(
        sessionEntry.dialogProcesses.length,
        0,
        `terminal status ${item.status} should not replay with lastSeq=0`,
      );
    } else {
      assert.equal(sessionEntry.dialogProcesses.length, 1);
      assert.equal(sessionEntry.dialogProcesses[0].messages[0]?.event, "thinking");
    }
    const rawSessionEntry = (reconnectDataA.data?.sessions || []).find(
      (entry) => String(entry?.sessionId || "") === `session-${item.status}`,
    );
    const stateList = Array.isArray(rawSessionEntry?.conversationStates)
      ? rawSessionEntry.conversationStates
      : [];
    assert.equal(stateList.length > 0, true);
    if (["done", "user_stopped", "error"].includes(item.status)) {
      assert.equal(stateList.some((stateItem) => stateItem?.state === "sending"), true);
    }
  }
});

test("reconnect state should be isolated between different users", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.pushChannelEvent(channel, "delta", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 1,
    text: "hello",
  });

  const otherUserClient = createMockSocket({ apiKey: "api-key-2", userId: "user-2" });
  manager.handleReconnect(otherUserClient, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: {},
  });

  const reconnectData = getEvent(otherUserClient, "reconnect_data");
  assert.ok(reconnectData);
  assert.deepEqual(reconnectData?.data?.sessions || [], []);
});

test("reconnect should include conversationStates snapshot", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.pushChannelEvent(channel, "thinking", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 1,
  });
  manager.pushChannelEvent(channel, "interaction_request", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    requestId: "req-1",
    seq: 2,
  });

  const client = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 1 },
  });
  const reconnectData = getEvent(client, "reconnect_data");
  assert.ok(reconnectData);
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-1",
  );
  const stateList = Array.isArray(sessionEntry?.conversationStates)
    ? sessionEntry.conversationStates
    : [];
  const interactionPendingState = stateList.find(
    (stateItem) => stateItem?.state === "interaction_pending",
  );
  assert.ok(interactionPendingState);
  assert.equal(
    String(interactionPendingState?.pendingInteraction?.requestId || ""),
    "req-1",
  );
  assert.equal(
    String(interactionPendingState?.pendingInteraction?.dialogProcessId || ""),
    "dp-1",
  );
  assert.equal(sessionEntry?.currentRun, null);
});

test("reconnect preserves cached authoritative states without synthesizing currentRun", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-current-run" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-current-run",
    turnScopeId: "turn-current",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.updateConversationState(channel, {
    sessionId: "session-current-run",
    dialogProcessId: "dp-old",
    turnScopeId: "turn-old",
    state: "user_stopped",
    seq: 12,
  });
  manager.updateConversationState(channel, {
    sessionId: "session-current-run",
    dialogProcessId: "dp-current",
    turnScopeId: "turn-current",
    state: "completed",
    seq: 20,
  });
  channel.status = "done";

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-current-run",
    lastReceivedSeqMap: {},
  });

  const reconnectData = getEvent(client, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-current-run",
  );
  assert.equal(sessionEntry?.hasRunningTask, false);
  assert.equal(sessionEntry?.currentRun, null);
  assert.equal(
    (sessionEntry?.conversationStates || []).some(
      (item) => item?.state === "user_stopped" && item?.turnScopeId === "turn-old",
    ),
    true,
  );
});

test("reconnect reports cache expiry without deriving reconnecting business state", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "connecting";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.pushChannelEvent(channel, "thinking", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 1,
  });

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 99 },
  });
  const reconnectData = getEvent(client, "reconnect_data");
  assert.ok(reconnectData);
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-1",
  );
  const stateList = Array.isArray(sessionEntry?.conversationStates)
    ? sessionEntry.conversationStates
    : [];
  assert.equal(stateList.some((stateItem) => stateItem?.state === "reconnecting"), false);
  assert.equal(stateList.some((stateItem) => stateItem?.state === "expired"), true);
});
