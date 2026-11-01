/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TURN_EVENT,
  TURN_FAILURE_CODE,
  TURN_PHASE,
  TURN_STATE,
  createTurnLifecycleEnvelope,
  createTurnFailure,
  projectExecutionFailure,
  validateTurnLifecycleEnvelope,
} from "../src/index.js";
import {
  EXECUTION_ABORT_TYPE,
  createExecutionAbortReason,
} from "../src/lifecycle/execution-abort.js";
import { snapshotTurn } from "../src/lifecycle/turn-projection.js";

test("execution failure projects canonical codes and declared unclassified errors", () => {
  const coded = Object.assign(new Error(" boom "), { code: "SESSION_DELETED" });
  assert.deepEqual(projectExecutionFailure({ error: coded }), {
    code: "SESSION_DELETED",
    message: "boom",
  });
  assert.deepEqual(projectExecutionFailure({ error: new Error("plain") }), {
    code: TURN_FAILURE_CODE.UNCLASSIFIED_ERROR,
    message: "plain",
  });
});

test("execution failure reads structured abort type and reason from the abort protocol", () => {
  const controller = new AbortController();
  controller.abort(
    createExecutionAbortReason({ type: EXECUTION_ABORT_TYPE.RUN_TIMEOUT, reason: "run timeout" }),
  );
  assert.deepEqual(
    projectExecutionFailure({ error: new Error("aborted"), abortSignal: controller.signal }),
    { code: EXECUTION_ABORT_TYPE.RUN_TIMEOUT, message: "run timeout" },
  );
});

test("execution failure rejects non-Error input and empty messages", () => {
  assert.throws(() => projectExecutionFailure({ error: "boom" }), TypeError);
  assert.throws(() => projectExecutionFailure({ error: { code: "x", message: "m" } }), TypeError);
  assert.throws(() => projectExecutionFailure({ error: new Error("  ") }), /non-empty message/);
});

test("turn failure requires an explicit retryable flag", () => {
  const error = Object.assign(new Error("m"), { code: "x" });
  assert.deepEqual(createTurnFailure({ error, retryable: true }), {
    code: "x",
    message: "m",
    retryable: true,
  });
  assert.throws(() => createTurnFailure({ error }), /retryable/);
  assert.throws(() => createTurnFailure({ error, retryable: "false" }), /retryable/);
});

test("snapshotTurn rejects legacy failure.phase without changing the source", () => {
  const turn = {
    turnScopeId: "turn:t1",
    phase: TURN_PHASE.PROCESSING,
    failure: { phase: TURN_PHASE.PROCESSING, code: "x", message: "m", retryable: false },
  };
  const before = structuredClone(turn);
  assert.throws(() => snapshotTurn(turn), { code: "TURN_LIFECYCLE_RECORD_INVALID" });
  assert.deepEqual(turn, before);
});

test("FAILED envelope phase is read only from the top-level field", () => {
  const base = {
    eventType: TURN_EVENT.FAILED,
    eventId: "e1",
    sessionId: "s1",
    turnScopeId: "turn:t1",
    presentationMessageId: "p1",
    revision: 1,
    sequence: 1,
    state: TURN_STATE.PROCESSING_FAILED,
    failure: { code: "x", message: "m", retryable: false },
  };
  assert.throws(
    () =>
      createTurnLifecycleEnvelope({
        ...base,
        phase: TURN_PHASE.PROCESSING,
        failure: { ...base.failure, phase: TURN_PHASE.PROCESSING },
      }),
    /invalid_turn_failure/,
  );
  const withoutPhase = { ...createTurnLifecycleEnvelope(base), phase: "" };
  assert.ok(validateTurnLifecycleEnvelope(withoutPhase).errors.includes("event_phase_mismatch"));
  const envelope = createTurnLifecycleEnvelope({
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...base,
    phase: TURN_PHASE.PROCESSING,
  });
  assert.equal(Object.hasOwn(envelope.failure, "phase"), false);
  assert.equal(
    validateTurnLifecycleEnvelope(envelope).errors.includes("event_phase_mismatch"),
    false,
  );
});
