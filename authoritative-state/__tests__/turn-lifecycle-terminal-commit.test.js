/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { commitTurnLifecycle } from "../src/application/commit-turn-lifecycle.js";
import { turnRecord } from "./helpers/turn-record.js";

function pendingCompletion() {
  return {
    ...createEmptyTurnLifecycle(),
    sequence: 3,
    activeTurnScopeId: "turn-1",
    turns: {
      "turn-1": turnRecord({
        state: "completion_requesting",
        phase: "completion",
        revision: 3,
        sequence: 3,
        finalizeIntent: {
          type: "completion",
          commandId: "commit-1",
          retryable: true,
          createdAt: "2026-07-30T00:00:00.000Z",
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      }),
    },
  };
}

function options(overrides = {}) {
  return {
    lifecycle: pendingCompletion(),
    parentSessionId: "",
    event: {
      eventType: "turn.completed",
      phase: "completion",
      turnScopeId: "turn-1",
      commandId: "commit-1",
      causationId: "commit-1",
      sessionId: "session-1",
      terminalStatus: { command: "completed" },
    },
    createEventId: () => "event-1",
    now: () => "2026-07-30T00:00:01.000Z",
    materializeTerminal: ({ terminalStatus, previousSummaryVersion }) => ({
      materialized: true,
      terminalStatus,
      summaryVersion: previousSummaryVersion + 1,
      messages: [],
    }),
    ...overrides,
  };
}

test("terminal replay returns the original receipt without rematerializing at a later time", () => {
  const input = options();
  const before = structuredClone(input.lifecycle);
  const committed = commitTurnLifecycle(input);
  assert.equal(committed.applied, true);
  assert.deepEqual(input.lifecycle, before);
  const persisted = structuredClone(committed.lifecycle);
  const replay = commitTurnLifecycle({
    ...input,
    lifecycle: persisted,
    materializeTerminal: undefined,
    now: () => "2026-08-01T00:00:00.000Z",
    createEventId: () => assert.fail("replay must not allocate an event"),
  });
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(replay.envelope, committed.envelope);
  assert.equal(replay.committedEvent, null);
  assert.deepEqual(persisted, committed.lifecycle);
});

for (const [name, override, reason] of [
  ["missing event id", { createEventId: () => "" }, "event_id_unavailable"],
  ["conflicting event id", { isCommittedEventId: () => true }, "event_id_conflict"],
  ["missing materializer", { materializeTerminal: undefined }, "terminal_materializer_unavailable"],
]) {
  test(`terminal commit rejects ${name} before materialization`, () => {
    const input = options({
      materializeTerminal: () => assert.fail("must not materialize"),
      ...override,
    });
    const before = structuredClone(input.lifecycle);
    const result = commitTurnLifecycle(input);
    assert.equal(result.applied, false);
    assert.equal(result.reason, reason);
    assert.deepEqual(input.lifecycle, before);
  });
}

test("invalid envelope is rejected before terminal materialization", () => {
  const input = options({
    parentSessionId: null,
    materializeTerminal: () => assert.fail("must not materialize"),
  });
  const before = structuredClone(input.lifecycle);
  assert.throws(() => commitTurnLifecycle(input));
  assert.deepEqual(input.lifecycle, before);
});

for (const materializeTerminal of [
  () => ({ materialized: false, reason: "storage_rejected" }),
  ({ terminalStatus }) => ({ materialized: true, terminalStatus, summaryVersion: 2, messages: [] }),
  ({ terminalStatus }) => ({
    materialized: true,
    terminalStatus,
    summaryVersion: 1,
    messages: null,
  }),
]) {
  test("failed terminal materialization does not publish a lifecycle or receipt", () => {
    const input = options({ materializeTerminal });
    const before = structuredClone(input.lifecycle);
    const result = commitTurnLifecycle(input);
    assert.equal(result.applied, false);
    assert.equal(result.lifecycle, input.lifecycle);
    assert.equal(result.committedEvent, undefined);
    assert.deepEqual(input.lifecycle, before);
  });
}

test("materialization exceptions propagate without modifying the source lifecycle", () => {
  const failure = new Error("write failed");
  const input = options({
    materializeTerminal: () => {
      throw failure;
    },
  });
  const before = structuredClone(input.lifecycle);
  assert.throws(
    () => commitTurnLifecycle(input),
    (error) => error === failure,
  );
  assert.deepEqual(input.lifecycle, before);
});

for (const changes of [
  // finishedAt is written by the Authority at commit time; callers cannot supply it.
  { finishedAt: "2026-07-30T00:00:01.000Z" },
  { summaryVersion: "1" },
  { eventId: " event-1" },
  { eventId: undefined },
]) {
  test(`terminal admission rejects ${JSON.stringify(changes)} before any allocation`, () => {
    const input = options({
      now: () => assert.fail("invalid request must not allocate time"),
      createEventId: () => assert.fail("invalid request must not allocate event identity"),
      materializeTerminal: () => assert.fail("invalid request must not materialize"),
    });
    Object.assign(input.event, changes);
    const before = structuredClone(input.lifecycle);
    assert.equal(commitTurnLifecycle(input).applied, false);
    assert.deepEqual(input.lifecycle, before);
  });
}
