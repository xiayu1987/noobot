/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol/turn-lifecycle";
import { deriveAgentExecutionId, EXECUTION_KIND } from "@noobot/session-protocol";
import { transitionTurnLifecycle } from "../src/domain/turn-lifecycle-entity.js";
import { commitTurnLifecycle } from "../src/application/commit-turn-lifecycle.js";

const turnScopeId = "turn-finalize";
const executionId = deriveAgentExecutionId({ turnScopeId });

function processing() {
  let lifecycle = {};
  for (const input of [
    {
      sessionId: "session-1",
      executionId,
      executionKind: EXECUTION_KIND.AGENT,
      rootExecutionId: executionId,
      presentationMessageId: "presentation-1",
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      startedAt: "2026-07-18T00:00:00.000Z",
      commandId: "accepted",
      causationId: "accepted",
      phase: TURN_PHASE.ACTION,
      action: "send",
    },
    {
      eventType: TURN_EVENT.PROCESSING_STARTED,
      commandId: "started",
      causationId: "started",
      phase: TURN_PHASE.PROCESSING,
    },
  ]) {
    const result = transitionTurnLifecycle(lifecycle, { turnScopeId, ...input });
    assert.equal(result.applied, true, result.reason);
    lifecycle = result.lifecycle;
  }
  return lifecycle;
}

function apply(lifecycle, input) {
  return transitionTurnLifecycle(lifecycle, { turnScopeId, ...input });
}

function finalizeRequest(extra = {}) {
  return {
    eventType: TURN_EVENT.PROCESSING_COMPLETED,
    commandId: "processed",
    causationId: "processed",
    phase: TURN_PHASE.COMPLETION,
    ...extra,
  };
}

function completed(commandId) {
  return {
    eventType: TURN_EVENT.COMPLETED,
    commandId,
    causationId: commandId,
    phase: TURN_PHASE.COMPLETION,
    summaryVersion: 1,
    terminalStatus: { command: "completed" },
  };
}

test("finalize request requires completionCommitId and stores it as the intent commandId", () => {
  const missing = apply(processing(), finalizeRequest());
  assert.equal(missing.applied, false);
  assert.equal(missing.reason, "missing_completion_commit_id");
  const accepted = apply(processing(), finalizeRequest({ completionCommitId: "commit-1" }));
  assert.equal(accepted.applied, true, accepted.reason);
  assert.equal(accepted.lifecycle.turns[turnScopeId].finalizeIntent.commandId, "commit-1");
  assert.equal(accepted.lifecycle.turns[turnScopeId].completionCommitId, "");
});

test("non finalize-request events reject completionCommitId", () => {
  const requested = apply(processing(), finalizeRequest({ completionCommitId: "commit-1" }));
  const result = apply(requested.lifecycle, {
    ...completed("commit-1"),
    completionCommitId: "commit-1",
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "unexpected_completion_commit_id");
});

test("completion must use the committed finalize intent commandId", () => {
  const requested = apply(processing(), finalizeRequest({ completionCommitId: "commit-1" }));
  const conflict = apply(requested.lifecycle, completed("other-commit"));
  assert.equal(conflict.applied, false);
  assert.equal(conflict.reason, "completion_commit_id_conflict");
  const done = apply(requested.lifecycle, completed("commit-1"));
  assert.equal(done.applied, true, done.reason);
  assert.equal(done.lifecycle.turns[turnScopeId].completionCommitId, "commit-1");
  assert.equal(done.lifecycle.turns[turnScopeId].finalizeIntent, null);
});

test("completion without a finalize intent is rejected", () => {
  const result = apply(processing(), completed("commit-1"));
  assert.equal(result.applied, false);
  assert.equal(result.reason, "finalize_intent_missing");
});

test("non-retryable failure does not write completionCommitId", () => {
  const result = apply(processing(), {
    eventType: TURN_EVENT.FAILED,
    commandId: "failed",
    causationId: "failed",
    phase: TURN_PHASE.PROCESSING,
    failure: { code: "turn_failed", message: "turn failed", retryable: false },
    terminalStatus: { command: "error" },
  });
  assert.equal(result.applied, true, result.reason);
  assert.equal(result.lifecycle.turns[turnScopeId].completionCommitId, "");
});

test("finalize request replay with a different completionCommitId is an idempotency conflict", () => {
  const commit = (lifecycle, extra) =>
    commitTurnLifecycle({
      lifecycle,
      event: { turnScopeId, userId: "user-1", sessionId: "session-1", ...finalizeRequest(extra) },
      createEventId: () => "finalize-event-1",
      now: () => "2026-07-18T00:00:01.000Z",
    });
  const requested = commit(processing(), { completionCommitId: "commit-1" });
  assert.equal(requested.applied, true, requested.reason);
  const replay = commit(requested.lifecycle, { completionCommitId: "commit-1" });
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(replay.envelope, requested.envelope);
  const reused = commit(requested.lifecycle, { completionCommitId: "commit-2" });
  assert.equal(reused.applied, false);
  assert.equal(reused.reason, "idempotency_key_reused");
});

test("domain transition returns a receipt draft and never writes a placeholder receipt", () => {
  const requested = apply(processing(), finalizeRequest({ completionCommitId: "commit-1" }));
  assert.equal(requested.applied, true, requested.reason);
  assert.deepEqual(requested.lifecycle.commandReceipts, []);
  assert.equal(Object.hasOwn(requested.receiptDraft, "eventId"), false);
  assert.equal(Object.hasOwn(requested.receiptDraft, "envelope"), false);
});

test("an early-returning commit leaves no receipt behind", () => {
  const lifecycle = processing();
  const unavailable = commitTurnLifecycle({
    lifecycle,
    event: { turnScopeId, sessionId: "session-1", ...finalizeRequest({ completionCommitId: "c" }) },
    createEventId: () => "",
  });
  assert.equal(unavailable.applied, false);
  assert.equal(unavailable.reason, "event_id_unavailable");
  assert.deepEqual(unavailable.lifecycle.commandReceipts, []);
  const conflict = commitTurnLifecycle({
    lifecycle,
    event: { turnScopeId, sessionId: "session-1", ...finalizeRequest({ completionCommitId: "c" }) },
    createEventId: () => "used-event",
    isCommittedEventId: () => true,
  });
  assert.equal(conflict.reason, "event_id_conflict");
  assert.deepEqual(conflict.lifecycle.commandReceipts, []);
});
