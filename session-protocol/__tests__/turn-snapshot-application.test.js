/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createTurnLifecycleSnapshot,
  decideTurnLifecycleSnapshotApplication,
} from "../src/index.js";
import { turnRecord } from "./helpers/turn-record.js";

const timestamp = "2026-07-30T00:00:00.000Z";
function snapshot(fields = {}) {
  return createTurnLifecycleSnapshot({
    sessionId: "session-1",
    commandId: "query-1",
    sequence: 10,
    activeTurnScopeId: "active",
    activeTurn: turnRecord({ sessionId: "session-1", turnScopeId: "active", sequence: 10 }),
    recentTerminalTurns: [],
    replacedTurns: [],
    unchanged: false,
    recovery: "none",
    generatedAt: timestamp,
    ...fields,
  });
}
function terminal(turnScopeId, sequence) {
  return turnRecord({
    sessionId: "session-1",
    turnScopeId,
    dialogProcessId: `dialog-${turnScopeId}`,
    sequence,
    state: "completed",
    phase: "completion",
    executionState: "completed",
    finishedAt: timestamp,
  });
}
function apply(source, previousObservation, currentSequence = previousObservation?.sequence ?? 0) {
  return decideTurnLifecycleSnapshotApplication({
    snapshot: source,
    previousObservation,
    currentSequence,
  });
}
function tombstone(turnScopeId) {
  return {
    turnScopeId,
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "new",
    replacementUserMessageUid: "user-new",
    requestHash: "replacement-hash",
    commandId: "replace-1",
    committedAggregateVersion: 4,
    replacedTurnScopeIds: [turnScopeId],
    sequence: 9,
    committedAt: timestamp,
  };
}

test("repeated queries compare lifecycle facts independently of request metadata and property order", () => {
  const initial = snapshot();
  const first = apply(initial);
  assert.equal(first.applied, true);
  const repeated = snapshot({
    commandId: "query-2",
    generatedAt: "2026-07-30T00:00:05.000Z",
    unchanged: true,
  });
  repeated.activeTurn = Object.fromEntries(Object.entries(repeated.activeTurn).reverse());
  assert.deepEqual(apply(repeated, first.observation), {
    applied: false,
    deduplicated: true,
    reason: "duplicate_snapshot",
  });
  assert.ok(Object.isFrozen(first.observation.turns[0]));
  initial.activeTurn.commandId = "mutated-caller-object";
  assert.deepEqual(apply(repeated, first.observation), {
    applied: false,
    deduplicated: true,
    reason: "duplicate_snapshot",
  });
});

test("the same sequence admits different terminal windows without accumulating history", () => {
  const wide = snapshot({ recentTerminalTurns: [terminal("newer", 8), terminal("older", 4)] });
  const first = apply(wide);
  const narrow = apply(
    snapshot({ recentTerminalTurns: [terminal("newer", 8)] }),
    first.observation,
  );
  assert.equal(narrow.applied, true);
  assert.equal(narrow.observation.turns.length, 2);
  const widened = apply(wide, narrow.observation);
  assert.equal(widened.applied, true);
  assert.equal(widened.observation.turns.length, 3);
  assert.equal(
    apply(
      { ...wide, recentTerminalTurns: [...wide.recentTerminalTurns].reverse() },
      widened.observation,
    ).deduplicated,
    true,
  );
});

test("shared entity conflicts and contradictory deletion evidence reject before application", () => {
  const first = apply(snapshot({ recentTerminalTurns: [terminal("old", 4)] }));
  const conflict = snapshot({
    recentTerminalTurns: [{ ...terminal("old", 4), commandId: "different-command" }],
  });
  assert.equal(apply(conflict, first.observation).reason, "snapshot_sequence_conflict");
  assert.equal(
    apply(snapshot({ activeTurn: null, activeTurnScopeId: "" }), first.observation).reason,
    "snapshot_sequence_conflict",
  );
  assert.equal(
    apply(snapshot({ replacedTurns: [tombstone("old")] }), first.observation).reason,
    "snapshot_sequence_conflict",
  );
  const removed = apply(snapshot({ replacedTurns: [tombstone("old")] }));
  assert.equal(
    apply(snapshot({ recentTerminalTurns: [terminal("old", 4)] }), removed.observation).reason,
    "snapshot_sequence_conflict",
  );
  const changed = tombstone("old");
  changed.requestHash = "other-hash";
  assert.equal(
    apply(snapshot({ replacedTurns: [changed] }), removed.observation).reason,
    "snapshot_sequence_conflict",
  );
});

test("independently committed timing may be added but cannot conflict or be erased", () => {
  const source = snapshot();
  const first = apply(source);
  const timed = snapshot({ activeTurn: { ...source.activeTurn, thinkingFinishedAt: timestamp } });
  const enriched = apply(timed, first.observation);
  assert.equal(enriched.applied, true);
  assert.equal(apply(source, enriched.observation).deduplicated, true);
  const conflict = snapshot({
    activeTurn: { ...source.activeTurn, thinkingFinishedAt: "2026-07-30T00:00:01.000Z" },
  });
  assert.equal(apply(conflict, enriched.observation).reason, "snapshot_sequence_conflict");
});

test("sequence, session ownership and malformed snapshot boundaries remain strict", () => {
  const first = apply(snapshot());
  assert.equal(apply(snapshot(), first.observation, 11).reason, "stale_snapshot");
  assert.equal(
    apply(snapshot(), { ...first.observation, sequence: 11 }, 10).reason,
    "stale_snapshot",
  );
  assert.throws(
    () => apply(snapshot(), { ...first.observation, sessionId: "other" }),
    /another session/,
  );
  for (const source of [null, {}, { ...snapshot(), commandId: "" }])
    assert.equal(apply(source).reason, "invalid_authoritative_snapshot");
  assert.throws(() => apply(snapshot(), undefined, -1), /observed lifecycle sequence/);
});
