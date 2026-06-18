import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../src/channel-manager.js";
import { createChannelKey } from "../src/utils.js";

function createMockSocket({ apiKey = "api-key-1", userId = "user-1" } = {}) {
  return {
    readyState: 1,
    sentEvents: [],
    __agentProxyChannelKeys: new Set(),
    __agentProxyApiKey: apiKey,
    __agentProxyUserId: userId,
    send(raw) {
      this.sentEvents.push(JSON.parse(String(raw || "{}")));
    },
  };
}

function getEvent(socket, eventName) {
  return socket.sentEvents.find((eventItem) => eventItem?.event === eventName) || null;
}

function listEvents(socket, eventName) {
  return socket.sentEvents.filter((eventItem) => eventItem?.event === eventName);
}

function sortReconnectSessions(payload = {}) {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  return sessions
    .map((sessionEntry) => ({
      sessionId: String(sessionEntry?.sessionId || ""),
      hasRunningTask: Boolean(sessionEntry?.hasRunningTask),
      dialogProcesses: (Array.isArray(sessionEntry?.dialogProcesses)
        ? sessionEntry.dialogProcesses
        : []
      )
        .map((dialogProcess) => ({
          dialogProcessId: String(dialogProcess?.dialogProcessId || ""),
          messages: (Array.isArray(dialogProcess?.messages) ? dialogProcess.messages : []).map(
            (envelope) => ({
              event: String(envelope?.event || ""),
              seq: Number(envelope?.data?.seq || 0),
              requestId: String(envelope?.data?.requestId || ""),
              pending: envelope?.data?.__agentProxyPendingInteraction === true,
            }),
          ),
        }))
        .sort((left, right) => left.dialogProcessId.localeCompare(right.dialogProcessId)),
    }))
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

test("reconnect state should be consistent for all same-user clients across channel statuses", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const statusMatrix = [
    { status: "idle", hasRunningTask: false },
    { status: "connecting", hasRunningTask: true },
    { status: "running", hasRunningTask: true },
    { status: "done", hasRunningTask: false },
    { status: "stopped", hasRunningTask: false },
    { status: "error", hasRunningTask: false },
  ];

  for (const item of statusMatrix) {
    const sessionId = `session-${item.status}`;
    const dpId = `dp-${item.status}`;
    const channelKey = createChannelKey({ userId: "user-1", sessionId });
    const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId });
    channel.status = item.status;
    channel.ownerApiKey = "api-key-1";
    channel.ownerUserId = "user-1";
    manager.pushChannelEvent(channel, "thinking", {
      sessionId,
      dialogProcessId: dpId,
      seq: 1,
      text: item.status,
    });
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
    if (["done", "stopped", "error"].includes(item.status)) {
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
    if (["done", "stopped", "error"].includes(item.status)) {
      assert.equal(stateList.some((stateItem) => stateItem?.state === "sending"), true);
    }
  }
});

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

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-1",
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 2,
  });

  const clientA = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const clientB = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });

  manager.handleReconnect(clientA, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 2 },
  });
  manager.handleReconnect(clientB, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 2 },
  });

  const beforeResolveA = JSON.stringify(getEvent(clientA, "reconnect_data")?.data || {});
  const beforeResolveB = JSON.stringify(getEvent(clientB, "reconnect_data")?.data || {});
  assert.equal(beforeResolveA.includes("__agentProxyPendingInteraction"), true);
  assert.equal(beforeResolveB.includes("__agentProxyPendingInteraction"), true);

  const forwarded = manager.forwardToUpstream(channel, {
    action: "interaction_response",
    requestId: "req-1",
    response: { confirmed: true },
  });
  assert.equal(forwarded, true, "interaction_response should be forwarded");

  const clientBAfterResolve = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });
  manager.handleReconnect(clientBAfterResolve, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 2 },
  });
  const afterResolve = JSON.stringify(
    getEvent(clientBAfterResolve, "reconnect_data")?.data || {},
  );
  assert.equal(
    afterResolve.includes("__agentProxyPendingInteraction"),
    false,
    "resolved interaction should not be replayed to any client",
  );
});

test("interaction_pending channel_state should carry pendingInteractions snapshot", () => {
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

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-a",
    sessionId: "session-snapshot",
    dialogProcessId: "dp-snapshot",
    seq: 2,
    content: "first",
  });
  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-b",
    sessionId: "session-snapshot",
    dialogProcessId: "dp-snapshot",
    seq: 3,
    content: "second",
  });

  const stateEvents = listEvents(client, "channel_state");
  assert.equal(stateEvents.length, 2);
  const latestState = stateEvents.at(-1);
  assert.equal(latestState?.data?.state, "interaction_pending");
  assert.equal(latestState?.data?.pendingInteraction?.requestId, "req-a");
  assert.deepEqual(
    latestState?.data?.pendingInteractions?.map((item) => item.requestId),
    ["req-a", "req-b"],
  );
  assert.deepEqual(latestState?.data?.pendingRequestIds, ["req-a", "req-b"]);
});

test("resolving one concurrent interaction keeps channel_state interaction_pending for remaining requests", () => {
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

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-a",
    sessionId: "session-concurrent",
    dialogProcessId: "dp-concurrent",
    seq: 2,
  });
  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-b",
    sessionId: "session-concurrent",
    dialogProcessId: "dp-concurrent",
    seq: 3,
  });
  const forwarded = manager.forwardToUpstream(channel, {
    action: "interaction_response",
    requestId: "req-a",
    response: { confirmed: true },
  });

  assert.equal(forwarded, true);
  const latestState = listEvents(client, "channel_state").at(-1);
  assert.equal(latestState?.data?.state, "interaction_pending");
  assert.equal(latestState?.data?.requestId, "req-a");
  assert.deepEqual(
    latestState?.data?.pendingInteractions?.map((item) => item.requestId),
    ["req-b"],
  );
  assert.equal(channel.pendingInteractionRequests.has("req-a"), false);
  assert.equal(channel.pendingInteractionRequests.has("req-b"), true);
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
});

test("reconnect should emit reconnecting/expired conversation states when applicable", () => {
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
  assert.equal(stateList.some((stateItem) => stateItem?.state === "reconnecting"), true);
  assert.equal(stateList.some((stateItem) => stateItem?.state === "expired"), true);
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
  manager.pushChannelEvent(channel, "stopped", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 2,
  });
  const stateEvents = listEvents(client, "channel_state");
  assert.equal(stateEvents.some((item) => item?.data?.state === "stopping"), true);
  assert.equal(stateEvents.some((item) => item?.data?.state === "stopped"), true);
});

test("channel_state snapshot should carry pendingInteraction payload for interaction_pending", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-snapshot",
    sessionId: "session-1",
    dialogProcessId: "dp-snapshot",
    interactionType: "confirm",
    content: "confirm snapshot",
    seq: 8,
  });

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  const stateEvents = listEvents(client, "channel_state");
  const interactionPendingState = stateEvents.find(
    (eventItem) => eventItem?.data?.state === "interaction_pending",
  );
  assert.ok(interactionPendingState);
  assert.equal(
    String(interactionPendingState?.data?.pendingInteraction?.requestId || ""),
    "req-snapshot",
  );
  assert.equal(
    String(interactionPendingState?.data?.pendingInteraction?.dialogProcessId || ""),
    "dp-snapshot",
  );
});

test("newly attached subscriber should receive no_conversation snapshot state", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-init" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-init",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  const stateEvents = listEvents(client, "channel_state");
  assert.equal(stateEvents.some((item) => item?.data?.state === "no_conversation"), true);
});

test("detachSocketFromAllChannels should detach terminal subscribers and schedule cleanup", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-detach" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-detach",
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.attachSubscriber(channel, client);
  channel.status = "done";
  const beforeDetachMs = Date.now();

  assert.doesNotThrow(() => manager.detachSocketFromAllChannels(client));
  assert.equal(channel.subscribers.has(client), false);
  assert.equal(client.__agentProxyChannelKeys.size, 0);
  assert.equal(client.__agentProxyActiveChannelKey, "");
  assert.deepEqual(client.__agentProxyLastSequenceByChannel, {});
  assert.equal(channel.cleanupAfterMs >= beforeDetachMs, true);
});

test("interaction_response should resolve channel by pending requestId", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-resolve" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-resolve",
  });

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-resolve",
    sessionId: "session-resolve",
    dialogProcessId: "dp-resolve",
    seq: 1,
  });

  const resolvedChannel = manager.resolveChannelFromSocketMessage(
    createMockSocket({ apiKey: "api-key-2", userId: "user-1" }),
    {
      action: "interaction_response",
      requestId: "req-resolve",
    },
  );

  assert.equal(resolvedChannel, channel);
});

test("cleanup should remove expired terminal channel and stale request mapping", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-cleanup" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-cleanup",
  });
  const closed = [];
  channel.upstreamSocket = {
    close(code, reason) {
      closed.push({ code, reason });
    },
  };

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-cleanup",
    sessionId: "session-cleanup",
    dialogProcessId: "dp-cleanup",
    seq: 1,
  });
  channel.status = "done";
  channel.cleanupAfterMs = Date.now() - 1;

  manager.cleanupExpiredChannels();

  assert.equal(manager.hasChannel(channelKey), false);
  assert.equal(manager.requestChannelMap.has("req-cleanup"), false);
  assert.deepEqual(closed, [{ code: 1000, reason: "cleanup" }]);
});

test("cleanup should remove expired idle channel without subscribers", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-idle-cleanup" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-idle-cleanup",
  });
  const closed = [];
  channel.upstreamSocket = {
    close(code, reason) {
      closed.push({ code, reason });
    },
  };

  channel.status = "idle";
  channel.updatedAtMs = 1;

  manager.cleanupExpiredChannels();

  assert.equal(manager.hasChannel(channelKey), false);
  assert.deepEqual(closed, [{ code: 1000, reason: "cleanup" }]);
});
