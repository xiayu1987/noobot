import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../src/channel-manager.js";
import { createChannelKey } from "../src/utils.js";

function createMockSocket() {
  return {
    readyState: 1,
    sentEvents: [],
    __agentProxyChannelKeys: new Set(),
    __agentProxyApiKey: "api-key-1",
    __agentProxyUserId: "user-1",
    send(raw) {
      this.sentEvents.push(JSON.parse(String(raw || "{}")));
    },
  };
}

function getReconnectDataEvent(socket) {
  return socket.sentEvents.find((eventItem) => eventItem?.event === "reconnect_data");
}

function getReconnectCompleteEvent(socket) {
  return socket.sentEvents.find((eventItem) => eventItem?.event === "reconnect_complete");
}

function listReplayMessages(reconnectDataEvent) {
  const sessions = Array.isArray(reconnectDataEvent?.data?.sessions)
    ? reconnectDataEvent.data.sessions
    : [];
  return sessions.flatMap((sessionEntry) =>
    (Array.isArray(sessionEntry?.dialogProcesses) ? sessionEntry.dialogProcesses : []).flatMap(
      (dialogProcess) => (Array.isArray(dialogProcess?.messages) ? dialogProcess.messages : []),
    ),
  );
}

test("reconnect should not replay resolved interaction_request", () => {
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
    requestId: "req-resolved",
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 2,
  });

  // simulate interaction_response already forwarded upstream
  channel.pendingInteractionRequests.delete("req-resolved");
  manager.requestChannelMap.delete("req-resolved");

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);

  manager.handleReconnect(socket, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 0 },
  });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  assert.ok(reconnectDataEvent, "should send reconnect_data event");
  const replayMessages = listReplayMessages(reconnectDataEvent);
  assert.equal(
    replayMessages.some(
      (envelope) =>
        String(envelope?.event || "") === "interaction_request" &&
        String(envelope?.data?.requestId || "") === "req-resolved",
    ),
    false,
  );
});

test("reconnect should replay unresolved interaction_request with pending marker", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-pending",
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 2,
  });

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);

  manager.handleReconnect(socket, {
    currentSessionId: "session-1",
    // client has already received seq=2, reconnect should still resend pending request
    lastReceivedSeqMap: { "dp-1": 2 },
  });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  assert.ok(reconnectDataEvent, "should send reconnect_data event");
  const replayMessages = listReplayMessages(reconnectDataEvent);
  const pendingInteractionEnvelope = replayMessages.find(
    (envelope) =>
      String(envelope?.event || "") === "interaction_request" &&
      String(envelope?.data?.requestId || "") === "req-pending",
  );
  assert.ok(pendingInteractionEnvelope, "should replay unresolved interaction request");
  assert.equal(pendingInteractionEnvelope?.data?.__agentProxyPendingInteraction, true);
});

test("reconnect_data replay messages should include channel sessionId", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  const envelope = manager.pushChannelEvent(channel, "thinking", {
    dialogProcessId: "dp-1",
    seq: 1,
  });

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);

  manager.handleReconnect(socket, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 0 },
  });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  assert.ok(reconnectDataEvent, "should send reconnect_data event");
  const replayMessages = listReplayMessages(reconnectDataEvent);
  assert.equal(replayMessages[0]?.data?.sessionId, "session-1");
  assert.equal(envelope?.data?.sessionId, undefined);
});

test("reconnect should replay only events with seq greater than lastReceivedSeq", () => {
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
    text: "old",
  });
  manager.pushChannelEvent(channel, "delta", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 2,
    text: "new-1",
  });
  manager.pushChannelEvent(channel, "done", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 3,
  });

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);

  manager.handleReconnect(socket, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 1 },
  });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  assert.ok(reconnectDataEvent, "should send reconnect_data event");
  const replayMessages = listReplayMessages(reconnectDataEvent);
  const replaySeqList = replayMessages.map((envelope) => Number(envelope?.data?.seq || 0));
  assert.deepEqual(replaySeqList, [2, 3]);
});

test("reconnect should mark cacheExpired when client seq exists but replay cache has no newer events", () => {
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

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);

  manager.handleReconnect(socket, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 1 },
  });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  assert.ok(reconnectDataEvent, "should send reconnect_data event");
  assert.equal(reconnectDataEvent?.data?.cacheExpired, true);
  assert.deepEqual(reconnectDataEvent?.data?.expiredDialogProcessIds, ["dp-1"]);

  const reconnectCompleteEvent = getReconnectCompleteEvent(socket);
  assert.ok(reconnectCompleteEvent, "should send reconnect_complete event");
  assert.equal(reconnectCompleteEvent?.data?.cacheExpired, true);
});

test("reconnect should skip terminal channel replay when lastReceivedSeq is 0", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "done";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, "done", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 1,
  });

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);

  manager.handleReconnect(socket, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 0 },
  });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  assert.ok(reconnectDataEvent, "should send reconnect_data event");
  const sessionList = Array.isArray(reconnectDataEvent?.data?.sessions)
    ? reconnectDataEvent.data.sessions
    : [];
  assert.equal(sessionList.length, 1);
  assert.deepEqual(sessionList[0]?.dialogProcesses || [], []);
});

test("reconnect should not replay a terminal error from a failed attempt", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-retry" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-retry",
    turnScopeId: "turn-failed",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, "thinking", {
    sessionId: "session-retry",
    dialogProcessId: "dp-failed",
    turnScopeId: "turn-failed",
    seq: 35,
  });
  manager.pushChannelEvent(channel, "error", {
    sessionId: "session-retry",
    dialogProcessId: "dp-failed",
    turnScopeId: "turn-failed",
    seq: 36,
    error: "failed attempt",
  });
  channel.status = "error";

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);
  manager.handleReconnect(socket, {
    currentSessionId: "session-retry",
    lastReceivedSeqMap: { "dp-failed": 35 },
  });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  const replayMessages = listReplayMessages(reconnectDataEvent);
  assert.equal(replayMessages.some((envelope) => envelope?.event === "error"), false);
});
