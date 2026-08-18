/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { applyReconnectDataReplay } from "../../../../../../src/modules/chat/runtime/reconnect/reconnectDataReplay.js";
import {
  createEventEnvelope,
  createReplayBatch,
  createTurnSnapshotEnvelope,
  EVENT_FAMILY,
  INTERACTION_EVENT_TYPE,
  INTERACTION_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol";
import {
  createTurnLifecycleEnvelope,
  createTurnLifecycleSnapshot,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_STATE,
} from "@noobot/session-protocol";

const REPLAY_ORDERING_DOMAIN = "turn-lifecycle";

function snapshot({ sessionId = "s-1", turnScopeId = "turn-1", sequence = 4, state = TURN_STATE.PROCESSING } = {}) {
  return createTurnLifecycleSnapshot({
    commandId: `snapshot-${turnScopeId}`,
    sessionId,
    sequence,
    activeTurnScopeId: turnScopeId,
    activeTurn: {
      sessionId,
      dialogProcessId: `dp-${turnScopeId}`,
      turnScopeId,
      messageId: `message-${turnScopeId}`,
      presentationMessageId: `message-${turnScopeId}`,
      commandId: `command-${turnScopeId}`,
      action: "send",
      state,
      phase: state === TURN_STATE.PROCESSING ? "processing" : "completion",
      executionState: state === TURN_STATE.PROCESSING ? "sending" : "completed",
      revision: 2,
      sequence,
    },
  });
}

function batch({ sessionId = "s-1", turnScopeId = "turn-1", sequence = 4, events = [], pendingInteractions = [] } = {}) {
  const baseline = snapshot({ sessionId, turnScopeId, sequence });
  return createReplayBatch({
    sessionId,
    streamId: `stream-${sessionId}`,
    requestId: `reconnect-${sessionId}`,
    snapshot: createTurnSnapshotEnvelope(baseline, {
      eventId: `snapshot-event-${sessionId}-${sequence}`,
      producer: { type: "test", id: "reconnect-data-replay" },
    }),
    snapshotSequence: sequence,
    orderingDomain: REPLAY_ORDERING_DOMAIN,
    orderingScopeId: sessionId,
    events,
    pendingInteractions,
  });
}

function lifecycleEvent(sequence) {
  const payload = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: `event-${sequence}`,
    commandId: "command-1",
    sessionId: "s-1",
    turnScopeId: "turn-1",
    messageId: "message-turn-1",
    presentationMessageId: "message-turn-1",
    dialogProcessId: "dp-turn-1",
    revision: 3,
    sequence,
    phase: "processing",
    state: "processing",
    action: "send",
    executionState: "sending",
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
  return createEventEnvelope({
    family: EVENT_FAMILY.TURN_LIFECYCLE,
    identity: {
      eventId: payload.eventId,
      eventType: TURN_LIFECYCLE_WIRE_EVENT,
      sessionId: payload.sessionId,
      turnScopeId: payload.turnScopeId,
      messageId: payload.messageId,
    },
    causality: { commandId: payload.commandId },
    ordering: { domain: REPLAY_ORDERING_DOMAIN, scopeId: payload.sessionId, sequence, revision: payload.revision },
    producer: { type: "test", id: "reconnect-data-replay" },
    occurredAt: payload.occurredAt,
    payload,
  });
}

function pendingInteraction(requestId) {
  const payload = {
    requestId,
    dialogProcessId: "dp-1",
    interactionType: "approval",
    content: "approve?",
    lifecycle: "pending",
  };
  return createEventEnvelope({
    family: EVENT_FAMILY.INTERACTION_REQUEST,
    identity: {
      eventId: `${requestId}-event`,
      eventType: INTERACTION_EVENT_TYPE.REQUEST,
      sessionId: "s-1",
      turnScopeId: "turn-1",
    },
    causality: {},
    ordering: { domain: INTERACTION_SEQUENCE_DOMAIN, scopeId: requestId, sequence: 1 },
    producer: { type: "test", id: "reconnect-data-replay" },
    occurredAt: "2026-01-01T00:01:00.000Z",
    payload,
  });
}

function fixture(overrides = {}) {
  return {
    ensureReconnectSessionActive: vi.fn(async () => {}),
    isCurrentActiveSession: vi.fn((id) => id === "s-1"),
    reconcileSessionState: vi.fn(async () => true),
    hydrateActiveSessionBeforeReplay: vi.fn(async () => true),
    applyTurnLifecycleEnvelope: vi.fn(async () => ({ applied: true })),
    applyTurnLifecycleSnapshot: vi.fn(() => ({ applied: true })),
    applyPendingInteraction: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("applyReconnectDataReplay", () => {
  it("requires one valid Authority Replay Batch per session", async () => {
    const f = fixture();
    await applyReconnectDataReplay({ reconnectData: { sessions: [{ sessionId: "s-1" }] }, ...f });
    expect(f.reconcileSessionState).toHaveBeenCalledWith({
      sessionId: "s-1",
      reason: "invalid_replay_batch",
    });
    expect(f.applyTurnLifecycleSnapshot).not.toHaveBeenCalled();
  });

  it("applies the Authority snapshot before the ordered event tail", async () => {
    const baseline = snapshot({ sequence: 4 });
    const event = lifecycleEvent(5);
    const f = fixture();
    await applyReconnectDataReplay({
      reconnectData: { sessions: [{ sessionId: "s-1", replayBatch: batch({ events: [event] }) }] },
      ...f,
    });
    expect(f.applyTurnLifecycleSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      protocolVersion: baseline.protocolVersion,
      eventType: baseline.eventType,
      sessionId: baseline.sessionId,
      sequence: baseline.sequence,
      activeTurnScopeId: baseline.activeTurnScopeId,
    }));
    expect(f.applyTurnLifecycleEnvelope).toHaveBeenCalledWith(event);
    expect(f.applyTurnLifecycleSnapshot.mock.invocationCallOrder[0])
      .toBeLessThan(f.applyTurnLifecycleEnvelope.mock.invocationCallOrder[0]);
  });

  it("rejects the removed dialog message replay branch", async () => {
    const f = fixture();
    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [{
          sessionId: "s-1",
          replayBatch: batch({ sequence: 4 }),
          dialogProcesses: [],
        }],
      },
      ...f,
    });
    expect(f.reconcileSessionState).toHaveBeenCalledWith({
      sessionId: "s-1",
      reason: "invalid_replay_batch",
    });
    expect(f.applyTurnLifecycleSnapshot).not.toHaveBeenCalled();
  });

  it("reconciles a sequence gap and never applies the invalid tail", async () => {
    const event = lifecycleEvent(7);
    const f = fixture();
    await applyReconnectDataReplay({
      reconnectData: { sessions: [{ sessionId: "s-1", replayBatch: batch({ events: [event] }) }] },
      ...f,
    });
    expect(f.reconcileSessionState).toHaveBeenCalledWith({ sessionId: "s-1", reason: "invalid_replay_batch" });
    expect(f.applyTurnLifecycleEnvelope).not.toHaveBeenCalled();
  });

  it("applies only complete pending interaction records from the batch", async () => {
    const interaction = pendingInteraction("request-1");
    const f = fixture();
    await applyReconnectDataReplay({
      reconnectData: { sessions: [{ sessionId: "s-1", replayBatch: batch({ pendingInteractions: [interaction] }) }] },
      ...f,
    });
    expect(f.applyPendingInteraction).toHaveBeenCalledWith({
      ...interaction.payload,
      sessionId: interaction.identity.sessionId,
      turnScopeId: interaction.identity.turnScopeId,
    });
  });

  it("materializes pending interactions after session activation and hydration", async () => {
    const interaction = pendingInteraction("request-order");
    const order = [];
    const f = fixture({
      ensureReconnectSessionActive: vi.fn(async () => { order.push("activate"); }),
      hydrateActiveSessionBeforeReplay: vi.fn(async () => { order.push("hydrate"); }),
      applyPendingInteraction: vi.fn(async () => { order.push("interaction"); }),
    });
    await applyReconnectDataReplay({
      reconnectData: { sessions: [{ sessionId: "s-1", replayBatch: batch({ pendingInteractions: [interaction] }) }] },
      ...f,
    });
    expect(order).toEqual(["activate", "hydrate", "interaction"]);
  });
});
