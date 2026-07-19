/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/shared/turn-lifecycle-protocol";
import { normalizeSessionEntity } from "../../../src/system-core/session/entities/session-entity.js";
import { SessionMessageService } from "../../../src/system-core/session/services/session-message-service.js";

const now = () => "2026-07-18T00:00:00.000Z";

function harness(initial = {}) {
  let persisted = structuredClone({ sessionId: "s1", parentSessionId: "", version: 3, revision: 3, messages: [], ...initial });
  const repo = {
    async withSessionMutation(_u, _s, _p, operation) { return operation(); },
    async resolveParentSessionId() { return ""; },
    async findById() { return normalizeSessionEntity(structuredClone(persisted), { now }); },
    async save(_u, next, _p, { expectedVersion } = {}) {
      assert.equal(expectedVersion, Number(persisted.version ?? persisted.revision ?? 0));
      persisted = structuredClone(normalizeSessionEntity(next, { now }));
    },
  };
  return {
    service: new SessionMessageService({ sessionRepo: repo, now }),
    reload: () => normalizeSessionEntity(structuredClone(persisted), { now }),
  };
}

const event = (eventType, commandId, expectedRevision, extra = {}) => ({
  userId: "u1", sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1",
  eventType, commandId, expectedRevision, ...extra,
});

test("authoritative lifecycle persists, sequences and restores the complete path", async () => {
  const h = harness();
  const accepted = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.ACTION_ACCEPTED, "c1", 0, { action: "send", phase: TURN_PHASE.ACTION }));
  assert.equal(accepted.turn.state, TURN_STATE.ACTION_REQUESTING);
  const started = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_STARTED, "c2", 1, { phase: TURN_PHASE.PROCESSING, executionState: "sending" }));
  assert.equal(started.turn.state, TURN_STATE.PROCESSING);
  const processed = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_COMPLETED, "c3", 2, { phase: TURN_PHASE.COMPLETION }));
  const completed = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.COMPLETED, "c4", 3, { phase: TURN_PHASE.COMPLETION, summaryVersion: 1 }));
  assert.equal(processed.turn.state, TURN_STATE.COMPLETION_REQUESTING);
  assert.equal(completed.turn.state, TURN_STATE.COMPLETED);
  assert.equal(completed.turn.sequence, 4);
  const restored = h.reload().turnLifecycle;
  assert.equal(restored.activeTurnScopeId, "");
  assert.equal(restored.turns.t1.state, TURN_STATE.COMPLETED);
  assert.equal(restored.turns.t1.summaryVersion, 1);
});

test("command replay is idempotent and conflicting reuse is rejected", async () => {
  const h = harness();
  const input = event(TURN_EVENT.ACTION_ACCEPTED, "same", 0, { action: "send", phase: TURN_PHASE.ACTION });
  await h.service.applyTurnLifecycleEvent(input);
  const replay = await h.service.applyTurnLifecycleEvent(input);
  const conflict = await h.service.applyTurnLifecycleEvent({ ...input, action: "resend" });
  assert.equal(replay.deduplicated, true);
  assert.equal(conflict.reason, "idempotency_key_reused");
  assert.equal(h.reload().turnLifecycle.sequence, 1);
});

test("session mutex, turn revision and session version conflicts do not mutate state", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.ACTION_ACCEPTED, "c1", 0, { action: "send", phase: TURN_PHASE.ACTION }));
  const second = await h.service.applyTurnLifecycleEvent({ ...event(TURN_EVENT.ACTION_ACCEPTED, "c2", 0, { action: "resend", phase: TURN_PHASE.ACTION }), turnScopeId: "t2" });
  const stale = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_STARTED, "c3", 0, { phase: TURN_PHASE.PROCESSING, executionState: "sending" }));
  const sessionStale = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_STARTED, "c4", 1, { phase: TURN_PHASE.PROCESSING, executionState: "sending", expectedSessionVersion: 2 }));
  assert.equal(second.reason, "session_action_conflict");
  assert.equal(stale.reason, "turn_revision_conflict");
  assert.equal(sessionStale.reason, "session_version_conflict");
  assert.equal(h.reload().turnLifecycle.sequence, 1);
});

test("stop is accepted only while authoritative execution state is sending", async () => {
  for (const executionState of ["reconnecting", "interaction_pending"]) {
    const h = harness();
    await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.ACTION_ACCEPTED, `a-${executionState}`, 0, { action: "send", phase: TURN_PHASE.ACTION }));
    await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_STARTED, `p-${executionState}`, 1, { phase: TURN_PHASE.PROCESSING, executionState }));
    const denied = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.STOP_ACCEPTED, `s-${executionState}`, 2, { phase: TURN_PHASE.ACTION }));
    assert.equal(denied.reason, "stop_not_allowed");
  }
  const h = harness();
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.ACTION_ACCEPTED, "a", 0, { action: "send", phase: TURN_PHASE.ACTION }));
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_STARTED, "p", 1, { phase: TURN_PHASE.PROCESSING, executionState: "sending" }));
  const accepted = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.STOP_ACCEPTED, "s", 2, { phase: TURN_PHASE.ACTION }));
  assert.equal(accepted.turn.action, "stop");
  assert.equal(accepted.turn.state, TURN_STATE.ACTION_REQUESTING);
});

test("snapshot reloads authoritative state without mutating sequence and supports unchanged", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.ACTION_ACCEPTED, "c1", 0, { action: "send", phase: TURN_PHASE.ACTION }));
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_STARTED, "c2", 1, { phase: TURN_PHASE.PROCESSING, executionState: "sending" }));
  const before = h.reload().turnLifecycle.sequence;
  const result = await h.service.getTurnLifecycleSnapshot({ userId: "u1", sessionId: "s1", commandId: "snapshot-1", knownSequence: before });
  assert.equal(result.found, true);
  assert.equal(result.snapshot.unchanged, true);
  assert.equal(result.snapshot.activeTurn.turnScopeId, "t1");
  assert.equal(result.snapshot.activeTurn.capabilities.canStop, true);
  assert.equal(h.reload().turnLifecycle.sequence, before);
});

test("retryable finalize failure keeps the session locked and completes idempotently after reload", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.ACTION_ACCEPTED, "a", 0, { action: "send", phase: TURN_PHASE.ACTION }));
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_STARTED, "p", 1, { phase: TURN_PHASE.PROCESSING, executionState: "sending" }));
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_COMPLETED, "pc", 2, { phase: TURN_PHASE.COMPLETION, finalizeCommandId: "finalize:t1" }));
  const failed = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.FAILED, "f", 3, {
    phase: TURN_PHASE.COMPLETION,
    failure: { code: "summary_failed", retryable: true },
  }));
  assert.equal(failed.turn.state, TURN_STATE.COMPLETION_FAILED);
  assert.equal(h.reload().turnLifecycle.activeTurnScopeId, "t1");
  assert.equal(h.reload().turnLifecycle.turns.t1.finalizeIntent.commandId, "finalize:t1");
  const blocked = await h.service.applyTurnLifecycleEvent({ ...event(TURN_EVENT.ACTION_ACCEPTED, "other", 0, { action: "send", phase: TURN_PHASE.ACTION }), turnScopeId: "t2" });
  assert.equal(blocked.reason, "session_action_conflict");
  const completed = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.COMPLETED, "finalize:t1", 4, { phase: TURN_PHASE.COMPLETION, summaryVersion: 8 }));
  assert.equal(completed.turn.state, TURN_STATE.COMPLETED);
  assert.equal(completed.turn.finalizeIntent, null);
  assert.equal(h.reload().turnLifecycle.activeTurnScopeId, "");
  const replay = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.COMPLETED, "finalize:t1", 4, { phase: TURN_PHASE.COMPLETION, summaryVersion: 8 }));
  assert.equal(replay.deduplicated, true);
  assert.equal(h.reload().turnLifecycle.sequence, 5);
});

test("retryable stop finalize failure keeps intent and can recover once", async () => {
  const h = harness();
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.ACTION_ACCEPTED, "a-stop", 0, { action: "send", phase: TURN_PHASE.ACTION }));
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.PROCESSING_STARTED, "p-stop", 1, { phase: TURN_PHASE.PROCESSING, executionState: "sending" }));
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.STOP_ACCEPTED, "s-stop", 2, { phase: TURN_PHASE.ACTION }));
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.STOP_PROCESSING_COMPLETED, "sp-stop", 3, { phase: TURN_PHASE.STOP, finalizeCommandId: "finalize-stop:t1" }));
  await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.FAILED, "sf-stop", 4, { phase: TURN_PHASE.STOP, failure: { retryable: true } }));
  const restored = h.reload().turnLifecycle;
  assert.equal(restored.activeTurnScopeId, "t1");
  assert.equal(restored.turns.t1.finalizeIntent.commandId, "finalize-stop:t1");
  const completed = await h.service.applyTurnLifecycleEvent(event(TURN_EVENT.STOP_COMPLETED, "finalize-stop:t1", 5, { phase: TURN_PHASE.STOP, summaryVersion: 9 }));
  assert.equal(completed.turn.state, TURN_STATE.STOP_COMPLETED);
  assert.equal(h.reload().turnLifecycle.activeTurnScopeId, "");
});
