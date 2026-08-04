/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { applyReconnectDataReplay } from "../../../../../../src/modules/chat/runtime/reconnect/reconnectDataReplay.js";
import { createReplayBatch, createTurnLifecycleSnapshot, TURN_STATE } from "@noobot/event-protocol";

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
    snapshot: baseline,
    snapshotSequence: sequence,
    events,
    pendingInteractions,
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
    const event = {
      protocol: { name: "@noobot/event-protocol", version: 1, schema: "turn.lifecycle" },
      identity: {
        eventId: "event-5", eventType: "turn.processing_started", commandId: "command-1",
        sessionId: "s-1", turnScopeId: "turn-1",
      },
      ordering: { streamId: "stream-s-1", streamSequence: 5, aggregateRevision: 3 },
      payload: { state: "processing", phase: "processing", executionState: "sending" },
      metadata: { producer: "authoritative-state", occurredAt: "2026-01-01T00:00:00.000Z" },
    };
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
    const event = {
      protocol: { name: "@noobot/event-protocol", version: 1, schema: "turn.lifecycle" },
      identity: { eventId: "event-7", eventType: "turn.processing_started", commandId: "command-1", sessionId: "s-1", turnScopeId: "turn-1" },
      ordering: { streamId: "stream-s-1", streamSequence: 7, aggregateRevision: 3 },
      payload: { state: "processing" }, metadata: { producer: "authoritative-state" },
    };
    const f = fixture();
    await applyReconnectDataReplay({
      reconnectData: { sessions: [{ sessionId: "s-1", replayBatch: batch({ events: [event] }) }] },
      ...f,
    });
    expect(f.reconcileSessionState).toHaveBeenCalledWith({ sessionId: "s-1", reason: "invalid_replay_batch" });
    expect(f.applyTurnLifecycleEnvelope).not.toHaveBeenCalled();
  });

  it("applies only complete pending interaction records from the batch", async () => {
    const interaction = {
      event: "interaction_request",
      data: {
        requestId: "request-1", sessionId: "s-1", dialogProcessId: "dp-1", turnScopeId: "turn-1",
        interactionType: "approval", content: "approve?",
      },
    };
    const f = fixture();
    await applyReconnectDataReplay({
      reconnectData: { sessions: [{ sessionId: "s-1", replayBatch: batch({ pendingInteractions: [interaction] }) }] },
      ...f,
    });
    expect(f.applyPendingInteraction).toHaveBeenCalledWith(interaction);
  });
});
