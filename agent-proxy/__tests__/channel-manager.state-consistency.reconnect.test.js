import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../src/channel-manager.js";
import { createChannelKey } from "../src/utils.js";
import { createMockSocket, getEvent, listEvents, sortReconnectSessions } from "./channel-manager.state-consistency.test-helpers.js";

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



test("reconnect subscriber snapshot must not emit stale no_conversation before running state", () => {
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
  assert.equal(firstState?.data?.state, "sending");
  assert.equal(firstState?.data?.turnScopeId, "turn-scope-snapshot-running");
  assert.equal(
    client.sentEvents.some(
      (eventItem) =>
        eventItem?.event === "channel_state" &&
        eventItem?.data?.state === "no_conversation",
    ),
    false,
  );
});

test("reconnect replaces initial no_conversation with sending for running channel before upstream events", () => {
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
  assert.equal(sessionEntry?.hasRunningTask, true);
  assert.deepEqual(sessionEntry?.currentRun, {
    sessionId: "session-running-empty",
    dialogProcessId: "",
    turnScopeId: "turn-scope-running",
    state: "sending",
    sourceEvent: "channel_status",
    seq: 0,
    createdAtMs: channel.createdAtMs,
    updatedAtMs: channel.updatedAtMs,
  });
  const stateList = Array.isArray(sessionEntry?.conversationStates)
    ? sessionEntry.conversationStates
    : [];
  assert.equal(stateList.some((stateItem) => stateItem?.state === "no_conversation"), false);
  assert.equal(
    stateList.some(
      (stateItem) =>
        stateItem?.state === "sending" &&
        String(stateItem?.turnScopeId || "") === "turn-scope-running",
    ),
    true,
  );
});


test("reconnect can recover same-user running channel when socket identity is not hydrated", () => {
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
  assert.equal(sessionEntry?.hasRunningTask, true);
  assert.equal(
    (sessionEntry?.conversationStates || []).some(
      (stateItem) =>
        stateItem?.state === "sending" &&
        String(stateItem?.turnScopeId || "") === "turn-scope-user-fallback",
    ),
    true,
  );
});

test("reconnect state should be consistent for all same-user clients across channel statuses", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const statusMatrix = [
    { status: "idle", hasRunningTask: false },
    { status: "connecting", hasRunningTask: true },
    { status: "running", hasRunningTask: true },
    { status: "done", hasRunningTask: false },
    { status: "user_stopped", hasRunningTask: false },
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

test("reconnect exposes the completed current run separately from historical stopped turns", () => {
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
  assert.equal(sessionEntry?.currentRun?.sessionId, "session-current-run");
  assert.equal(sessionEntry?.currentRun?.dialogProcessId, "dp-current");
  assert.equal(sessionEntry?.currentRun?.turnScopeId, "turn-current");
  assert.equal(sessionEntry?.currentRun?.state, "completed");
  assert.equal(sessionEntry?.currentRun?.seq, 20);
  assert.equal(
    (sessionEntry?.conversationStates || []).some(
      (item) => item?.state === "user_stopped" && item?.turnScopeId === "turn-old",
    ),
    true,
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

