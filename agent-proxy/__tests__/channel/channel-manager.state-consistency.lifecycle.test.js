/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { createChannelKey } from "../../src/shared/utils.js";
import {
  canonicalInteractionRequest,
  canonicalMessageEvent,
  createMockSocket,
  getEvent,
  listEvents,
  FakeUpstreamWebSocket,
} from "./channel-manager.state-consistency.test-helpers.js";
import {
  authoritativeLifecycle,
  authoritativeSnapshot,
} from "./channel-manager.state-consistency.reconnect.fixtures.js";
import { TURN_LIFECYCLE_PROTOCOL_VERSION } from "@noobot/session-protocol";
import { TURN_ATTACHMENTS_BOUND_WIRE_EVENT } from "@noobot/session-protocol/turn-attachment-bind";
import {
  AGENT_COMMAND,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandReceipt,
  createAgentTransportError,
  createTurnStopCommand,
} from "@noobot/agent-transport-protocol";
import { EVENT_FAMILY, createEventEnvelope } from "@noobot/event-protocol";
import { MESSAGE_EVENT_TYPE, MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { ATTACHMENT_LIFECYCLE_WIRE_EVENT } from "@noobot/attachment-protocol";

test("channel transport preserves strict event payloads during broadcast and replay", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-strict-payload";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    identity: { sessionId },
  });
  const lifecycle = {
    eventType: "attachment.parsed",
    eventVersion: 1,
    messageId: "attachment-event-1",
    identity: { attachmentId: "attachment-1", sessionId, attachmentSource: "user" },
    status: "parsed",
    occurredAt: "2026-08-17T00:00:00.000Z",
    relation: {
      relationType: "parsed_result",
      sourceIdentity: { attachmentId: "attachment-1", sessionId, attachmentSource: "user" },
      targetIdentity: { attachmentId: "parsed-1", sessionId, attachmentSource: "model" },
      createdAt: "2026-08-17T00:00:00.000Z",
    },
  };
  const live = createMockSocket();
  manager.attachSubscriber(channel, live);
  const attachmentEnvelope = createEventEnvelope({
    family: EVENT_FAMILY.ATTACHMENT_LIFECYCLE,
    identity: {
      eventId: lifecycle.messageId,
      eventType: ATTACHMENT_LIFECYCLE_WIRE_EVENT,
      sessionId,
      messageId: lifecycle.messageId,
    },
    causality: {},
    ordering: {
      domain: "attachment-lifecycle",
      scopeId: "attachment-1:session-strict-payload:user",
      sequence: 1,
    },
    producer: { type: "test", id: "agent-proxy-test" },
    occurredAt: lifecycle.occurredAt,
    payload: lifecycle,
  });
  const envelope = manager.pushChannelEvent(
    channel,
    ATTACHMENT_LIFECYCLE_WIRE_EVENT,
    attachmentEnvelope,
  );
  manager.broadcastChannelEvent(channel, envelope);

  assert.deepEqual(getEvent(live, ATTACHMENT_LIFECYCLE_WIRE_EVENT)?.data, attachmentEnvelope);

  const replay = createMockSocket();
  manager.replayChannelEvents(channel, replay, 0);
  assert.deepEqual(getEvent(replay, ATTACHMENT_LIFECYCLE_WIRE_EVENT)?.data, attachmentEnvelope);
});

test("upstream accepts the canonical Session attachment-binding receipt", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const sessionId = "session-attachment-binding";
  const dialogProcessId = "dialog-attachment-binding";
  const turnScopeId = "turn-attachment-binding";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
    turnScopeId,
  });
  const subscriber = createMockSocket();
  manager.attachSubscriber(channel, subscriber);
  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  const receipt = {
    sessionId,
    dialogProcessId,
    turnScopeId,
    aggregateVersion: 2,
    userMessage: {
      role: "user",
      messageUid: "message-uid-attachment-binding",
      messageId: "message-attachment-binding",
      sessionId,
      dialogProcessId,
      turnScopeId,
      attachments: [{ attachmentId: "attachment-binding-1", sessionId }],
    },
  };

  upstream.emit(
    "message",
    JSON.stringify({ event: TURN_ATTACHMENTS_BOUND_WIRE_EVENT, data: receipt }),
  );

  assert.deepEqual(getEvent(subscriber, TURN_ATTACHMENTS_BOUND_WIRE_EVENT)?.data, receipt);
  assert.equal(upstream.readyState, FakeUpstreamWebSocket.OPEN);
});

test("reconnect projects a pending interaction without mutating its strict payload", async () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const sessionId = "session-strict-reconnect-payload";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
  });
  const pendingInteraction = canonicalInteractionRequest({
    requestId: "interaction-strict-1",
    sessionId,
    dialogProcessId: "dialog-strict-1",
    turnScopeId: "turn-strict-1",
    interactionType: "confirmation",
    content: "Confirm operation",
  });
  channel.pendingInteractionRequests.set("interaction-strict-1", pendingInteraction);
  const reconnect = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  await manager.handleReconnect(reconnect, { currentSessionId: sessionId });

  const replay = getEvent(reconnect, "reconnect_data")?.data?.sessions?.[0]?.replayBatch;
  assert.deepEqual(replay?.pendingInteractions, [pendingInteraction]);
  assert.deepEqual(
    channel.pendingInteractionRequests.get("interaction-strict-1"),
    pendingInteraction,
  );
});

test("invalid authoritative lifecycle has no journal or state projection side effects", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-invalid-lifecycle" }),
    {
      userId: "user-1",
      sessionId: "session-invalid-lifecycle",
      turnScopeId: "stale-channel-turn",
    },
  );
  const journalSequenceBefore = Number(channel.eventJournal?.sequence || 0);
  const metricsBefore = { ...manager.successfulDataPlaneMetrics };
  const lifecycleWindowsBefore = channel.lifecycleWindowsBySessionId.size;
  const conversationStatesBefore = channel.conversationStateByDialogProcessId.size;

  const result = manager.pushChannelEvent(channel, "turn_lifecycle", {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventType: "turn.completed",
    eventId: "invalid-completed-event",
    commandId: "invalid-completed-command",
    sessionId: "session-invalid-lifecycle",
    // turnScopeId is intentionally absent and must never be inferred from startPayload.
    messageId: "message-invalid",
    presentationMessageId: "message-invalid",
    dialogProcessId: "dialog-invalid",
    revision: 1,
    sequence: 1,
    phase: "completion",
    state: "completed",
    completionCommitId: "commit-invalid",
    summaryVersion: 1,
  });

  assert.equal(result, null);
  assert.equal(Number(channel.eventJournal?.sequence || 0), journalSequenceBefore);
  assert.equal(channel.lifecycleWindowsBySessionId.size, lifecycleWindowsBefore);
  assert.equal(channel.conversationStateByDialogProcessId.size, conversationStatesBefore);
  assert.deepEqual(manager.successfulDataPlaneMetrics, metricsBefore);
});

test("upstream snapshot responses resolve and release the reconnect command", async () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-snapshot-response" }),
    { userId: "user-1", sessionId: "session-snapshot-response" },
  );
  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  let resolution = null;
  channel.pendingSnapshotRequests.set("snapshot-command-1", {
    resolve: (result) => {
      resolution = result;
    },
  });

  upstream.emit(
    "message",
    JSON.stringify({
      event: "turn_snapshot",
      data: authoritativeSnapshot({
        commandId: "snapshot-command-1",
        sessionId: "session-snapshot-response",
        sequence: 2,
      }),
    }),
  );

  assert.deepEqual(resolution, {
    ok: true,
    snapshot: authoritativeSnapshot({
      commandId: "snapshot-command-1",
      sessionId: "session-snapshot-response",
      sequence: 2,
    }),
  });
  assert.equal(channel.pendingSnapshotRequests.size, 0);
});

test("upstream snapshot errors resolve and release the reconnect command", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-snapshot-error" }),
    { userId: "user-1", sessionId: "session-snapshot-error" },
  );
  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  let resolution = null;
  channel.pendingSnapshotRequests.set("snapshot-command-error", {
    resolve: (result) => {
      resolution = result;
    },
  });

  upstream.emit(
    "message",
    JSON.stringify({
      event: AGENT_TRANSPORT_EVENT.ERROR,
      data: createAgentTransportError({
        code: "snapshot_not_found",
        message: "snapshot not found",
        commandId: "snapshot-command-error",
        identity: { sessionId: "session-snapshot-error" },
      }),
    }),
  );

  assert.deepEqual(resolution, { ok: false, reason: "snapshot_not_found" });
  assert.equal(channel.pendingSnapshotRequests.size, 0);
});

test("upstream snapshot failure receipts resolve and release the reconnect command", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const sessionId = "session-snapshot-receipt";
  const commandId = "snapshot-command-receipt";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
  });
  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  let resolution = null;
  channel.pendingSnapshotRequests.set(commandId, {
    resolve: (result) => {
      resolution = result;
    },
  });

  upstream.emit(
    "message",
    JSON.stringify({
      event: AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
      data: createAgentCommandReceipt({
        commandId,
        commandType: AGENT_COMMAND.TURN_SNAPSHOT_GET,
        outcome: AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
        identity: { sessionId },
        error: { code: "snapshot_not_found", message: "snapshot not found" },
      }),
    }),
  );

  assert.deepEqual(resolution, { ok: false, reason: "snapshot_not_found" });
  assert.equal(channel.pendingSnapshotRequests.size, 0);
});

test("upstream execution query responses return only to the registered requester", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-execution-query" }),
    { userId: "user-1", sessionId: "session-execution-query" },
  );
  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  const requester = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const observer = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, observer);
  channel.pendingExecutionRequests.set("execution-query-1", requester);

  upstream.emit(
    "message",
    JSON.stringify({
      event: "execution_tree",
      data: {
        commandId: "execution-query-1",
        rootExecutionId: "workflow-root",
        tree: { executions: {} },
      },
    }),
  );

  assert.equal(getEvent(requester, "execution_tree")?.data?.commandId, "execution-query-1");
  assert.equal(getEvent(observer, "execution_tree"), null);
  assert.equal(channel.pendingExecutionRequests.size, 0);
});

test("stop action should broadcast stopping state before terminal", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = {
    readyState: 1,
    send() {},
  };
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  manager.updateConversationState(channel, {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    state: "stopping",
    sourceEvent: "stop",
    seq: 1,
  });
  manager.pushChannelEvent(channel, "user_stopped", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 2,
  });
  const stateEvents = listEvents(client, "channel_state");
  assert.equal(
    stateEvents.some((item) => item?.data?.state === "stopping"),
    true,
  );
  assert.equal(
    stateEvents.some((item) => item?.data?.state === "user_stopped"),
    false,
  );
});

test("startOrJoinChannel restarts running channel when upstream socket is not open", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-stale" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-stale",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = { readyState: 3, close() {} };

  let closeCount = 0;
  let connectCount = 0;
  manager.closeUpstreamChannel = (targetChannel) => {
    assert.equal(targetChannel, channel);
    closeCount += 1;
    targetChannel.upstreamSocket = null;
  };
  manager.connectUpstreamChannel = (targetChannel, apiKey) => {
    assert.equal(targetChannel, channel);
    assert.equal(apiKey, "api-key-1");
    connectCount += 1;
    targetChannel.status = "connecting";
    targetChannel.upstreamSocket = { readyState: 0 };
  };

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.startOrJoinChannel({
    socket: client,
    connectionApiKey: "api-key-1",
    payload: { identity: { sessionId: "session-stale" }, commandType: "turn.send" },
  });

  assert.equal(closeCount, 1);
  assert.equal(connectCount, 1);
  assert.equal(channel.startPayload?.identity?.sessionId, "session-stale");
  assert.equal(channel.eventLog.length, 0);
});

test("startOrJoinChannel keeps running channel when upstream socket is open", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-live" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-live",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = { readyState: 1, close() {} };

  let connectCount = 0;
  manager.connectUpstreamChannel = () => {
    connectCount += 1;
  };

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.startOrJoinChannel({
    socket: client,
    connectionApiKey: "api-key-1",
    payload: { identity: { sessionId: "session-live" }, commandType: "turn.send" },
  });

  assert.equal(connectCount, 0);
  assert.equal(channel.upstreamSocket.readyState, 1);
});

test("forwarded stop does not synthesize stopping before Service confirms it", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-stop" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-stop",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const upstreamMessages = [];
  channel.upstreamSocket = {
    readyState: 1,
    send(raw) {
      upstreamMessages.push(JSON.parse(String(raw || "{}")));
    },
  };

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);

  const forwarded = manager.forwardToUpstream(
    channel,
    createTurnStopCommand({
      commandId: "stop:turn-stop",
      identity: {
        sessionId: "session-stop",
        dialogProcessId: "dp-stop",
        turnScopeId: "turn-stop",
      },
      concurrency: { expectedTurnRevision: 1 },
      stop: {},
    }),
  );
  assert.equal(forwarded, true);

  assert.equal(upstreamMessages.length, 1);
  assert.equal(channel.status, "running");
  const reconnectClient = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(reconnectClient, { currentSessionId: "session-stop" });

  const reconnectData = getEvent(reconnectClient, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (entry) => String(entry?.sessionId || "") === "session-stop",
  );
  assert.ok(sessionEntry);
  assert.equal("hasRunningTask" in sessionEntry, false);
  assert.equal("conversationStates" in sessionEntry, false);

  const stoppedEnvelope = manager.pushChannelEvent(channel, "user_stopped", {
    sessionId: "session-stop",
    dialogProcessId: "dp-stop",
    turnScopeId: "turn-stop",
    message: "user stop persisted",
  });
  manager.broadcastChannelEvent(channel, stoppedEnvelope);

  const completedReconnectClient = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(completedReconnectClient, { currentSessionId: "session-stop" });
  const completedReconnectData = getEvent(completedReconnectClient, "reconnect_data");
  const completedSessionEntry = (completedReconnectData?.data?.sessions || []).find(
    (entry) => String(entry?.sessionId || "") === "session-stop",
  );
  assert.equal("hasRunningTask" in completedSessionEntry, false);
  assert.equal("conversationStates" in completedSessionEntry, false);
});

test("forwardToUpstream reports a closed upstream without throwing", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-closed-upstream" }),
    { identity: { sessionId: "session-closed-upstream" } },
  );
  channel.ownerUserId = "user-1";

  assert.doesNotThrow(() => {
    assert.equal(
      manager.forwardToUpstream(
        channel,
        createTurnStopCommand({
          commandId: "stop:closed-upstream",
          identity: {
            sessionId: "session-closed-upstream",
            turnScopeId: "turn-closed-upstream",
          },
          concurrency: { expectedTurnRevision: 1 },
          stop: {},
        }),
      ),
      false,
    );
  });
});

test("upstream close without authoritative event does not synthesize a turn terminal", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-upstream-close" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-upstream-close",
    turnScopeId: "turn-upstream-close",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  upstream.close(1006, "network_lost");

  assert.equal(channel.transport.phase, "idle");
  assert.equal(channel.retention.phase, "active");
  assert.equal(channel.retention.terminalStatus, "");
  assert.equal(listEvents(client, "user_stopped").length, 0);
  assert.equal(listEvents(client, "error").length, 0);
});

test("successful upstream messages bypass session logs and retain data-plane metrics", () => {
  FakeUpstreamWebSocket.instances = [];
  const records = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket, {
    sessionLogClient: { log: (apiKey, event) => records.push({ apiKey, event }) },
  });
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-upstream-content" }),
    { userId: "user-1", sessionId: "session-upstream-content" },
  );
  channel.apiKey = "api-key-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);

  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  records.length = 0;
  upstream.emit(
    "message",
    JSON.stringify({
      event: "message_event",
      data: canonicalMessageEvent({
        sessionId: "session-upstream-content",
        eventType: MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT,
        text: "authoritative result",
      }),
    }),
  );

  assert.equal(records.length, 0);
  assert.equal(client.sentEvents.at(-1)?.event, "message_event");
  const windowStartedAtMs = manager.successfulDataPlaneMetrics.windowStartedAtMs;
  assert.deepEqual(manager.drainSuccessfulDataPlaneMetrics(200), {
    windowStartedAtMs,
    windowEndedAtMs: 200,
    upstreamMessages: 1,
    channelEvents: 1,
    broadcasts: 1,
    deliveries: 1,
    lifecycleReceipts: 0,
  });
});

test("authoritative lifecycle is the only live business-state protocol emitted by the proxy", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const sessionId = "session-lifecycle-live";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];
  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");

  const terminalPayload = {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventId: "terminal-live-1",
    commandId: "terminal-live-command",
    eventType: "turn.completed",
    sessionId,
    turnScopeId: "turn-lifecycle-live",
    dialogProcessId: "dialog-lifecycle-live",
    messageId: "message-lifecycle-live",
    presentationMessageId: "message-lifecycle-live",
    revision: 4,
    sequence: 4,
    state: "completed",
    phase: "completion",
    completionCommitId: "terminal-live-command",
    summaryVersion: 4,
  };
  const terminal = authoritativeLifecycle(terminalPayload);
  upstream.emit("message", JSON.stringify({ event: "turn_lifecycle", data: terminal }));

  assert.deepEqual(
    listEvents(client, "turn_lifecycle").map((item) => item.data),
    [JSON.parse(JSON.stringify(terminal))],
  );
  assert.equal(listEvents(client, "channel_state").length, 0);
  assert.equal(
    channel.conversationStateByDialogProcessId.get("dialog-lifecycle-live")?.state,
    "completed",
  );
});

test("upstream close reason user_stopped is transport metadata, not confirmation", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-user-close" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-user-close",
    turnScopeId: "turn-user-close",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  upstream.close(1000, "user_stopped");

  assert.equal(channel.transport.phase, "idle");
  assert.equal(channel.retention.phase, "active");
  assert.equal(channel.retention.terminalStatus, "");
  assert.equal(listEvents(client, "error").length, 0);
  assert.equal(listEvents(client, "user_stopped").length, 0);
});
