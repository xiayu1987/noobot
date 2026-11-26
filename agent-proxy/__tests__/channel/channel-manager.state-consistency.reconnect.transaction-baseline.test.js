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
  createMockSocket,
  canonicalMessageEvent,
  FakeUpstreamWebSocket,
  observeReconnectCommands,
  getEvent,
  reconnectControl,
  countPendingCommands,
  deliverPendingCommand,
  pendingCommand,
} from "./channel-manager.state-consistency.test-helpers.js";
import { PENDING_COMMAND_KIND } from "../../src/channel/command-registry.js";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { INTERACTION_EVENT_TYPE } from "@noobot/event-protocol";
import {
  AGENT_COMMAND,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandReceipt,
} from "@noobot/agent-transport-protocol";
import { TURN_EVENT, TURN_SNAPSHOT_WIRE_EVENT } from "@noobot/session-protocol";
import {
  authoritativeLifecycle,
  authoritativeSnapshot,
} from "./channel-manager.state-consistency.reconnect.fixtures.js";

test("lifecycle replay gap waits for the authoritative snapshot before reconnect completes", async () => {
  const forwarded = [];
  const manager = new ChannelManager(observeReconnectCommands(forwarded));
  const sessionId = "session-lifecycle-gap";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
  });
  manager.recordTurnLifecycleEnvelope(
    channel,
    authoritativeLifecycle({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "e3",
      sessionId,
      turnScopeId: "t1",
      revision: 3,
      sequence: 3,
    }),
  );
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  const reconnectPromise = manager.handleReconnect(
    client,
    reconnectControl({
      sessionId,
      knownLifecycleSequenceMap: { [sessionId]: 1 },
    }),
  );

  await Promise.resolve();
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].commandType, "turn.snapshot.get");
  assert.equal(forwarded[0].identity.sessionId, sessionId);
  assert.equal(forwarded[0].options.knownSequence, 1);
  assert.equal(countPendingCommands(manager, channel, PENDING_COMMAND_KIND.TURN_SNAPSHOT), 1);
  assert.equal(getEvent(client, "reconnect_data"), null);
  assert.equal(getEvent(client, "reconnect_complete"), null);

  const commandId = forwarded[0].commandId;
  deliverPendingCommand(manager, channel, commandId, PENDING_COMMAND_KIND.TURN_SNAPSHOT, {
    ok: true,
    snapshot: authoritativeSnapshot({
      commandId,
      sessionId,
      sequence: 3,
      activeTurnScopeId: "t1",
      activeTurn: {
        sessionId,
        turnScopeId: "t1",
        presentationMessageId: "message-1",
        dialogProcessId: "dialog-t1",
        continuedByTurnScopeId: "",
        revision: 3,
        sequence: 3,
        state: "processing",
        startedAt: "2026-08-17T00:00:00.000Z",
      },
      recentTerminalTurns: [],
      replacedTurns: [
        {
          turnScopeId: "turn-old",
          replacementDialogProcessId: "dialog-t1",
          replacementTurnScopeId: "t1",
          replacementUserMessageUid: "user-t1",
          commandId: "replace-turn-old",
          requestHash: "request-hash-turn-old",
          committedAggregateVersion: 4,
          replacedTurnScopeIds: ["turn-old"],
          sequence: 2,
          committedAt: "2026-08-02T10:00:00.000Z",
        },
      ],
      recovery: "none",
      unchanged: false,
    }),
  });
  await reconnectPromise;

  const reconnectData = getEvent(client, "reconnect_data");
  assert.deepEqual(Object.keys(reconnectData.data).sort(), ["identity", "requestId", "sessions"]);
  assert.equal(reconnectData.data.identity.sessionId, sessionId);
  assert.equal(getEvent(client, "reconnect_complete").data.requestId, reconnectData.data.requestId);
  const entry = reconnectData.data.sessions.find((item) => item.sessionId === sessionId);
  assert.equal("replayRequiresSnapshot" in entry, false);
  assert.deepEqual(entry.replayBatch.events, []);
  assert.equal(entry.replayBatch.snapshot.payload.commandId, commandId);
  assert.equal(entry.replayBatch.snapshotSequence, 3);
  assert.deepEqual(
    entry.replayBatch.snapshot.payload.replacedTurns.map((item) => item.turnScopeId),
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
  manager.pushChannelEvent(
    channel,
    INTERACTION_EVENT_TYPE.REQUEST,
    canonicalInteractionRequest({
      sessionId,
      dialogProcessId: "dp-baseline-order",
      turnScopeId: "turn-baseline-order",
      requestId: "request-baseline-order",
      sequence: 3,
    }),
  );
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.handleReconnect(client, reconnectControl({ sessionId }));

  const eventNames = client.sentEvents.map((item) => item.event);
  assert.ok(eventNames.indexOf("reconnect_data") >= 0);
  assert.ok(eventNames.indexOf("channel_state") > eventNames.indexOf("reconnect_data"));
  assert.ok(eventNames.indexOf("reconnect_complete") > eventNames.indexOf("channel_state"));
});

test("reconnect buffers live events until after the authoritative baseline", async () => {
  const forwarded = [];
  const manager = new ChannelManager(observeReconnectCommands(forwarded));
  const sessionId = "session-reconnect-live-buffer";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-reconnect-live-buffer",
  });
  manager.recordTurnLifecycleEnvelope(
    channel,
    authoritativeLifecycle({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "buffer-gap-3",
      sessionId,
      turnScopeId: "turn-reconnect-live-buffer",
      revision: 3,
      sequence: 3,
    }),
  );
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const reconnectPromise = manager.handleReconnect(
    client,
    reconnectControl({
      sessionId,
      knownLifecycleSequenceMap: { [sessionId]: 1 },
    }),
  );
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

  await Promise.resolve();
  const commandId = forwarded[0]?.commandId;
  deliverPendingCommand(manager, channel, commandId, PENDING_COMMAND_KIND.TURN_SNAPSHOT, {
    ok: true,
    snapshot: authoritativeSnapshot({
      commandId,
      sessionId,
      sequence: 3,
      activeTurnScopeId: "turn-reconnect-live-buffer",
      activeTurn: {
        sessionId,
        turnScopeId: "turn-reconnect-live-buffer",
        presentationMessageId: "message-reconnect-live-buffer",
        dialogProcessId: "dialog-reconnect-live-buffer",
        continuedByTurnScopeId: "",
        revision: 3,
        sequence: 3,
        state: "processing",
        startedAt: "2026-08-17T00:00:00.000Z",
      },
      recentTerminalTurns: [],
      recovery: "none",
      unchanged: false,
    }),
  });
  await reconnectPromise;

  const eventNames = client.sentEvents.map((item) => item.event);
  assert.ok(eventNames.indexOf(MESSAGE_EVENT_WIRE_EVENT) > eventNames.indexOf("reconnect_data"));
  assert.ok(
    eventNames.indexOf("reconnect_complete") > eventNames.indexOf(MESSAGE_EVENT_WIRE_EVENT),
  );
});

test("reconnect rejects the transaction when the authoritative snapshot is unavailable", async () => {
  const forwarded = [];
  const manager = new ChannelManager(observeReconnectCommands(forwarded));
  const sessionId = "session-reconnect-state-baseline";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-reconnect-state-baseline",
  });
  manager.recordTurnLifecycleEnvelope(
    channel,
    authoritativeLifecycle({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "state-baseline-gap-3",
      sessionId,
      turnScopeId: "turn-reconnect-state-baseline",
      revision: 3,
      sequence: 3,
    }),
  );
  manager.updateConversationState(channel, {
    sessionId,
    scope: "turn",
    turnScopeId: "turn-reconnect-state-baseline",
    dialogProcessId: "dp-reconnect-state-baseline",
    state: "sending",
    sourceEvent: "turn.processing",
    seq: 3,
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const reconnectPromise = manager.handleReconnect(
    client,
    reconnectControl({
      sessionId,
      knownLifecycleSequenceMap: { [sessionId]: 1 },
    }),
  );

  manager.updateConversationState(channel, {
    sessionId,
    scope: "turn",
    turnScopeId: "turn-reconnect-state-baseline",
    dialogProcessId: "dp-reconnect-state-baseline",
    state: "completed",
    sourceEvent: "turn.completed",
    seq: 4,
  });

  await Promise.resolve();
  deliverPendingCommand(
    manager,
    channel,
    forwarded[0]?.commandId,
    PENDING_COMMAND_KIND.TURN_SNAPSHOT,
    { ok: false, reason: "snapshot_unavailable" },
  );
  await assert.rejects(reconnectPromise, /authoritative_snapshot_failed/);
  assert.equal(getEvent(client, "reconnect_data"), null);
  assert.equal(getEvent(client, "reconnect_complete"), null);
  assert.deepEqual(
    client.sentEvents.filter((item) => item.event === "channel_state"),
    [],
  );
});

test("reconnect removes a channel whose Session is authoritatively deleted", async () => {
  const forwarded = [];
  const manager = new ChannelManager(observeReconnectCommands(forwarded));
  const sessionId = "session-deleted-before-reconnect";
  const channelKey = createChannelKey({ userId: "user-1", sessionId });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-deleted-before-reconnect",
  });
  manager.recordTurnLifecycleEnvelope(
    channel,
    authoritativeLifecycle({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "deleted-session-active-1",
      sessionId,
      turnScopeId: "turn-deleted-before-reconnect",
      revision: 3,
      sequence: 3,
    }),
  );
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  const reconnectPromise = manager.handleReconnect(
    client,
    reconnectControl({
      sessionId,
      knownLifecycleSequenceMap: { [sessionId]: 1 },
    }),
  );
  await Promise.resolve();
  deliverPendingCommand(
    manager,
    channel,
    forwarded[0]?.commandId,
    PENDING_COMMAND_KIND.TURN_SNAPSHOT,
    { ok: false, reason: "session_not_found" },
  );
  await reconnectPromise;

  assert.equal(manager.channelStore.has(channelKey), false);
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
  const forwarded = [];
  const manager = new ChannelManager(observeReconnectCommands(forwarded));
  const sessionId = "session-reconnect-superseded";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-reconnect-superseded",
  });
  manager.recordTurnLifecycleEnvelope(
    channel,
    authoritativeLifecycle({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "superseded-gap-3",
      sessionId,
      turnScopeId: "turn-reconnect-superseded",
      revision: 3,
      sequence: 3,
    }),
  );
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const staleReconnect = manager.handleReconnect(
    client,
    reconnectControl({
      sessionId,
      requestId: "reconnect-stale",
      knownLifecycleSequenceMap: { [sessionId]: 1 },
    }),
  );

  await Promise.resolve();
  const currentReconnect = manager.handleReconnect(
    client,
    reconnectControl({
      sessionId,
      requestId: "reconnect-current",
      knownLifecycleSequenceMap: { [sessionId]: 3 },
    }),
  );
  await Promise.resolve();
  assert.notEqual(forwarded[0]?.commandId, forwarded[1]?.commandId);
  assert.equal(
    Boolean(
      pendingCommand(manager, channel, forwarded[0]?.commandId, PENDING_COMMAND_KIND.TURN_SNAPSHOT),
    ),
    false,
  );
  const currentCommandId = forwarded[1]?.commandId;
  deliverPendingCommand(manager, channel, currentCommandId, PENDING_COMMAND_KIND.TURN_SNAPSHOT, {
    ok: true,
    snapshot: authoritativeSnapshot({
      commandId: currentCommandId,
      sessionId,
      sequence: 3,
      activeTurnScopeId: "turn-reconnect-superseded",
      activeTurn: {
        sessionId,
        turnScopeId: "turn-reconnect-superseded",
        presentationMessageId: "presentation-superseded-gap-3",
        dialogProcessId: "dialog-superseded-gap-3",
        continuedByTurnScopeId: "",
        revision: 3,
        sequence: 3,
        state: "processing",
        startedAt: "2026-08-17T00:00:00.000Z",
      },
      recentTerminalTurns: [],
      replacedTurns: [],
      recovery: "none",
      unchanged: false,
    }),
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

async function setupRecoveryReconnect(sessionId) {
  const forwarded = [];
  const manager = new ChannelManager(observeReconnectCommands(forwarded));
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
  });
  manager.recordTurnLifecycleEnvelope(
    channel,
    authoritativeLifecycle({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: `${sessionId}-gap-3`,
      sessionId,
      turnScopeId: ORPHAN_TURN_SCOPE_ID,
      revision: 3,
      sequence: 3,
    }),
  );
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const reconnectPromise = manager.handleReconnect(
    client,
    reconnectControl({
      sessionId,
      knownLifecycleSequenceMap: { [sessionId]: 1 },
    }),
  );
  await Promise.resolve();
  return { manager, channel, forwarded, client, reconnectPromise };
}

const ORPHAN_TURN_SCOPE_ID = "turn-orphan";

function processingOrphan(sessionId) {
  return {
    sessionId,
    turnScopeId: ORPHAN_TURN_SCOPE_ID,
    presentationMessageId: "message-orphan",
    dialogProcessId: "dialog-orphan",
    continuedByTurnScopeId: "",
    revision: 3,
    sequence: 3,
    state: "processing",
    startedAt: "2026-08-17T00:00:00.000Z",
  };
}

function replyToReconnectQuery(commandId, event, data) {
  const query = FakeUpstreamWebSocket.instances.findLast((socket) =>
    socket.sent.some((raw) => JSON.parse(raw).commandId === commandId),
  );
  assert.ok(query);
  query.emit("message", JSON.stringify({ event, data }));
}

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

test("an orphan-flagged snapshot is settled once via turn.finalize and the settled snapshot replaces it", async () => {
  const sessionId = "session-recovery-orphan";
  const { manager, channel, forwarded, client, reconnectPromise } =
    await setupRecoveryReconnect(sessionId);
  const snapshotCommandId = forwarded[0].commandId;
  replyToReconnectQuery(
    snapshotCommandId,
    TURN_SNAPSHOT_WIRE_EVENT,
    authoritativeSnapshot({
      commandId: snapshotCommandId,
      sessionId,
      sequence: 3,
      recovery: "orphan",
      unchanged: false,
      activeTurnScopeId: ORPHAN_TURN_SCOPE_ID,
      activeTurn: processingOrphan(sessionId),
    }),
  );
  await flushMicrotasks();

  assert.equal(forwarded.length, 2);
  assert.equal(forwarded[1].commandType, "turn.finalize");
  assert.equal(forwarded[1].identity.sessionId, sessionId);
  const finalizeCommandId = forwarded[1].commandId;
  assert.notEqual(finalizeCommandId, snapshotCommandId);
  assert.equal(getEvent(client, "reconnect_data"), null);

  replyToReconnectQuery(
    finalizeCommandId,
    TURN_SNAPSHOT_WIRE_EVENT,
    authoritativeSnapshot({
      commandId: finalizeCommandId,
      sessionId,
      sequence: 4,
      recovery: "none",
      unchanged: false,
      activeTurn: null,
      activeTurnScopeId: "",
    }),
  );
  await reconnectPromise;

  const entry = getEvent(client, "reconnect_data").data.sessions.find(
    (item) => item.sessionId === sessionId,
  );
  assert.equal(entry.replayBatch.snapshot.causality.commandId, finalizeCommandId);
  assert.equal(entry.replayBatch.snapshot.payload.recovery, "none");
  assert.equal(entry.replayBatch.snapshotSequence, 4);
  assert.equal(forwarded.length, 2);
  assert.equal(countPendingCommands(manager, channel, PENDING_COMMAND_KIND.TURN_SNAPSHOT), 0);
});

test("recovery receives its authority reply after the run transport closes", async () => {
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const sessionId = "session-recovery-run-closes";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
  });
  const run = manager.connectUpstreamChannel(channel, "api-key-1", "", {
    initialCommands: [],
    purpose: "run",
  }).socket;
  run.emit("open");
  manager.recordTurnLifecycleEnvelope(
    channel,
    authoritativeLifecycle({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "recovery-run-active",
      sessionId,
      turnScopeId: ORPHAN_TURN_SCOPE_ID,
      sequence: 3,
      revision: 3,
    }),
  );
  const client = createMockSocket();
  const reconnect = manager.handleReconnect(client, reconnectControl({ sessionId }));
  try {
    const query = FakeUpstreamWebSocket.instances.at(-1);
    assert.notEqual(query, run);
    query.emit("open");
    const emitSnapshot = (transport, index, payload) =>
      transport.emit(
        "message",
        JSON.stringify({
          event: TURN_SNAPSHOT_WIRE_EVENT,
          data: authoritativeSnapshot({
            commandId: JSON.parse(query.sent[index]).commandId,
            sessionId,
            unchanged: false,
            ...payload,
          }),
        }),
      );
    const orphan = {
      sequence: 3,
      recovery: "orphan",
      activeTurnScopeId: ORPHAN_TURN_SCOPE_ID,
      activeTurn: processingOrphan(sessionId),
    };
    emitSnapshot(run, 0, orphan);
    await flushMicrotasks();
    assert.equal(query.sent.length, 1);
    emitSnapshot(query, 0, orphan);
    await flushMicrotasks();
    assert.equal(JSON.parse(query.sent[1]).commandType, AGENT_COMMAND.FINALIZE);
    run.emit(
      "message",
      JSON.stringify({
        event: AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
        data: createAgentCommandReceipt({
          command: JSON.parse(query.sent[1]),
          outcome: AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
          error: { code: "turn_finalize_failed", message: "turn finalize failed" },
          occurredAt: "2026-01-01T00:00:00.000Z",
        }),
      }),
    );
    assert.equal(countPendingCommands(manager, channel, PENDING_COMMAND_KIND.TURN_SNAPSHOT), 1);
    run.close(1000, "done");
    assert.equal(query.readyState, FakeUpstreamWebSocket.OPEN);
    emitSnapshot(query, 1, {
      sequence: 4,
      recovery: "none",
      activeTurnScopeId: "",
      activeTurn: null,
    });
    await reconnect;
    assert.ok(getEvent(client, "reconnect_complete"));
    assert.equal(
      getEvent(client, "reconnect_data").data.sessions[0].replayBatch.snapshotSequence,
      4,
    );
    assert.equal(query.readyState, 3);
  } finally {
    manager.releaseSocket(client);
    await reconnect;
  }
});

test("a failed recovery finalize rejects reconnect without publishing the original snapshot", async () => {
  const sessionId = "session-recovery-failed";
  const { manager, channel, forwarded, client, reconnectPromise } =
    await setupRecoveryReconnect(sessionId);
  const snapshotCommandId = forwarded[0].commandId;
  replyToReconnectQuery(
    snapshotCommandId,
    TURN_SNAPSHOT_WIRE_EVENT,
    authoritativeSnapshot({
      commandId: snapshotCommandId,
      sessionId,
      sequence: 3,
      recovery: "orphan",
      unchanged: false,
      activeTurnScopeId: ORPHAN_TURN_SCOPE_ID,
      activeTurn: processingOrphan(sessionId),
    }),
  );
  await flushMicrotasks();
  const finalizeCommandId = forwarded[1].commandId;
  replyToReconnectQuery(
    finalizeCommandId,
    AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    createAgentCommandReceipt({
      command: {
        commandId: finalizeCommandId,
        commandType: AGENT_COMMAND.FINALIZE,
        identity: { sessionId },
      },
      outcome: AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
      error: { code: "turn_finalize_failed", message: "turn finalize failed" },
      occurredAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  await assert.rejects(
    reconnectPromise,
    new RegExp(`authoritative_snapshot_failed:${sessionId}:turn_finalize_failed`),
  );
  assert.equal(getEvent(client, "reconnect_data"), null);
  assert.equal(getEvent(client, "reconnect_complete"), null);
  assert.equal(countPendingCommands(manager, channel, PENDING_COMMAND_KIND.TURN_SNAPSHOT), 0);
});

test("cancelling reconnect during recovery finalize clears both pending command ids", async () => {
  const sessionId = "session-recovery-cancel";
  const { manager, channel, forwarded, client, reconnectPromise } =
    await setupRecoveryReconnect(sessionId);
  const snapshotCommandId = forwarded[0].commandId;
  replyToReconnectQuery(
    snapshotCommandId,
    TURN_SNAPSHOT_WIRE_EVENT,
    authoritativeSnapshot({
      commandId: snapshotCommandId,
      sessionId,
      sequence: 3,
      recovery: "orphan",
      unchanged: false,
      activeTurnScopeId: ORPHAN_TURN_SCOPE_ID,
      activeTurn: processingOrphan(sessionId),
    }),
  );
  await flushMicrotasks();
  const finalizeCommandId = forwarded[1].commandId;
  assert.equal(
    Boolean(
      pendingCommand(manager, channel, finalizeCommandId, PENDING_COMMAND_KIND.TURN_SNAPSHOT),
    ),
    true,
  );

  const superseding = manager.handleReconnect(
    client,
    reconnectControl({
      sessionId,
      requestId: "reconnect-superseding",
      knownLifecycleSequenceMap: { [sessionId]: 3 },
    }),
  );
  assert.equal(
    Boolean(
      pendingCommand(manager, channel, snapshotCommandId, PENDING_COMMAND_KIND.TURN_SNAPSHOT),
    ),
    false,
  );
  assert.equal(
    Boolean(
      pendingCommand(manager, channel, finalizeCommandId, PENDING_COMMAND_KIND.TURN_SNAPSHOT),
    ),
    false,
  );
  await reconnectPromise.catch(() => {});

  const currentCommandId = forwarded.at(-1).commandId;
  replyToReconnectQuery(
    currentCommandId,
    TURN_SNAPSHOT_WIRE_EVENT,
    authoritativeSnapshot({
      commandId: currentCommandId,
      sessionId,
      sequence: 3,
      recovery: "none",
      unchanged: false,
      activeTurn: null,
      activeTurnScopeId: "",
    }),
  );
  await superseding;
  assert.deepEqual(
    client.sentEvents
      .filter((item) => item.event === "reconnect_data")
      .map((item) => item.data.requestId),
    ["reconnect-superseding"],
  );
});

test("releasing a disconnected socket settles its reconnect snapshot immediately", async () => {
  const forwarded = [];
  const manager = new ChannelManager(observeReconnectCommands(forwarded));
  const sessionId = "session-disconnect";
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId }), {
    userId: "user-1",
    sessionId,
  });
  manager.recordTurnLifecycleEnvelope(
    channel,
    authoritativeLifecycle({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "e3",
      sessionId,
      turnScopeId: "t1",
      revision: 3,
      sequence: 3,
    }),
  );
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const reconnectPromise = manager.handleReconnect(
    client,
    reconnectControl({ sessionId, knownLifecycleSequenceMap: { [sessionId]: 1 } }),
  );
  await Promise.resolve();
  assert.equal(countPendingCommands(manager, channel, PENDING_COMMAND_KIND.TURN_SNAPSHOT), 1);

  manager.releaseSocket(client);

  assert.equal(manager.commandRegistry.commands.size, 0);
  assert.equal(
    manager.commandRegistry.lastRemoval(forwarded[0].commandId).reason,
    "requester_disconnected",
  );
  await reconnectPromise;
  assert.equal(getEvent(client, "reconnect_data"), null);
  assert.equal(getEvent(client, "reconnect_complete"), null);
});
