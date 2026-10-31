/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  createEventEnvelope,
  createReplayBatch as createProtocolReplayBatch,
  createTurnSnapshotEnvelope,
  EVENT_FAMILY,
  getEventFamily,
  INTERACTION_EVENT_TYPE,
  INTERACTION_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol";
import { createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { findReconnectTargetSessionId } from "../../../../../src/modules/chat/model/reconnectReplayModel.js";

const producer = { type: "test", id: "reconnect-replay-model" };

const createReplayBatch = ({ sessionId, snapshot, snapshotSequence, pendingInteractions = [] }) =>
  createProtocolReplayBatch({
    sessionId,
    snapshot:
      snapshot === null
        ? null
        : createTurnSnapshotEnvelope(snapshot, {
            eventId: `snapshot-${snapshot.commandId}`,
            producer,
          }),
    snapshotSequence,
    events: [],
    pendingInteractions,
  });

const pendingInteraction = (requestId) =>
  createEventEnvelope({
    family: EVENT_FAMILY.INTERACTION_REQUEST,
    schemaVersion: getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST).schemaVersion,
    identity: {
      eventId: `${requestId}-event`,
      eventType: INTERACTION_EVENT_TYPE.REQUEST,
      sessionId: "s-1",
      turnScopeId: "turn-1",
    },
    causality: {},
    ordering: { domain: INTERACTION_SEQUENCE_DOMAIN, scopeId: requestId, sequence: 1 },
    producer,
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: {
      requestId,
      dialogProcessId: "dp-1",
      content: "confirm?",
      lifecycle: "pending",
    },
  });

describe("reconnectReplayModel", () => {
  const entryWithTurn = (turnScopeId, state) => ({
    sessionId: "s-1",
    replayBatch: createReplayBatch({
      sessionId: "s-1",
      snapshot: createTurnLifecycleSnapshot({
        generatedAt: "2026-01-01T00:00:00.000Z",
        recentTerminalTurns: [],
        replacedTurns: [],
        unchanged: false,
        recovery: "none",
        commandId: `command-${turnScopeId}`,
        sessionId: "s-1",
        sequence: 1,
        activeTurnScopeId: turnScopeId,
        activeTurn: {
          continuedByTurnScopeId: "",
          sessionId: "s-1",
          turnScopeId,
          dialogProcessId: `dp-${turnScopeId}`,
          presentationMessageId: `presentation-${turnScopeId}`,
          revision: 1,
          sequence: 1,
          state,
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      snapshotSequence: 1,
    }),
  });
  const idleEntry = (pendingInteractions) => ({
    sessionId: "s-1",
    replayBatch: createReplayBatch({
      sessionId: "s-1",
      snapshot: null,
      snapshotSequence: 0,
      pendingInteractions,
    }),
  });

  it("does not infer navigation from other running turns or pending interactions", () => {
    expect(findReconnectTargetSessionId([entryWithTurn("turn-1", "processing")], "")).toBe("");
    expect(
      findReconnectTargetSessionId([entryWithTurn("turn-stopped", "stop_completed")], ""),
    ).toBe("");
    expect(findReconnectTargetSessionId([idleEntry([])], "")).toBe("");
    expect(findReconnectTargetSessionId([idleEntry([pendingInteraction("request-1")])], "")).toBe(
      "",
    );
    expect(findReconnectTargetSessionId([entryWithTurn("turn-1", "processing")], "s-local")).toBe(
      "",
    );
  });

  it("keeps the protocol target session when present", () => {
    const currentIdle = {
      sessionId: "s-current",
      replayBatch: createReplayBatch({
        sessionId: "s-current",
        snapshot: createTurnLifecycleSnapshot({
          generatedAt: "2026-01-01T00:00:00.000Z",
          recentTerminalTurns: [],
          replacedTurns: [],
          unchanged: false,
          recovery: "none",
          commandId: "command-current",
          sessionId: "s-current",
          sequence: 1,
          activeTurnScopeId: "",
          activeTurn: null,
        }),
        snapshotSequence: 1,
      }),
    };
    const otherRecoverable = {
      sessionId: "s-other",
      replayBatch: createReplayBatch({
        sessionId: "s-other",
        snapshot: createTurnLifecycleSnapshot({
          generatedAt: "2026-01-01T00:00:00.000Z",
          recentTerminalTurns: [],
          replacedTurns: [],
          unchanged: false,
          recovery: "none",
          commandId: "command-other",
          sessionId: "s-other",
          sequence: 2,
          activeTurnScopeId: "turn-other",
          activeTurn: {
            continuedByTurnScopeId: "",
            sessionId: "s-other",
            turnScopeId: "turn-other",
            dialogProcessId: "dp-other",
            presentationMessageId: "presentation-other",
            revision: 1,
            sequence: 2,
            state: "processing",
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
        snapshotSequence: 2,
      }),
    };

    expect(findReconnectTargetSessionId([currentIdle, otherRecoverable], "s-current")).toBe(
      "s-current",
    );
  });
});
