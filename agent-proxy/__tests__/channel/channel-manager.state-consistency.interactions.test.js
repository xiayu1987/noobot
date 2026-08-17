/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { createChannelKey } from "../../src/shared/utils.js";
import { createMockSocket, getEvent, listEvents } from "./channel-manager.state-consistency.test-helpers.js";
import { TURN_EVENT } from "@noobot/session-protocol";
import { createInteractionResponseCommand } from "@noobot/agent-transport-protocol";
import {
  createEventEnvelope,
  EVENT_FAMILY,
  INTERACTION_EVENT_TYPE,
  INTERACTION_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol";
import { authoritativeLifecycle } from "./channel-manager.state-consistency.reconnect.fixtures.js";

function interactionRequest({
  requestId,
  sessionId,
  turnScopeId,
  sequence = 1,
  ...payload
}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.INTERACTION_REQUEST,
    identity: {
      eventId: `interaction-event:${requestId}:${sequence}`,
      eventType: INTERACTION_EVENT_TYPE.REQUEST,
      sessionId,
      turnScopeId,
    },
    causality: {},
    ordering: {
      domain: INTERACTION_SEQUENCE_DOMAIN,
      scopeId: requestId,
      sequence,
    },
    producer: { type: "test", id: "agent-proxy-interaction-test" },
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { requestId, ...payload },
  });
}

const hasPendingRequest = (replayBatch, requestId) =>
  replayBatch?.pendingInteractions?.some((item) => item?.payload?.requestId === requestId) === true;

function interactionResponse({ sessionId, requestId, response = { confirmed: true } }) {
  return createInteractionResponseCommand({
    commandId: `interaction:${requestId}`,
    identity: { sessionId },
    interaction: { requestId, response },
  });
}

test("interaction_request resolved by one client should be consistent across all clients", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = {
    readyState: 1,
    sent: [],
    send(raw) {
      this.sent.push(String(raw || ""));
    },
  };

  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-1",
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    sequence: 2,
    content: "confirm",
  }));

  const clientA = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const clientB = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });

  manager.handleReconnect(clientA, {
    currentSessionId: "session-1",
  });
  manager.handleReconnect(clientB, {
    currentSessionId: "session-1",
  });

  const beforeResolveA = JSON.stringify(getEvent(clientA, "reconnect_data")?.data || {});
  const beforeResolveB = JSON.stringify(getEvent(clientB, "reconnect_data")?.data || {});
  assert.equal(beforeResolveA.includes("__agentProxyPendingInteraction"), false);
  assert.equal(beforeResolveB.includes("__agentProxyPendingInteraction"), false);
  for (const data of [getEvent(clientA, "reconnect_data")?.data, getEvent(clientB, "reconnect_data")?.data]) {
    assert.equal(hasPendingRequest(data?.sessions?.[0]?.replayBatch, "req-1"), true);
  }

  const forwarded = manager.forwardToUpstream(channel, interactionResponse({
    sessionId: "session-1",
    requestId: "req-1",
  }));
  assert.equal(forwarded, true, "interaction_response should be forwarded");

  const clientBAfterResolve = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });
  manager.handleReconnect(clientBAfterResolve, {
    currentSessionId: "session-1",
  });
  const afterResolve = JSON.stringify(
    getEvent(clientBAfterResolve, "reconnect_data")?.data || {},
  );
  assert.equal(
    afterResolve.includes("__agentProxyPendingInteraction"),
    false,
    "resolved interaction should not be replayed to any client",
  );
  const resolvedSession = getEvent(clientBAfterResolve, "reconnect_data")?.data?.sessions?.[0];
  assert.equal(hasPendingRequest(resolvedSession?.replayBatch, "req-1"), false);
  assert.equal("conversationStates" in resolvedSession, false);
});

test("interaction_pending channel_state carries state only; interaction events own request payloads", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-snapshot" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-snapshot",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-a",
    sessionId: "session-snapshot",
    dialogProcessId: "dp-snapshot",
    turnScopeId: "turn-snapshot",
    sequence: 2,
    content: "first",
  }));
  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-b",
    sessionId: "session-snapshot",
    dialogProcessId: "dp-snapshot",
    turnScopeId: "turn-snapshot",
    sequence: 3,
    content: "second",
  }));

  const stateEvents = listEvents(client, "channel_state");
  assert.equal(stateEvents.length, 2);
  const latestState = stateEvents.at(-1);
  assert.equal(latestState?.data?.state, "interaction_pending");
  assert.equal("pendingInteraction" in latestState.data, false);
  assert.equal("pendingInteractions" in latestState.data, false);
  assert.equal("pendingRequestIds" in latestState.data, false);
  assert.deepEqual([...channel.pendingInteractionRequests.keys()], ["req-a", "req-b"]);
});

test("failed interaction lifecycle closes the pending request across proxy and reconnect", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-timeout" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-timeout" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-timeout",
    sessionId: "session-timeout",
    dialogProcessId: "dp-timeout",
    turnScopeId: "turn-timeout",
    content: "confirm",
  }));
  assert.equal(channel.pendingInteractionRequests.has("req-timeout"), true);

  const terminal = manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-timeout",
    sessionId: "session-timeout",
    dialogProcessId: "dp-timeout",
    turnScopeId: "turn-timeout",
    content: "confirm",
    lifecycle: "failed",
    resolvedBy: "system",
    interactionData: { reason: "timeout" },
    sequence: 2,
  }));
  assert.ok(terminal);
  assert.equal(channel.pendingInteractionRequests.has("req-timeout"), false);
  assert.equal(channel.conversationStateByDialogProcessId.get("dp-timeout")?.state, "sending");

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, { currentSessionId: "session-timeout" });
  const replay = getEvent(client, "reconnect_data")?.data?.sessions?.[0]?.replayBatch;
  assert.equal(hasPendingRequest(replay, "req-timeout"), false);
});

test("resolving one concurrent interaction atomically publishes the remaining pending snapshot", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-concurrent" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-concurrent",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = {
    readyState: 1,
    sent: [],
    send(raw) {
      this.sent.push(String(raw || ""));
    },
  };
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-a",
    sessionId: "session-concurrent",
    dialogProcessId: "dp-concurrent",
    turnScopeId: "turn-concurrent",
    sequence: 2,
    content: "first concurrent confirmation",
  }));
  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-b",
    sessionId: "session-concurrent",
    dialogProcessId: "dp-concurrent",
    turnScopeId: "turn-concurrent",
    sequence: 3,
    content: "second concurrent confirmation",
  }));
  const stateEventsBeforeResponse = listEvents(client, "channel_state").length;
  const forwarded = manager.forwardToUpstream(channel, interactionResponse({
    sessionId: "session-concurrent",
    requestId: "req-a",
  }));

  assert.equal(forwarded, true);
  const stateEventsAfterResponse = listEvents(client, "channel_state");
  assert.equal(stateEventsAfterResponse.length, stateEventsBeforeResponse + 1);
  const latestState = stateEventsAfterResponse.at(-1);
  assert.equal(latestState?.data?.state, "interaction_pending");
  assert.equal(latestState?.data?.sourceEvent, "interaction.response");
  assert.equal("pendingRequestIds" in latestState.data, false);
  assert.equal("pendingInteraction" in latestState.data, false);
  assert.equal(channel.pendingInteractionRequests.has("req-a"), false);
  assert.equal(channel.pendingInteractionRequests.has("req-b"), true);
});

test("channel_state snapshot never duplicates the pending interaction payload", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-snapshot",
    sessionId: "session-1",
    dialogProcessId: "dp-snapshot",
    turnScopeId: "turn-snapshot",
    interactionType: "confirm",
    content: "confirm snapshot",
    sequence: 8,
  }));

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  const stateEvents = listEvents(client, "channel_state");
  const interactionPendingState = stateEvents.find(
    (eventItem) => eventItem?.data?.state === "interaction_pending",
  );
  assert.ok(interactionPendingState);
  assert.equal("pendingInteraction" in interactionPendingState.data, false);
  assert.equal("pendingInteractions" in interactionPendingState.data, false);
});

test("workflow child terminal events cannot discard a pending interaction owned by the root channel", async () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "root-session" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "root-session",
    turnScopeId: "root-turn",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-child",
    sessionId: "child-session",
    parentSessionId: "root-session",
    dialogProcessId: "child-dialog",
    turnScopeId: "root-turn",
    content: "confirm child action",
    sequence: 49,
  }));
  manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    eventId: "sibling-terminal",
    eventType: TURN_EVENT.COMPLETED,
    sessionId: "sibling-session",
    parentSessionId: "root-session",
    dialogProcessId: "sibling-dialog",
    turnScopeId: "workflow-node-turn",
    sequence: 50,
    revision: 1,
  }));

  assert.equal(channel.retention.phase, "active");
  assert.equal(channel.activity.phase, "running");
  assert.equal(channel.pendingInteractionRequests.has("req-child"), true);

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  await manager.handleReconnect(client, {
    currentSessionId: "root-session",
    currentTurnScopeId: "root-turn",
  });

  const reconnectData = getEvent(client, "reconnect_data");
  const rootSession = reconnectData?.data?.sessions?.find(
    (item) => item?.sessionId === "root-session",
  );
  const childInteraction = rootSession?.replayBatch?.pendingInteractions?.find(
    (item) => item?.payload?.requestId === "req-child",
  );
  assert.equal(childInteraction?.payload?.dialogProcessId, "child-dialog");
  assert.equal("conversationStates" in rootSession, false);
});

test("workflow child terminal state does not own root channel retention", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "root-session" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "root-session",
  });
  channel.status = "running";

  manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    eventId: "child-terminal",
    eventType: TURN_EVENT.COMPLETED,
    sessionId: "child-session",
    parentSessionId: "root-session",
    dialogProcessId: "child-dialog",
    turnScopeId: "child-turn",
    sequence: 10,
    revision: 1,
  }));

  assert.equal(channel.activity.phase, "running");
  assert.equal(channel.retention.phase, "active");
  assert.equal(channel.conversationStateByDialogProcessId.get("child-dialog")?.state, "completed");
});

test("authoritative terminal lifecycle closes pending interactions for the same turn", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId: "session-terminal" }), {
    userId: "user-1", sessionId: "session-terminal",
  });
  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-terminal",
    sessionId: "session-terminal",
    dialogProcessId: "dp-terminal",
    turnScopeId: "turn-terminal",
    interactionType: "confirm",
    content: "confirm",
    sequence: 2,
  }));
  manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    eventId: "terminal-1",
    eventType: "turn.completed",
    sessionId: "session-terminal",
    turnScopeId: "turn-terminal",
    dialogProcessId: "dp-terminal",
    messageId: "message-terminal",
    presentationMessageId: "message-terminal",
    revision: 3,
    sequence: 3,
    phase: "completion",
    state: "completed",
    action: "send",
    executionState: "completed",
    summaryVersion: 1,
    completionCommitId: "terminal-commit",
    capabilities: { actionLocked: false, canStop: false },
  }));
  assert.equal(channel.pendingInteractionRequests.has("req-terminal"), false);
  assert.equal(manager.requestChannelMap.has("req-terminal"), false);
});

test("invalid interaction_request has no journal, route, pending, or state side effects", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId: "session-invalid" }), {
    userId: "user-1",
    sessionId: "session-invalid",
  });
  const result = manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-invalid",
    sessionId: "session-invalid",
    dialogProcessId: "dp-invalid",
    turnScopeId: "turn-invalid",
  }));
  assert.equal(result, null);
  assert.equal(channel.eventJournal.events.length, 0);
  assert.equal(channel.pendingInteractionRequests.has("req-invalid"), false);
  assert.equal(manager.requestChannelMap.has("req-invalid"), false);
  assert.equal(channel.conversationStateByDialogProcessId.has("dp-invalid"), false);
});

test("only an authoritative lifecycle envelope projects conversation state", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId: "session-authority" }), {
    userId: "user-1",
    sessionId: "session-authority",
  });
  manager.pushChannelEvent(channel, "turn_lifecycle", authoritativeLifecycle({
    eventId: "authority-1",
    eventType: "turn.processing_started",
    sessionId: "session-authority",
    turnScopeId: "turn-authority",
    dialogProcessId: "dp-authority",
    messageId: "message-authority",
    presentationMessageId: "message-authority",
    revision: 1,
    sequence: 1,
    state: "processing",
    phase: "processing",
  }));
  assert.equal(channel.conversationStateByDialogProcessId.get("dp-authority")?.state, "sending");
});

test("interaction_response should resolve channel by pending requestId", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-resolve" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-resolve",
  });

  manager.pushChannelEvent(channel, INTERACTION_EVENT_TYPE.REQUEST, interactionRequest({
    requestId: "req-resolve",
    sessionId: "session-resolve",
    dialogProcessId: "dp-resolve",
    turnScopeId: "turn-resolve",
    content: "confirm",
    sequence: 1,
  }));

  const resolvedChannel = manager.resolveChannelFromSocketMessage(
    createMockSocket({ apiKey: "api-key-2", userId: "user-1" }),
    interactionResponse({ sessionId: "session-resolve", requestId: "req-resolve" }),
  );

  assert.equal(resolvedChannel, channel);
});
