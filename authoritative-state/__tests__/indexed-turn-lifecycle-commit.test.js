/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { commitTurnLifecycle, commitIndexedTurnLifecycle } from "../src/index.js";
import { turnRecord } from "./helpers/turn-record.js";

const timestamp = "2026-07-30T00:00:01.000Z";
function fixture() {
  return {
    lifecycle: {
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
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        }),
      },
    },
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
    now: () => timestamp,
    createEventId: () => "event-1",
    materializeTerminal: ({ terminalStatus, previousSummaryVersion }) => ({
      materialized: true,
      terminalStatus,
      summaryVersion: previousSummaryVersion + 1,
      messages: [],
    }),
  };
}
function indexedOptions(options) {
  const { lifecycle, ...rest } = options;
  return {
    ...rest,
    header: { sequence: lifecycle.sequence, activeTurnScopeId: lifecycle.activeTurnScopeId },
    readTurn: async (key) => lifecycle.turns[key] ?? null,
    readReplacement: async (key) => lifecycle.replacedTurns[key] ?? null,
    readCommand: async (key) =>
      lifecycle.commandReceipts.find((item) => item.commandId === key) ?? null,
  };
}

test("asynchronous indexed terminal commit matches aggregate admission and replays the original envelope", async () => {
  const options = fixture();
  const before = structuredClone(options.lifecycle);
  const aggregate = commitTurnLifecycle(options);
  const order = [];
  const committed = await commitIndexedTurnLifecycle({
    ...indexedOptions(options),
    createEventId: async () => {
      order.push("allocate");
      return "event-1";
    },
    isCommittedEventId: async () => {
      order.push("conflict");
      return false;
    },
    materializeTerminal: async (input) => {
      order.push("materialize");
      return options.materializeTerminal(input);
    },
  });
  assert.deepEqual(order, ["allocate", "conflict", "materialize"]);
  assert.deepEqual(committed.turn, aggregate.turn);
  assert.deepEqual(committed.envelope, aggregate.envelope);
  assert.deepEqual(committed.commandReceipt, aggregate.lifecycle.commandReceipts[0]);
  assert.deepEqual(committed.terminalMaterialization, aggregate.terminalMaterialization);
  assert.deepEqual(committed.changedTurns, [aggregate.turn]);
  assert.deepEqual(options.lifecycle, before);
  const replay = await commitIndexedTurnLifecycle({
    ...indexedOptions({ ...options, lifecycle: aggregate.lifecycle }),
    readPreparedEvent: async (eventId) => {
      assert.equal(eventId, "event-1");
      return aggregate.committedEvent;
    },
    now: () => "2026-08-01T00:00:00.000Z",
    createEventId: () => assert.fail("replay allocated event identity"),
    materializeTerminal: () => assert.fail("replay materialized terminal"),
  });
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(replay.envelope, aggregate.envelope);
  assert.equal(replay.committedEvent, null);
  assert.deepEqual(replay.changedTurns, []);
});

test("asynchronous indexed failures preserve the source and stop before later effects", async () => {
  for (const [changes, reason] of [
    [{ isCommittedEventId: async () => true }, "event_id_conflict"],
    [{ materializeTerminal: undefined }, "terminal_materializer_unavailable"],
    [{ createEventId: async () => "" }, "event_id_unavailable"],
    [
      { materializeTerminal: async () => ({ materialized: false, reason: "rejected" }) },
      "rejected",
    ],
  ]) {
    const options = fixture();
    const before = structuredClone(options.lifecycle);
    const result = await commitIndexedTurnLifecycle({
      ...indexedOptions(options),
      materializeTerminal: () => assert.fail("admission did not stop materialization"),
      ...changes,
    });
    assert.equal(result.applied, false);
    assert.equal(result.reason, reason);
    assert.deepEqual(result.changedTurns, []);
    assert.deepEqual(options.lifecycle, before);
  }
  const options = fixture();
  const failure = new Error("async materialization failed");
  const before = structuredClone(options.lifecycle);
  await assert.rejects(
    commitIndexedTurnLifecycle({
      ...indexedOptions(options),
      materializeTerminal: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  assert.deepEqual(options.lifecycle, before);
});
