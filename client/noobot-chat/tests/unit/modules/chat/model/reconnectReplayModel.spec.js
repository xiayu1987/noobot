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
import { findRecoverableReconnectSessionId } from "../../../../../src/modules/chat/model/reconnectReplayModel.js";

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
        commandId: `command-${turnScopeId}`,
        sessionId: "s-1",
        sequence: 1,
        activeTurnScopeId: turnScopeId,
        activeTurn: {
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

  it("findRecoverableReconnectSessionId recovers only running turns or pending interactions", () => {
    expect(findRecoverableReconnectSessionId([entryWithTurn("turn-1", "processing")], "")).toBe(
      "s-1",
    );
    expect(
      findRecoverableReconnectSessionId([entryWithTurn("turn-stopped", "stop_completed")], ""),
    ).toBe("");
    expect(findRecoverableReconnectSessionId([idleEntry([])], "")).toBe("");
    expect(
      findRecoverableReconnectSessionId([idleEntry([pendingInteraction("request-1")])], ""),
    ).toBe("s-1");
  });

  it("findRecoverableReconnectSessionId keeps the authoritative current session when present", () => {
    const currentIdle = {
      sessionId: "s-current",
      replayBatch: createReplayBatch({
        sessionId: "s-current",
        snapshot: createTurnLifecycleSnapshot({
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
          commandId: "command-other",
          sessionId: "s-other",
          sequence: 2,
          activeTurnScopeId: "turn-other",
          activeTurn: {
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

    expect(findRecoverableReconnectSessionId([currentIdle, otherRecoverable], "s-current")).toBe(
      "s-current",
    );
  });
});
