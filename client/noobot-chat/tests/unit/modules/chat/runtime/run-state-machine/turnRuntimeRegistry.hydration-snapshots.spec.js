/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it, expect } from "vitest";
import { nextTick, ref } from "vue";
import {
  createTurnRuntimeRegistryState,
  confirmTurnRuntimeDeletion,
  applyTurnRuntimeEvent,
  resolveSessionTurnRuntime,
  resolveLatestStoppedTurn,
  resolveLatestContinuableStoppedTurn,
  resolveTurnRuntimeByScope,
  removeTurnRuntime,
  removeSessionRuntime,
  pruneTerminalTurns,
  selectSessionTurnRuntime,
  selectTurnMessageRuntime,
  turnRuntimeDisplayState,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
  applyTurnTerminalResolution,
  applyExecutionSnapshot,
  applyExecutionTree,
  executionTurnKey,
  isTurnRuntimeDeleted,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import {
  SESSION_RUN_EVENT,
  BackendChannelState,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import {
  backendState,
  sendStart,
  settleTerminal,
  snapshot,
} from "./turnRuntimeRegistryTestFixtures.js";
import { createTurnRuntimeStoreActions } from "../../../../../../src/modules/chat/stores/chatStoreTurnRuntime.js";
import { createComposerRuntimeState } from "../../../../../../src/modules/chat/runtime/session/composerRuntimeState.js";
import { createEventEnvelope, EVENT_FAMILY, replayEventTail } from "@noobot/event-protocol";
import {
  createTurnLifecycleEnvelope,
  TURN_LIFECYCLE_WIRE_EVENT,
} from "@noobot/session-protocol";

const lifecycleEvent = ({ eventType, eventId, state, phase, executionState, revision, sequence }) =>
  createTurnLifecycleEnvelope({
    eventType,
    eventId,
    commandId: "command-t1",
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "t1",
    messageId: "msg-event-t1",
    presentationMessageId: "msg-t1",
    dialogProcessId: "dp1",
    revision,
    sequence,
    phase,
    state,
    action: "send",
    executionState,
    capabilities: { actionLocked: state !== "completed", canStop: false },
    updatedAt: "2026-01-01T00:00:01.000Z",
    completionCommitId: state === "completed" ? "commit-t1" : "",
    summaryVersion: state === "completed" ? 1 : 0,
  });

describe("turnRuntimeRegistry: hydration and snapshots", () => {
  it("produces the same Registry projection from realtime events and snapshot plus ordered tail", () => {
    const events = [
      lifecycleEvent({
        eventType: "turn.action_accepted",
        eventId: "event-t1-1",
        state: "action_requesting",
        phase: "action",
        executionState: "accepted",
        revision: 1,
        sequence: 1,
      }),
      lifecycleEvent({
        eventType: "turn.processing_started",
        eventId: "event-t1-2",
        state: "processing",
        phase: "processing",
        executionState: "sending",
        revision: 2,
        sequence: 2,
      }),
      lifecycleEvent({
        eventType: "turn.processing_completed",
        eventId: "event-t1-3",
        state: "completion_requesting",
        phase: "completion",
        executionState: "completing",
        revision: 3,
        sequence: 3,
      }),
      lifecycleEvent({
        eventType: "turn.completed",
        eventId: "event-t1-4",
        state: "completed",
        phase: "completion",
        executionState: "completed",
        revision: 4,
        sequence: 4,
      }),
    ];
    const realtime = createTurnRuntimeRegistryState();
    for (const event of events) applyTurnLifecycleEnvelope(realtime, event);

    const protocolEvents = events.map((payload) => createEventEnvelope({
      family: EVENT_FAMILY.TURN_LIFECYCLE,
      identity: {
        eventId: payload.eventId,
        eventType: TURN_LIFECYCLE_WIRE_EVENT,
        sessionId: payload.sessionId,
        turnScopeId: payload.turnScopeId,
        messageId: payload.messageId,
      },
      causality: { commandId: payload.commandId },
      ordering: {
        domain: "session",
        scopeId: payload.sessionId,
        sequence: payload.sequence,
        revision: payload.revision,
      },
      producer: { type: "test", id: "turn-runtime-registry" },
      occurredAt: payload.occurredAt,
      payload,
    }));

    const recovered = createTurnRuntimeRegistryState();
    const baseline = snapshot({
      commandId: events[1].commandId,
      sequence: 2,
      activeTurn: {
        ...snapshot().activeTurn,
        ...events[1],
        state: "processing",
        phase: "processing",
        executionState: "sending",
        revision: 2,
        sequence: 2,
      },
    });
    expect(applyTurnLifecycleSnapshot(recovered, baseline)).toMatchObject({ applied: true });
    expect(
      replayEventTail({
        snapshotSequence: 2,
        orderingDomain: "session",
        orderingScopeId: "s1",
        events: protocolEvents.slice(2),
        apply: (event) => applyTurnLifecycleEnvelope(recovered, event.payload),
      }),
    ).toMatchObject({ applied: true, lastSequence: 4 });

    expect(resolveTurnRuntimeByScope(recovered, "t1", { sessionId: "s1" })).toEqual(
      resolveTurnRuntimeByScope(realtime, "t1", { sessionId: "s1" }),
    );
  });

  it("hydrates every persisted turn timing without creating lifecycle authority", () => {
    const registry = createTurnRuntimeRegistryState();
    const result = applyTurnTimingSnapshot(registry, {
      sessionId: "s1",
      turnTimings: [
        {
          turnScopeId: "client-turn:first",
          dialogProcessId: "dp-first",
          thinkingStartedAt: "2026-07-21T10:00:00.000Z",
          thinkingFinishedAt: "2026-07-21T10:00:15.000Z",
        },
        {
          turnScopeId: "client-turn:second",
          dialogProcessId: "dp-second",
          thinkingStartedAt: "2026-07-21T11:00:00.000Z",
          thinkingFinishedAt: "2026-07-21T11:00:09.000Z",
        },
      ],
    });

    expect(result).toMatchObject({
      applied: true,
      hydratedTurnScopeIds: ["client-turn:first", "client-turn:second"],
    });
    const first = resolveTurnRuntimeByScope(registry, "client-turn:first", { sessionId: "s1" });
    expect(first).toMatchObject({
      startedAt: "2026-07-21T10:00:00.000Z",
      finishedAt: "2026-07-21T10:00:15.000Z",
    });
    expect(first).not.toHaveProperty("state");
    expect(first).not.toHaveProperty("terminal");
    expect(
      resolveTurnRuntimeByScope(registry, "client-turn:second", { sessionId: "s1" })?.finishedAt,
    ).toBe("2026-07-21T11:00:09.000Z");
  });

  it("strictly validates snapshots and rejects same-sequence content conflicts", () => {
    const registry = createTurnRuntimeRegistryState();
    expect(applyTurnLifecycleSnapshot(registry, { ...snapshot(), commandId: "" })).toMatchObject({
      applied: false,
      reason: "invalid_authoritative_snapshot",
    });
    expect(applyTurnLifecycleSnapshot(registry, snapshot())).toMatchObject({ applied: true });
    expect(applyTurnLifecycleSnapshot(registry, snapshot())).toMatchObject({
      applied: false,
      deduplicated: true,
      reason: "duplicate_snapshot",
    });
    expect(
      applyTurnLifecycleSnapshot(registry, snapshot({ generatedAt: "2026-01-01T00:00:03.000Z" })),
    ).toMatchObject({
      applied: false,
      reason: "snapshot_sequence_conflict",
    });
  });

  it("applies replacement tombstones from the authoritative snapshot", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleSnapshot(
      registry,
      snapshot({
        sequence: 4,
        activeTurn: null,
        activeTurnScopeId: "",
        recentTerminalTurns: [
          { ...snapshot().activeTurn, turnScopeId: "turn-old", revision: 2, sequence: 2 },
          { ...snapshot().activeTurn, turnScopeId: "turn-tail", revision: 2, sequence: 4 },
        ],
      }),
    );

    const result = applyTurnLifecycleSnapshot(
      registry,
      snapshot({
        commandId: "snapshot-after-replacement",
        sequence: 5,
        activeTurn: null,
        activeTurnScopeId: "",
        recentTerminalTurns: [],
        replacedTurns: ["turn-old", "turn-tail"].map((turnScopeId) => ({
          turnScopeId,
          replacementDialogProcessId: "dialog-new",
          replacementTurnScopeId: "turn-new",
          replacementUserMessageId: "user-new",
          requestHash: "request-hash-replace-old-chain",
          commandId: "replace-old-chain",
          committedAggregateVersion: 7,
          replacedTurnScopeIds: ["turn-old", "turn-tail"],
          sequence: 5,
          committedAt: "2026-08-02T10:00:00.000Z",
        })),
      }),
    );

    expect(result).toMatchObject({
      applied: true,
      replacedTurnScopeIds: ["turn-old", "turn-tail"],
      replacementDeletion: { removedTurnScopeIds: ["turn-old", "turn-tail"] },
    });
    expect(isTurnRuntimeDeleted(registry, { sessionId: "s1", turnScopeId: "turn-old" })).toBe(true);
    expect(isTurnRuntimeDeleted(registry, { sessionId: "s1", turnScopeId: "turn-tail" })).toBe(
      true,
    );
    expect(resolveTurnRuntimeByScope(registry, "turn-old", { sessionId: "s1" })).toBeNull();
    expect(resolveTurnRuntimeByScope(registry, "turn-tail", { sessionId: "s1" })).toBeNull();
  });

  it("rejects malformed authoritative lifecycle envelopes before reducing them", () => {
    const registry = createTurnRuntimeRegistryState();
    const result = applyTurnLifecycleEnvelope(registry, {
      protocolVersion: 1,
      eventType: "turn.action_accepted",
      eventId: "",
      sessionId: "s1",
      turnScopeId: "t1",
      revision: 1,
      sequence: 1,
    });
    expect(result).toMatchObject({
      applied: false,
      reason: "invalid_authoritative_envelope",
      errors: expect.arrayContaining(["missing_event_id"]),
    });
    expect(registry.sessions.s1).toBeUndefined();
  });

  it("an empty active snapshot releases routing while retaining recent terminal turns", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleSnapshot(registry, snapshot());
    const terminal = {
      ...snapshot().activeTurn,
      turnScopeId: "done",
      dialogProcessId: "dp-done",
      state: "completed",
      phase: "completion",
      executionState: "completed",
      revision: 3,
      sequence: 3,
      capabilities: { actionLocked: false, canStop: false },
    };
    const result = applyTurnLifecycleSnapshot(
      registry,
      snapshot({
        commandId: "snapshot-2",
        sequence: 3,
        activeTurn: null,
        activeTurnScopeId: "",
        recentTerminalTurns: [terminal],
      }),
    );
    expect(result.applied).toBe(true);
    expect(registry.routeIndex.dp1).toBeUndefined();
    expect(resolveTurnRuntimeByScope(registry, "done", { sessionId: "s1" })).toMatchObject({
      state: "frontend_completed",
      terminal: "completed",
      terminalResolved: false,
    });
    expect(
      settleTerminal(registry, {
        turnScopeId: "done",
        dialogProcessId: "dp-done",
        revision: 4,
        sequence: 4,
      }).applied,
    ).toBe(true);
    expect(resolveTurnRuntimeByScope(registry, "done", { sessionId: "s1" })).toMatchObject({
      terminal: "completed",
      terminalResolved: true,
    });
  });

  it("keeps the latest unconsumed stopped Turn when an older terminal resolves late", () => {
    const registry = createTurnRuntimeRegistryState();
    const result = applyTurnLifecycleSnapshot(
      registry,
      snapshot({
        commandId: "snapshot-continuation-chain",
        sequence: 22,
        activeTurn: null,
        recentTerminalTurns: [
          {
            turnScopeId: "turn-b",
            dialogProcessId: "dialog-b",
            commandId: "turn-b:stop-completed",
            action: "stop",
            state: "stop_completed",
            phase: "stop",
            executionState: "user_stopped",
            continuationSource: { turnScopeId: "turn-a", dialogProcessId: "dialog-a" },
            revision: 5,
            sequence: 22,
            summaryVersion: 2,
            completionCommitId: "commit-turn-b",
            capabilities: { actionLocked: false, canStop: false },
            finishedAt: "2026-07-31T03:18:30.000Z",
          },
          {
            turnScopeId: "turn-a",
            dialogProcessId: "dialog-a",
            commandId: "turn-a:stop-completed",
            action: "stop",
            state: "stop_completed",
            phase: "stop",
            executionState: "user_stopped",
            continuedByTurnScopeId: "turn-b",
            revision: 5,
            sequence: 17,
            summaryVersion: 1,
            completionCommitId: "commit-turn-a",
            capabilities: { actionLocked: false, canStop: false },
            finishedAt: "2026-07-31T03:17:00.000Z",
          },
        ],
      }),
    );

    expect(result.applied).toBe(true);
    expect(resolveLatestContinuableStoppedTurn(registry, "s1")?.turnScopeId).toBe("turn-b");
    expect(registry.sessions.s1.activeTurnScopeId).toBe("");

    const lateOldTerminal = settleTerminal(registry, {
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-a",
      state: "stop_completed",
      revision: 5,
      sequence: 17,
      completionCommitId: "commit-turn-a",
      summaryVersion: 1,
      finishedAt: "2026-07-31T03:17:00.000Z",
    });
    expect(lateOldTerminal.applied).toBe(true);
    expect(resolveLatestContinuableStoppedTurn(registry, "s1")?.turnScopeId).toBe("turn-b");
    expect(registry.sessions.s1.activeTurnScopeId).toBe("");
    expect(resolveSessionTurnRuntime(registry, "s1")?.turnScopeId).toBe("turn-b");
  });

  it("does not let a replayed terminal Turn replace the active continuation", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleSnapshot(
      registry,
      snapshot({
        commandId: "snapshot-active-continuation",
        sequence: 23,
        activeTurnScopeId: "turn-current",
        activeTurn: {
          turnScopeId: "turn-current",
          dialogProcessId: "dialog-current",
          commandId: "turn-current:processing",
          action: "continue",
          state: "processing",
          phase: "processing",
          executionState: "sending",
          revision: 2,
          sequence: 23,
          summaryVersion: 0,
          capabilities: { actionLocked: true, canStop: true },
          continuationSource: {
            turnScopeId: "turn-stopped",
            dialogProcessId: "dialog-stopped",
          },
        },
        recentTerminalTurns: [
          {
            turnScopeId: "turn-stopped",
            dialogProcessId: "dialog-stopped",
            commandId: "turn-stopped:completed",
            action: "stop",
            state: "stop_completed",
            phase: "stop",
            executionState: "user_stopped",
            revision: 5,
            sequence: 21,
            summaryVersion: 1,
            completionCommitId: "commit-turn-stopped",
            capabilities: { actionLocked: false, canStop: false },
          },
        ],
      }),
    );

    expect(
      settleTerminal(registry, {
        turnScopeId: "turn-stopped",
        dialogProcessId: "dialog-stopped",
        state: "stop_completed",
        revision: 5,
        sequence: 21,
        completionCommitId: "commit-turn-stopped",
        summaryVersion: 1,
      }).applied,
    ).toBe(true);

    expect(registry.sessions.s1.activeTurnScopeId).toBe("turn-current");
    expect(selectSessionTurnRuntime(registry, "s1")).toMatchObject({
      turnScopeId: "turn-current",
      displayState: "sending",
      sending: true,
      canStop: true,
    });
  });

  it("lets a newer authoritative snapshot replace an old terminal active Turn", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleSnapshot(registry, snapshot());
    settleTerminal(registry, {
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      revision: 3,
      sequence: 3,
    });

    const result = applyTurnLifecycleSnapshot(
      registry,
      snapshot({
        commandId: "snapshot-new-active",
        sequence: 4,
        activeTurnScopeId: "t2",
        activeTurn: {
          turnScopeId: "t2",
          dialogProcessId: "dp2",
          commandId: "command-t2",
          action: "send",
          state: "processing",
          phase: "processing",
          executionState: "sending",
          revision: 2,
          sequence: 4,
          summaryVersion: 0,
          capabilities: { actionLocked: true, canStop: true },
        },
      }),
    );

    expect(result.applied).toBe(true);
    expect(registry.sessions.s1.activeTurnScopeId).toBe("t2");
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({
      turnScopeId: "t2",
      state: "frontend_processing",
      canStop: true,
      lifecycleObserved: true,
    });
  });

  it("reactively restores the stop action when a snapshot replaces an old stopped Turn", async () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleSnapshot(registry, snapshot());
    settleTerminal(registry, {
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      revision: 3,
      sequence: 3,
    });
    const turnRuntimeRegistry = ref(registry);
    const store = createTurnRuntimeStoreActions(turnRuntimeRegistry);
    const resolveActiveTurnScopeIdentity = () =>
      turnRuntimeRegistry.value.sessions.s1?.activeTurnScopeId || "";
    const { composerActionState } = createComposerRuntimeState({
      turnRuntimeRegistry,
      resolveActiveSessionIdentity: () => "s1",
      resolveActiveTurnScopeIdentity,
    });
    expect(composerActionState.value.canStop).toBe(false);

    store.applyTurnLifecycleSnapshot(
      snapshot({
        commandId: "snapshot-current-processing",
        sequence: 4,
        activeTurnScopeId: "t2",
        activeTurn: {
          turnScopeId: "t2",
          dialogProcessId: "dp2",
          commandId: "command-t2",
          action: "send",
          state: "processing",
          phase: "processing",
          executionState: "sending",
          revision: 2,
          sequence: 4,
          summaryVersion: 0,
          capabilities: { actionLocked: true, canStop: true },
        },
      }),
    );
    await nextTick();

    expect(resolveActiveTurnScopeIdentity()).toBe("t2");
    expect(composerActionState.value).toMatchObject({
      displayState: "sending",
      canStop: true,
    });
  });

  it("does not let channel state move a snapshot-owned Turn phase", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleSnapshot(registry, snapshot());

    backendState(registry, {
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      state: BackendChannelState.COMPLETED,
      seq: 999,
    });

    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({
      state: "frontend_processing",
      lifecycleObserved: true,
      terminal: null,
    });

    const completed = applyTurnLifecycleEnvelope(
      registry,
      lifecycleEvent({
        eventType: "turn.processing_completed",
        eventId: "event-t1-channel-independent-completion",
        state: "completion_requesting",
        phase: "completion",
        executionState: "completing",
        revision: 3,
        sequence: 3,
      }),
    );
    expect(completed).toMatchObject({
      applied: true,
      turn: { state: "frontend_completion_requesting", seq: 3 },
    });
  });
});
