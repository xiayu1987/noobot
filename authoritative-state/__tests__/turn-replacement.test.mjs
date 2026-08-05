/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnReplacementCommit } from "@noobot/session-protocol";
import { commitTurnLifecycle } from "../src/application/commit-turn-lifecycle.js";
import { commitTurnReplacement } from "../src/application/commit-turn-replacement.js";
import { createAuthoritativeTurnSnapshot } from "../src/application/authority-query-service.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol/turn-lifecycle";
import { transitionTurnLifecycle } from "../src/domain/turn-lifecycle-entity.js";

function acceptedTurn() {
  return commitTurnLifecycle({
    lifecycle: {},
    event: {
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      commandId: "send-old",
      sessionId: "session-1",
      turnScopeId: "turn-old",
      dialogProcessId: "dialog-old",
      messageId: "source-old",
      presentationMessageId: "presentation-old",
      action: "send",
      phase: TURN_PHASE.ACTION,
      expectedRevision: 0,
    },
    createEventId: () => "event-old",
    now: () => "2026-07-31T00:00:00.000Z",
  });
}

function replacement(commandId = "replace-old", replacementTurnScopeId = "turn-new") {
  return createTurnReplacementCommit({
    commandId,
    sessionId: "session-1",
    committedAggregateVersion: 2,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId,
    replacementUserMessageId: "user-new",
    committedAt: "2026-07-31T00:00:01.000Z",
  });
}

test("turn replacement atomically removes lifecycle projection and outbox state", () => {
  const accepted = acceptedTurn();
  assert.equal(accepted.applied, true);

  const committed = commitTurnReplacement({
    lifecycle: accepted.lifecycle,
    eventOutbox: accepted.eventOutbox,
    replacement: replacement(),
  });

  assert.equal(committed.applied, true);
  assert.equal(committed.lifecycle.sequence, 2);
  assert.deepEqual(committed.lifecycle.turns, {});
  assert.equal(committed.lifecycle.activeTurnScopeId, "");
  assert.deepEqual(committed.lifecycle.commandReceipts, []);
  assert.deepEqual(committed.eventOutbox, []);
  assert.deepEqual(committed.lifecycle.replacedTurns["turn-old"], {
    turnScopeId: "turn-old",
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageId: "user-new",
    commandId: "replace-old",
    committedAggregateVersion: 2,
    replacedTurnScopeIds: ["turn-old"],
    sequence: 2,
    committedAt: "2026-07-31T00:00:01.000Z",
  });
  const snapshot = createAuthoritativeTurnSnapshot({
    lifecycle: committed.lifecycle,
    sessionId: "session-1",
  });
  assert.equal(snapshot.activeTurn, null);
  assert.deepEqual(snapshot.recentTerminalTurns, []);
  assert.deepEqual(snapshot.replacedTurns, [committed.lifecycle.replacedTurns["turn-old"]]);
});

test("replaced Turn tombstone rejects delayed lifecycle events and replacement conflicts", () => {
  const accepted = acceptedTurn();
  const committed = commitTurnReplacement({
    lifecycle: accepted.lifecycle,
    eventOutbox: accepted.eventOutbox,
    replacement: replacement(),
  });
  const delayed = transitionTurnLifecycle(committed.lifecycle, {
    eventType: TURN_EVENT.PROCESSING_STARTED,
    commandId: "late-processing",
    turnScopeId: "turn-old",
    messageId: "source-old",
    presentationMessageId: "presentation-old",
    phase: TURN_PHASE.PROCESSING,
  });
  assert.equal(delayed.applied, false);
  assert.equal(delayed.reason, "turn_replaced");
  assert.equal(delayed.replacement.replacementTurnScopeId, "turn-new");

  const duplicate = commitTurnReplacement({
    lifecycle: committed.lifecycle,
    eventOutbox: committed.eventOutbox,
    replacement: replacement(),
  });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.lifecycle.sequence, 2);

  const conflict = commitTurnReplacement({
    lifecycle: committed.lifecycle,
    eventOutbox: committed.eventOutbox,
    replacement: replacement("replace-again", "turn-other"),
  });
  assert.equal(conflict.applied, false);
  assert.equal(conflict.reason, "turn_replacement_conflict");
});

test("turn replacement rejects partial or mutated replay of one command", () => {
  const firstCommit = createTurnReplacementCommit({
    commandId: "replace-many",
    sessionId: "session-1",
    committedAggregateVersion: 2,
    replacedTurnScopeIds: ["turn-old", "turn-tail"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageId: "user-new",
    committedAt: "2026-07-31T00:00:01.000Z",
  });
  const committed = commitTurnReplacement({
    lifecycle: acceptedTurn().lifecycle,
    replacement: firstCommit,
  });
  assert.equal(committed.applied, true);

  const partialReplay = commitTurnReplacement({
    lifecycle: committed.lifecycle,
    replacement: createTurnReplacementCommit({
      ...firstCommit,
      replacedTurnScopeIds: ["turn-old"],
    }),
  });
  assert.equal(partialReplay.applied, false);
  assert.equal(partialReplay.reason, "turn_replacement_conflict");

  const mutatedReplay = commitTurnReplacement({
    lifecycle: committed.lifecycle,
    replacement: createTurnReplacementCommit({
      ...firstCommit,
      replacementUserMessageId: "user-other",
    }),
  });
  assert.equal(mutatedReplay.applied, false);
  assert.equal(mutatedReplay.reason, "turn_replacement_conflict");
});

test("turn replacement removes the authoritative Continue edge when replacing its target", () => {
  const sourceAccepted = acceptedTurn();
  const sourceStopped = [
    {
      eventType: TURN_EVENT.PROCESSING_STARTED,
      commandId: "send-old-processing-started",
      turnScopeId: "turn-old",
      messageId: "source-old",
      presentationMessageId: "presentation-old",
      phase: TURN_PHASE.PROCESSING,
      executionState: "sending",
    },
    {
      eventType: TURN_EVENT.STOP_ACCEPTED,
      commandId: "stop-old",
      turnScopeId: "turn-old",
      messageId: "source-old",
      presentationMessageId: "presentation-old",
      phase: TURN_PHASE.ACTION,
    },
    {
      eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
      commandId: "stop-old-processing-completed",
      turnScopeId: "turn-old",
      messageId: "source-old",
      presentationMessageId: "presentation-old",
      phase: TURN_PHASE.STOP,
    },
    {
      eventType: TURN_EVENT.STOP_COMPLETED,
      commandId: "stop-old-completed",
      turnScopeId: "turn-old",
      messageId: "source-old",
      presentationMessageId: "presentation-old",
      phase: TURN_PHASE.STOP,
    },
  ].reduce((state, event) => transitionTurnLifecycle(state, event).lifecycle, sourceAccepted.lifecycle);
  const continued = transitionTurnLifecycle(sourceStopped, {
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    commandId: "continue-target",
    turnScopeId: "turn-target",
    messageId: "source-target",
    presentationMessageId: "presentation-target",
    dialogProcessId: "dialog-target",
    action: "continue",
    phase: TURN_PHASE.ACTION,
    continuationSource: {
      turnScopeId: "turn-old",
      dialogProcessId: sourceStopped.turns["turn-old"].dialogProcessId,
    },
  });
  assert.equal(continued.applied, true);
  assert.equal(continued.lifecycle.turns["turn-old"].continuedByTurnScopeId, "turn-target");

  const committed = commitTurnReplacement({
    lifecycle: continued.lifecycle,
    replacement: createTurnReplacementCommit({
      commandId: "replace-target",
      sessionId: "session-1",
      committedAggregateVersion: 3,
      replacedTurnScopeIds: ["turn-target"],
      replacementDialogProcessId: "dialog-replacement",
      replacementTurnScopeId: "turn-replacement",
      replacementUserMessageId: "user-replacement",
      committedAt: "2026-07-31T00:00:02.000Z",
    }),
  });

  assert.equal(committed.applied, true);
  assert.equal(committed.lifecycle.turns["turn-old"].continuedByTurnScopeId, "");
  assert.equal(committed.lifecycle.turns["turn-target"], undefined);
});

test("turn replacement rejects removing a Continue source while its target survives", () => {
  const lifecycle = {
    activeTurnScopeId: "turn-target",
    sequence: 2,
    turns: {
      "turn-old": {
        turnScopeId: "turn-old",
        state: "stop_completed",
        executionState: "user_stopped",
        continuedByTurnScopeId: "turn-target",
      },
      "turn-target": {
        turnScopeId: "turn-target",
        state: "processing",
        action: "continue",
        continuationSource: { turnScopeId: "turn-old", dialogProcessId: "dialog-old" },
      },
    },
  };
  const committed = commitTurnReplacement({
    lifecycle,
    replacement: replacement(),
  });

  assert.equal(committed.applied, false);
  assert.equal(committed.reason, "turn_replacement_breaks_continuation_source");
  assert.ok(committed.lifecycle.turns["turn-old"]);
  assert.ok(committed.lifecycle.turns["turn-target"]);
});
