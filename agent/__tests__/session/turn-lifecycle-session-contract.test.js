/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/session-protocol";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { SessionCrudService } from "../../src/session/services/session-crud-service.js";
import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";

const now = () => "2026-07-18T00:00:00.000Z";

function harness(initial = {}) {
  let persisted = structuredClone({
    sessionId: "s1",
    parentSessionId: "",
    aggregateVersion: 3,
    messages: [],
    ...initial,
  });
  let displaySummarySession = null;
  let saveFailure = null;
  const repo = {
    async withSessionMutation(_u, _s, _p, operation) {
      return operation();
    },
    async resolveParentSessionId() {
      return "";
    },
    async findById() {
      return normalizeSessionEntity(structuredClone(persisted), { now });
    },
    async save(_u, next, _p, { expectedAggregateVersion } = {}) {
      assert.equal(expectedAggregateVersion, Number(persisted.aggregateVersion ?? 0));
      if (saveFailure) {
        const error = saveFailure;
        saveFailure = null;
        throw error;
      }
      persisted = structuredClone(normalizeSessionEntity(next, { now }));
    },
    async writeSessionDisplaySummary(_u, session) {
      displaySummarySession = structuredClone(normalizeSessionEntity(session, { now }));
    },
  };
  return {
    service: new SessionMessageService({ sessionRepo: repo, now }),
    reload: () => normalizeSessionEntity(structuredClone(persisted), { now }),
    reloadDisplaySummarySession: () =>
      displaySummarySession &&
      normalizeSessionEntity(structuredClone(displaySummarySession), { now }),
    failNextSave: (error = new Error("session_save_failed")) => {
      saveFailure = error;
    },
  };
}

function newSessionHarness() {
  let persisted = null;
  const repo = {
    async withSessionMutation(_u, _s, _p, operation) {
      return operation();
    },
    async resolveParentSessionId() {
      return "";
    },
    createInitialSession({ sessionId }) {
      return normalizeSessionEntity(
        { sessionId, parentSessionId: "", aggregateVersion: 0, messages: [] },
        { now },
      );
    },
    async findById() {
      return persisted ? normalizeSessionEntity(structuredClone(persisted), { now }) : null;
    },
    async save(_u, next, _p, { expectedAggregateVersion, createOnly } = {}) {
      if (createOnly) assert.equal(persisted, null);
      else assert.equal(expectedAggregateVersion, Number(persisted.aggregateVersion ?? 0));
      persisted = structuredClone(normalizeSessionEntity(next, { now }));
    },
  };
  return {
    service: new SessionMessageService({ sessionRepo: repo, now }),
    reload: () => persisted && normalizeSessionEntity(structuredClone(persisted), { now }),
  };
}

const event = (eventType, commandId, expectedRevision, extra = {}) => {
  const action = String(extra.action || "").trim();
  return {
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "t1",
    dialogProcessId: "dp1",
    messageId: "turn-message-t1",
    presentationMessageId: "presentation-t1",
    eventType,
    commandId,
    expectedRevision,
    ...extra,
    ...(eventType === TURN_EVENT.ACTION_ACCEPTED && action !== "resend"
      ? {
          userMessage: {
            content: "authoritative user message",
            messageId: "user-message-t1",
            messageOrigin: "natural",
            userMetaMaterialized: true,
          },
        }
      : {}),
  };
};

const eventIdOf = (envelope) => envelope?.identity?.eventId;
const deliveryReceiptOf = (envelope) => ({
  eventId: eventIdOf(envelope),
  consumerId: "test-authority-consumer",
  orderingDomain: envelope.ordering.domain,
  orderingScopeId: envelope.ordering.scopeId,
  sequence: envelope.ordering.sequence,
});

test("first send creates the session before committing action accepted", async () => {
  const h = newSessionHarness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "first-send", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
      createSessionIfAbsent: true,
    }),
  );
  assert.equal(accepted.applied, true);
  assert.equal(accepted.turn.state, TURN_STATE.ACTION_REQUESTING);
  assert.equal(Boolean(eventIdOf(accepted.envelope)), true);
  assert.equal(eventIdOf(accepted.envelope), h.reload().authorityEventOutbox[0]?.eventId);
  assert.equal(h.reload().turnLifecycle.activeTurnScopeId, "t1");
  assert.equal(accepted.aggregateVersion, 1);
  assert.equal(h.reload().aggregateVersion, 1);
});

test("authority outbox delivery is read, attempted, and acknowledged through the session transaction", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "outbox-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const receipt = deliveryReceiptOf(accepted.envelope);
  const { eventId } = receipt;

  const pending = await h.service.getPendingAuthorityEvents({ userId: "u1", sessionId: "s1" });
  assert.equal(pending.found, true);
  assert.deepEqual(
    pending.events.map((item) => item.eventId),
    [eventId],
  );
  assert.equal(pending.events[0].delivery.attempts, 0);

  const attempted = await h.service.recordAuthorityEventAttempt({
    userId: "u1",
    sessionId: "s1",
    eventId,
  });
  assert.equal(attempted.recorded, true);
  assert.equal(h.reload().authorityEventOutbox[0].delivery.attempts, 1);
  assert.equal(h.reload().authorityEventOutbox[0].delivery.lastAttemptAt, now());

  const acknowledged = await h.service.acknowledgeAuthorityEvent({
    userId: "u1",
    sessionId: "s1",
    ...receipt,
  });
  assert.equal(acknowledged.acknowledged, true);
  assert.equal(
    (await h.service.getPendingAuthorityEvents({ userId: "u1", sessionId: "s1" })).events.length,
    0,
  );
  assert.equal(h.reload().authorityEventOutbox[0].delivery.deliveredAt, now());

  const replay = await h.service.acknowledgeAuthorityEvent({
    userId: "u1",
    sessionId: "s1",
    ...receipt,
  });
  assert.equal(replay.acknowledged, true);
  assert.equal(replay.deduplicated, true);
});

test("authority outbox delivery mutations remain atomic when session persistence fails", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "outbox-failure-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const receipt = deliveryReceiptOf(accepted.envelope);
  const { eventId } = receipt;

  h.failNextSave();
  await assert.rejects(() =>
    h.service.recordAuthorityEventAttempt({ userId: "u1", sessionId: "s1", eventId }),
  );
  assert.equal(h.reload().authorityEventOutbox[0].delivery.attempts, 0);

  h.failNextSave();
  await assert.rejects(() =>
    h.service.acknowledgeAuthorityEvent({ userId: "u1", sessionId: "s1", ...receipt }),
  );
  assert.equal(h.reload().authorityEventOutbox[0].delivery.deliveredAt, "");
});

test("authority outbox compaction is explicit, receipt-safe, and atomic on persistence failure", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "compact-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const receipt = deliveryReceiptOf(accepted.envelope);
  const { eventId } = receipt;
  await h.service.acknowledgeAuthorityEvent({ userId: "u1", sessionId: "s1", ...receipt });

  const invalid = await h.service.compactAuthorityEvents({
    userId: "u1",
    sessionId: "s1",
    deliveredThroughSequence: 1,
    consumerId: receipt.consumerId,
    orderingDomain: receipt.orderingDomain,
    orderingScopeId: receipt.orderingScopeId,
  });
  assert.equal(invalid.reason, "invalid_retention_cutoff");
  assert.equal(h.reload().authorityEventOutbox.length, 1);

  h.failNextSave();
  await assert.rejects(() =>
    h.service.compactAuthorityEvents({
      userId: "u1",
      sessionId: "s1",
      deliveredThroughSequence: 1,
      consumerId: receipt.consumerId,
      orderingDomain: receipt.orderingDomain,
      orderingScopeId: receipt.orderingScopeId,
      retainDeliveredAfter: "2026-07-19T00:00:00.000Z",
    }),
  );
  assert.equal(h.reload().authorityEventOutbox.length, 1);

  const compacted = await h.service.compactAuthorityEvents({
    userId: "u1",
    sessionId: "s1",
    deliveredThroughSequence: 1,
    consumerId: receipt.consumerId,
    orderingDomain: receipt.orderingDomain,
    orderingScopeId: receipt.orderingScopeId,
    retainDeliveredAfter: "2026-07-19T00:00:00.000Z",
  });
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.removed, 1);
  assert.equal(h.reload().authorityEventOutbox.length, 0);

  const replay = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "compact-r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  assert.equal(replay.deduplicated, true);
  assert.equal(eventIdOf(replay.envelope), eventId);
});

test("missing session send requires an explicit provision intent", async () => {
  const h = newSessionHarness();
  const result = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "implicit-send", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  assert.equal(result.reason, "session_not_found");
  assert.equal(h.reload(), null);
});

test("initial provision replay is idempotent and concurrent first actions are mutually exclusive", async () => {
  const h = newSessionHarness();
  const first = event(TURN_EVENT.ACTION_ACCEPTED, "provision", 0, {
    action: "send",
    phase: TURN_PHASE.ACTION,
    createSessionIfAbsent: true,
  });
  const accepted = await h.service.applyTurnLifecycleEvent(first);
  const replay = await h.service.applyTurnLifecycleEvent(first);
  const competing = await h.service.applyTurnLifecycleEvent({
    ...first,
    commandId: "competing",
    turnScopeId: "t2",
  });
  assert.equal(accepted.sessionCreated, true);
  assert.equal(replay.deduplicated, true);
  assert.equal(eventIdOf(replay.envelope), eventIdOf(accepted.envelope));
  assert.equal(competing.reason, "session_action_conflict");
  assert.equal(h.reload().turnLifecycle.sequence, 1);
  assert.equal(h.reload().authorityEventOutbox.length, 1);
});

test("resend and continue do not create a missing session", async () => {
  for (const action of ["resend", "continue"]) {
    const h = newSessionHarness();
    const result = await h.service.applyTurnLifecycleEvent(
      event(TURN_EVENT.ACTION_ACCEPTED, `missing-${action}`, 0, {
        action,
        phase: TURN_PHASE.ACTION,
      }),
    );
    assert.equal(result.applied, false);
    assert.equal(result.reason, "session_not_found");
    assert.equal(h.reload(), null);
  }
});

test("authoritative lifecycle persists, sequences and restores the complete path", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "c1", 0, { action: "send", phase: TURN_PHASE.ACTION }),
  );
  assert.equal(accepted.turn.state, TURN_STATE.ACTION_REQUESTING);
  const started = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "c2", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    }),
  );
  assert.equal(started.turn.state, TURN_STATE.PROCESSING);
  const processed = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_COMPLETED, "c3", 2, { phase: TURN_PHASE.COMPLETION }),
  );
  const completed = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.COMPLETED, "c4", 3, {
      phase: TURN_PHASE.COMPLETION,
      summaryVersion: 1,
      terminalStatus: { command: "completed" },
    }),
  );
  assert.equal(processed.turn.state, TURN_STATE.COMPLETION_REQUESTING);
  assert.equal(completed.turn.state, TURN_STATE.COMPLETED);
  assert.equal(completed.turn.executionState, "completed");
  assert.equal(completed.turn.sequence, 4);
  const restored = h.reload().turnLifecycle;
  assert.equal(restored.activeTurnScopeId, "");
  assert.equal(restored.turns.t1.state, TURN_STATE.COMPLETED);
  assert.equal(restored.turns.t1.executionState, "completed");
  const displayLifecycle = h.reloadDisplaySummarySession().turnLifecycle;
  assert.equal(displayLifecycle.sequence, restored.sequence);
  assert.equal(displayLifecycle.turns.t1.state, TURN_STATE.COMPLETED);
  assert.equal(displayLifecycle.turns.t1.executionState, "completed");
  assert.equal(restored.turns.t1.summaryVersion, 1);
  assert.equal(restored.turns.t1.terminalStatus.status, "completed");
  assert.equal(restored.turns.t1.terminalStatus.status, "completed");
  assert.equal(h.reload().authorityEventOutbox.length, 4);
  assert.equal(eventIdOf(completed.envelope), h.reload().authorityEventOutbox[3].eventId);
  assert.equal(h.reload().turnTerminalCommits, undefined);
});

test("repository save failure atomically preserves lifecycle, terminal status and outbox", async () => {
  const h = harness();
  h.failNextSave();
  await assert.rejects(
    h.service.applyTurnLifecycleEvent(
      event(TURN_EVENT.ACTION_ACCEPTED, "save-fails-before-first-commit", 0, {
        action: "send",
        phase: TURN_PHASE.ACTION,
      }),
    ),
    /session_save_failed/,
  );
  assert.equal(h.reload().turnLifecycle.sequence, 0);
  assert.equal(h.reload().authorityEventOutbox.length, 0);
  assert.deepEqual(h.reload().turnLifecycle.turns, {});

  const failed = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "atomic-a", 0, { action: "send", phase: TURN_PHASE.ACTION }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "atomic-p", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_COMPLETED, "atomic-pc", 2, { phase: TURN_PHASE.COMPLETION }),
  );
  const beforeTerminal = structuredClone(h.reload());
  h.failNextSave();
  await assert.rejects(
    h.service.applyTurnLifecycleEvent(
      event(TURN_EVENT.COMPLETED, "atomic-c", 3, {
        phase: TURN_PHASE.COMPLETION,
        terminalStatus: { command: "completed" },
      }),
    ),
    /session_save_failed/,
  );
  const afterTerminal = h.reload();
  assert.deepEqual(afterTerminal.turnLifecycle, beforeTerminal.turnLifecycle);
  assert.deepEqual(afterTerminal.authorityEventOutbox, beforeTerminal.authorityEventOutbox);
});

test("terminal materialization rejection does not mutate lifecycle or outbox", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "materialize-a", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "materialize-p", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_COMPLETED, "materialize-pc", 2, { phase: TURN_PHASE.COMPLETION }),
  );
  const before = structuredClone(h.reload());
  const rejected = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.COMPLETED, "materialize-c", 3, {
      phase: TURN_PHASE.COMPLETION,
      terminalStatus: { command: "not-a-terminal-command" },
    }),
  );
  assert.equal(rejected.reason, "invalid_turn_terminal_status");
  const after = h.reload();
  assert.deepEqual(after.turnLifecycle, before.turnLifecycle);
  assert.deepEqual(after.authorityEventOutbox, before.authorityEventOutbox);
});

test("terminal resolution reads status from the Turn without returning messages", async () => {
  const h = harness({
    turnTimings: [
      {
        turnScopeId: "t1",
        dialogProcessId: "dp1",
        thinkingStartedAt: "2026-07-17T23:59:30.000Z",
        thinkingFinishedAt: "2026-07-18T00:00:00.000Z",
      },
    ],
  });
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "r1", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
      startedAt: "2026-07-17T23:59:30.000Z",
    }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "r2", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_COMPLETED, "r3", 2, { phase: TURN_PHASE.COMPLETION }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.COMPLETED, "r4", 3, {
      phase: TURN_PHASE.COMPLETION,
      terminalStatus: { command: "completed" },
    }),
  );
  const crud = new SessionCrudService({
    sessionRepo: {
      async findById() {
        return h.reload();
      },
    },
    treeRepo: {},
    now,
  });

  const response = await crud.resolveTurnTerminalState({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "t1",
    commandId: "resolve-1",
  });
  assert.equal(response.resolved, true);
  assert.equal(response.turn.terminalStatus.status, "completed");
  assert.equal(response.turn.executionState, "completed");
  assert.equal(response.turn.startedAt, "2026-07-17T23:59:30.000Z");
  assert.equal(response.turn.finishedAt, "2026-07-18T00:00:00.000Z");
  assert.equal(response.materialization, null);
  assert.equal(JSON.stringify(response).includes('"messages"'), false);
});

test("noncanonical terminal snapshots are discarded without mutating Turns", () => {
  const normalized = normalizeSessionEntity(
    {
      sessionId: "legacy",
      messages: [],
      turnLifecycle: {
        sequence: 1,
        turns: { t1: { turnScopeId: "t1", state: "completed", revision: 1, sequence: 1 } },
      },
      turnTerminalCommits: {
        t1: {
          turnScopeId: "t1",
          terminalStatus: { status: "completed", reason: "run_completed" },
          messages: Array.from({ length: 100 }, (_, index) => ({
            role: "assistant",
            content: `large-${index}`,
          })),
        },
      },
    },
    { now },
  );

  assert.equal(normalized.turnLifecycle.turns.t1.terminalStatus, null);
  assert.equal(normalized.turnTerminalCommits, undefined);
});

test("command replay is idempotent and conflicting reuse is rejected", async () => {
  const h = harness();
  const input = event(TURN_EVENT.ACTION_ACCEPTED, "same", 0, {
    action: "send",
    phase: TURN_PHASE.ACTION,
  });
  await h.service.applyTurnLifecycleEvent(input);
  const replay = await h.service.applyTurnLifecycleEvent(input);
  const conflict = await h.service.applyTurnLifecycleEvent({
    ...input,
    executionState: "conflicting",
  });
  assert.equal(replay.deduplicated, true);
  assert.equal(conflict.reason, "idempotency_key_reused");
  assert.equal(h.reload().turnLifecycle.sequence, 1);
});

test("accepted Turn message identities are immutable", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "identity-accepted", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  assert.equal(accepted.applied, true);
  const messageConflict = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "identity-message-conflict", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
      messageId: "other-message",
    }),
  );
  assert.equal(messageConflict.reason, "turn_message_identity_conflict");
  const presentationConflict = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "identity-presentation-conflict", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
      presentationMessageId: "other-presentation",
    }),
  );
  assert.equal(presentationConflict.reason, "turn_presentation_identity_conflict");
  assert.equal(h.reload().turnLifecycle.sequence, 1);
});

test("command idempotency fingerprint includes execution ownership metadata", async () => {
  const h = harness();
  const input = event(TURN_EVENT.ACTION_ACCEPTED, "same-execution", 0, {
    action: "send",
    phase: TURN_PHASE.ACTION,
    executionKind: "agent",
    origin: { type: "chat" },
  });
  await h.service.applyTurnLifecycleEvent(input);
  const replay = await h.service.applyTurnLifecycleEvent(input);
  const conflict = await h.service.applyTurnLifecycleEvent({
    ...input,
    executionKind: "workflow",
    origin: { type: "workflow", workflowRunId: "wf-1" },
    stage: "planning",
  });
  assert.equal(replay.deduplicated, true);
  assert.equal(conflict.reason, "idempotency_key_reused");
  assert.equal(h.reload().turnLifecycle.turns.t1.executionKind, "agent");
});

test("session mutex, turn revision and session version conflicts do not mutate state", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "c1", 0, { action: "send", phase: TURN_PHASE.ACTION }),
  );
  const second = await h.service.applyTurnLifecycleEvent({
    ...event(TURN_EVENT.ACTION_ACCEPTED, "c2", 0, { action: "resend", phase: TURN_PHASE.ACTION }),
    turnScopeId: "t2",
  });
  const stale = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "c3", 0, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    }),
  );
  const sessionStale = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "c4", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
      expectedAggregateVersion: 2,
    }),
  );
  assert.equal(second.reason, "session_action_conflict");
  assert.equal(stale.reason, "turn_revision_conflict");
  assert.equal(sessionStale.reason, "SESSION_AGGREGATE_VERSION_CONFLICT");
  assert.equal(h.reload().turnLifecycle.sequence, 1);
});

test("stop is accepted only while authoritative execution state is sending", async () => {
  for (const executionState of ["reconnecting", "interaction_pending"]) {
    const h = harness();
    await h.service.applyTurnLifecycleEvent(
      event(TURN_EVENT.ACTION_ACCEPTED, `a-${executionState}`, 0, {
        action: "send",
        phase: TURN_PHASE.ACTION,
      }),
    );
    await h.service.applyTurnLifecycleEvent(
      event(TURN_EVENT.PROCESSING_STARTED, `p-${executionState}`, 1, {
        phase: TURN_PHASE.PROCESSING,
        executionState,
      }),
    );
    const denied = await h.service.applyTurnLifecycleEvent(
      event(TURN_EVENT.STOP_ACCEPTED, `s-${executionState}`, 2, { phase: TURN_PHASE.ACTION }),
    );
    assert.equal(denied.reason, "stop_not_allowed");
  }
  const h = harness();
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "a", 0, { action: "send", phase: TURN_PHASE.ACTION }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "p", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    }),
  );
  const accepted = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.STOP_ACCEPTED, "s", 2, { phase: TURN_PHASE.ACTION }),
  );
  assert.equal(accepted.turn.action, "stop");
  assert.equal(accepted.turn.state, TURN_STATE.ACTION_REQUESTING);
});

test("snapshot reloads authoritative state without mutating sequence and supports unchanged", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "c1", 0, { action: "send", phase: TURN_PHASE.ACTION }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "c2", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    }),
  );
  const before = h.reload().turnLifecycle.sequence;
  const result = await h.service.getTurnLifecycleSnapshot({
    userId: "u1",
    sessionId: "s1",
    commandId: "snapshot-1",
    knownSequence: before,
  });
  assert.equal(result.found, true);
  assert.equal(result.snapshot.unchanged, true);
  assert.equal(result.snapshot.activeTurn.turnScopeId, "t1");
  assert.equal(result.snapshot.activeTurn.sessionId, "s1");
  assert.equal(result.snapshot.activeTurn.capabilities.canStop, true);
  assert.equal(h.reload().turnLifecycle.sequence, before);
});

test("summary and reconnect snapshots share action-failure presentation scope", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "action-accepted", 0, {
      action: "send",
      phase: TURN_PHASE.ACTION,
    }),
  );
  const failed = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.FAILED, "action-failed", 1, {
      phase: TURN_PHASE.ACTION,
      executionState: "error",
      failure: { code: "attachment_rejected", retryable: false },
      terminalStatus: {
        command: "error",
        turnScopeId: "t1",
        dialogProcessId: "dp1",
        description: "attachment rejected",
        updatedAt: now(),
      },
    }),
  );

  assert.equal(failed.applied, true, failed.reason);
  const session = h.reload();
  assert.equal(session.turnLifecycle.turns.t1.state, "action_failed");
  assert.equal(session.turnLifecycle.turns.t1.executionState, "error");
  assert.equal(session.turnLifecycle.turns.t1.terminalStatus.status, "error");
  const summarySnapshot = buildSessionDisplaySummary(session).turnLifecycleSnapshot;
  const reconnectSnapshot = (
    await h.service.getTurnLifecycleSnapshot({
      userId: "u1",
      sessionId: "s1",
      commandId: "snapshot-action-failure",
    })
  ).snapshot;
  const projectTerminalScopes = (snapshot) =>
    snapshot.recentTerminalTurns.map((turn) => [turn.turnScopeId, turn.state]);

  assert.deepEqual(projectTerminalScopes(summarySnapshot), [["t1", "action_failed"]]);
  assert.deepEqual(
    projectTerminalScopes(reconnectSnapshot),
    projectTerminalScopes(summarySnapshot),
  );
  assert.equal(reconnectSnapshot.activeTurnScopeId, "");
});

test("retryable finalize failure keeps the session locked and completes idempotently after reload", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "a", 0, { action: "send", phase: TURN_PHASE.ACTION }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "p", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_COMPLETED, "pc", 2, {
      phase: TURN_PHASE.COMPLETION,
      finalizeCommandId: "finalize:t1",
    }),
  );
  const failed = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.FAILED, "f", 3, {
      phase: TURN_PHASE.COMPLETION,
      failure: { code: "summary_failed", retryable: true },
    }),
  );
  assert.equal(failed.turn.state, TURN_STATE.COMPLETION_FAILED);
  assert.equal(failed.turn.executionState, "error");
  assert.equal(h.reload().turnLifecycle.activeTurnScopeId, "t1");
  assert.equal(h.reload().turnLifecycle.turns.t1.finalizeIntent.commandId, "finalize:t1");
  const blocked = await h.service.applyTurnLifecycleEvent({
    ...event(TURN_EVENT.ACTION_ACCEPTED, "other", 0, { action: "send", phase: TURN_PHASE.ACTION }),
    turnScopeId: "t2",
  });
  assert.equal(blocked.reason, "session_action_conflict");
  const completed = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.COMPLETED, "finalize:t1", 4, {
      phase: TURN_PHASE.COMPLETION,
      summaryVersion: 8,
    }),
  );
  assert.equal(completed.turn.state, TURN_STATE.COMPLETED);
  assert.equal(completed.turn.finalizeIntent, null);
  assert.equal(h.reload().turnLifecycle.activeTurnScopeId, "");
  const replay = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.COMPLETED, "finalize:t1", 4, {
      phase: TURN_PHASE.COMPLETION,
      summaryVersion: 8,
    }),
  );
  assert.equal(replay.deduplicated, true);
  assert.equal(h.reload().turnLifecycle.sequence, 5);
});

test("retryable stop finalize failure keeps intent and can recover once", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.ACTION_ACCEPTED, "a-stop", 0, { action: "send", phase: TURN_PHASE.ACTION }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.PROCESSING_STARTED, "p-stop", 1, {
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.STOP_ACCEPTED, "s-stop", 2, { phase: TURN_PHASE.ACTION }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.STOP_PROCESSING_COMPLETED, "sp-stop", 3, {
      phase: TURN_PHASE.STOP,
      finalizeCommandId: "finalize-stop:t1",
    }),
  );
  await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.FAILED, "sf-stop", 4, {
      phase: TURN_PHASE.STOP,
      failure: { retryable: true },
    }),
  );
  const restored = h.reload().turnLifecycle;
  assert.equal(restored.activeTurnScopeId, "t1");
  assert.equal(restored.turns.t1.finalizeIntent.commandId, "finalize-stop:t1");
  const completed = await h.service.applyTurnLifecycleEvent(
    event(TURN_EVENT.STOP_COMPLETED, "finalize-stop:t1", 5, {
      phase: TURN_PHASE.STOP,
      summaryVersion: 9,
    }),
  );
  assert.equal(completed.turn.state, TURN_STATE.STOP_COMPLETED);
  assert.equal(completed.turn.executionState, "user_stopped");
  assert.equal(h.reload().turnLifecycle.activeTurnScopeId, "");
});
