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
  FakeUpstreamWebSocket,
  getEvent,
  listEvents,
  sortReconnectSessions,
} from "./channel-manager.state-consistency.test-helpers.js";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_PROTOCOL_VERSION,
} from "@noobot/session-protocol";
import { authoritativeLifecycle } from "./channel-manager.state-consistency.reconnect.fixtures.js";

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
  ]) manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    ...envelope,
    eventType: envelope.eventId === "e1" || envelope.eventId === "e2" ? TURN_EVENT.PROCESSING_STARTED : TURN_EVENT.PROCESSING_STARTED,
  }));

  const replay = manager.getTurnLifecycleReplay(channel, "session-lifecycle-window", 0);
  assert.equal(replay.hasReplayGap, false);
  assert.deepEqual(replay.events.map(({ eventId, sessionId, turnScopeId, revision, sequence }) => ({
    eventId, sessionId, turnScopeId, revision, sequence,
  })), [
    { eventId: "e1", sessionId: "session-lifecycle-window", turnScopeId: "t1", revision: 1, sequence: 1 },
    { eventId: "e2", sessionId: "session-lifecycle-window", turnScopeId: "t1", revision: 2, sequence: 2 },
  ]);
  assert.deepEqual(
    manager.getTurnLifecycleReplay(channel, "session-lifecycle-window", 1).events.map((item) => item.eventId),
    ["e2"],
  );
});

test("reconnect confirms a cached active lifecycle with the authoritative snapshot", async () => {
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
  const forwarded = [];
  channel.upstreamSocket = { readyState: 1, send: (raw) => forwarded.push(JSON.parse(raw)) };
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  const reconnectPromise = manager.handleReconnect(client, { currentSessionId: sessionId });
  assert.equal(getEvent(client, "reconnect_data"), null);
  const commandId = forwarded[0]?.commandId;
  channel.pendingSnapshotRequests.get(commandId).resolve({
    ok: true,
    snapshot: {
      protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
      eventType: "turn.snapshot",
      commandId,
      sessionId,
      sequence: 2,
      activeTurnScopeId: turnScopeId,
      activeTurn: {
        turnScopeId,
        messageId: "message-active-2",
        presentationMessageId: "presentation-active-2",
        dialogProcessId: "dp-authoritative-running",
        revision: 2,
        sequence: 2,
        state: "processing",
      },
      recentTerminalTurns: [],
    },
  });
  await reconnectPromise;

  const session = getEvent(client, "reconnect_data").data.sessions[0];
  assert.equal("hasRunningTask" in session, false);
  assert.equal("currentRun" in session, false);
  assert.equal(session.replayBatch.snapshot.activeTurnScopeId, turnScopeId);
  assert.deepEqual(session.replayBatch.events, []);
  assert.equal("dialogProcesses" in session, false);
});

test("reconnect opens a query transport without replaying the stale run command", async () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const sessionId = "session-query-transport";
  const turnScopeId = "turn-query-transport";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    action: "send",
    userId: "user-1",
    sessionId,
    turnScopeId,
    message: "stale run must not be replayed",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.retention.phase = CHANNEL_RETENTION_PHASE.TERMINAL_RETAINED;
  channel.retention.terminalStatus = CHANNEL_STATUS.USER_STOPPED;
  manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "query-active-1",
    sessionId,
    turnScopeId,
    dialogProcessId: "dp-query-transport",
    revision: 1,
    sequence: 1,
  }));
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  const reconnectPromise = manager.handleReconnect(client, { currentSessionId: sessionId });
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  assert.ok(upstream);
  upstream.emit("open");
  assert.equal(upstream.sent.length, 1);
  const snapshotCommand = JSON.parse(upstream.sent[0]);
  assert.equal(snapshotCommand.commandType, "turn.snapshot.get");
  assert.equal(snapshotCommand.identity.sessionId, sessionId);
  assert.equal(snapshotCommand.message, undefined);
  upstream.emit("message", JSON.stringify({
    event: "turn_snapshot",
    data: {
      protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
      eventType: "turn.snapshot",
      commandId: snapshotCommand.commandId,
      sessionId,
      sequence: 2,
      activeTurnScopeId: "",
      activeTurn: null,
      recentTerminalTurns: [{
        turnScopeId,
        messageId: "message-query-active-1",
        presentationMessageId: "presentation-query-active-1",
        dialogProcessId: "dp-query-transport",
        revision: 2,
        sequence: 2,
        state: "processing_failed",
        failure: { code: "service_restart_orphaned_turn" },
      }],
    },
  }));
  await reconnectPromise;

  const session = getEvent(client, "reconnect_data").data.sessions[0];
  assert.equal(session.replayBatch.snapshot.activeTurnScopeId, "");
  assert.equal(
    session.replayBatch.snapshot.recentTerminalTurns[0].failure.code,
    "service_restart_orphaned_turn",
  );
});

test("snapshot query completion cannot close a connection claimed by a concurrent run", async () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const sessionId = "session-query-run-race";
  const turnScopeId = "turn-query-run-race";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "query-run-race-active",
    sessionId,
    turnScopeId,
    revision: 1,
    sequence: 1,
  }));
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  const reconnectPromise = manager.handleReconnect(client, { currentSessionId: sessionId });
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  const snapshotCommand = JSON.parse(upstream.sent[0]);
  assert.equal(channel.transport.status().purpose, "snapshot_query");

  assert.equal(manager.forwardToUpstream(channel, {
    protocolVersion: 2,
    commandType: "turn.continue",
    commandId: "continue-query-run-race",
    identity: { sessionId, turnScopeId: "turn-query-run-race-next" },
  }), true);
  assert.equal(channel.transport.status().purpose, "run");

  upstream.emit("message", JSON.stringify({
    event: "turn_snapshot",
    data: {
      protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
      eventType: "turn.snapshot",
      commandId: snapshotCommand.commandId,
      sessionId,
      sequence: 1,
      activeTurnScopeId: turnScopeId,
      activeTurn: {
        turnScopeId,
        messageId: "message-query-run-race",
        presentationMessageId: "presentation-query-run-race",
        revision: 1,
        sequence: 1,
        state: "processing",
      },
      recentTerminalTurns: [],
    },
  }));
  await reconnectPromise;

  assert.equal(channel.upstreamSocket, upstream);
  assert.equal(upstream.readyState, FakeUpstreamWebSocket.OPEN);
  assert.equal(channel.transport.status().purpose, "run");
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
  assert.equal("hasRunningTask" in session, false);
  assert.equal("currentRun" in session, false);
});

test("reconnect confirms aggregated active lifecycle with one authoritative snapshot", async () => {
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
  const forwarded = [];
  const upstreamSocket = { readyState: 1, send: (raw) => forwarded.push(JSON.parse(raw)) };
  firstChannel.upstreamSocket = upstreamSocket;
  secondChannel.upstreamSocket = upstreamSocket;
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  const reconnectPromise = manager.handleReconnect(client, { currentSessionId: sessionId });
  const commandId = forwarded[0]?.commandId;
  const snapshotRequest = firstChannel.pendingSnapshotRequests.get(commandId) ||
    secondChannel.pendingSnapshotRequests.get(commandId);
  snapshotRequest.resolve({
    ok: true,
    snapshot: {
      protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
      eventType: "turn.snapshot",
      commandId,
      sessionId,
      sequence: 2,
      activeTurnScopeId: turnScopeId,
      activeTurn: {
        turnScopeId,
        messageId: "message-multi-active-2",
        presentationMessageId: "presentation-multi-active-2",
        dialogProcessId: "dp-multi-active",
        revision: 2,
        sequence: 2,
        state: "processing",
      },
      recentTerminalTurns: [],
    },
  });
  await reconnectPromise;

  const session = getEvent(client, "reconnect_data").data.sessions[0];
  assert.equal("hasRunningTask" in session, false);
  assert.equal("currentRun" in session, false);
  assert.equal(session.replayBatch.snapshot.activeTurnScopeId, turnScopeId);
  assert.deepEqual(session.replayBatch.events, []);
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
  assert.equal("hasRunningTask" in session, false);
  assert.equal("currentRun" in session, false);
  assert.deepEqual(
    session.replayBatch.events.map((item) => item.eventId || item.data?.eventId),
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
  ]) manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    ...envelope,
    eventType: TURN_EVENT.PROCESSING_STARTED,
    dialogProcessId: `dialog-${envelope.eventId}`,
  }));

  assert.deepEqual(manager.getTurnLifecycleReplay(channel, "parent-session", 0).events.map((e) => e.eventId), ["parent-1"]);
  assert.deepEqual(manager.getTurnLifecycleReplay(channel, "child-a", 0).events.map((e) => e.eventId), ["child-a-1", "child-a-2"]);
  assert.deepEqual(manager.getTurnLifecycleReplay(channel, "child-b", 0).events.map((e) => e.eventId), ["child-b-1"]);
  assert.equal(manager.getTurnLifecycleReplay(channel, "child-a", 0).events.every((e) => e.parentSessionId === "parent-session"), true);
});

