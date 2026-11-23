/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  createMessageCase,
  openTestMessages,
  prepare,
  message,
} from "./partition-session-messages.test-helpers.js";

async function fixture(t) {
  const state = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(state.journal, state.sessionId);
  const transition = async (turnScopeId, eventType, phase, extra = {}, messages = []) => {
    const commandId = `${turnScopeId}:${eventType}`;
    const outcome = await repository.commit(
      await prepare(state.journal, repository, commandId, {
        messages,
        turnTransition: {
          sessionId: state.sessionId,
          dialogProcessId: `dialog-${turnScopeId}`,
          turnScopeId,
          commandId,
          causationId: commandId,
          eventType,
          phase,
          ...extra,
        },
      }),
    );
    assert.equal(outcome.result.turnTransition.applied, true, outcome.result.turnTransition.reason);
    return outcome;
  };
  const start = async (id) =>
    transition(
      id,
      "turn.action_accepted",
      "action",
      {
        action: "send",
        presentationMessageId: `presentation-${id}`,
        executionId: `agent:${id}`,
        executionKind: "agent",
        rootExecutionId: `agent:${id}`,
      },
      [{ ...message(state.sessionId, id), turnScopeId: id, dialogProcessId: `dialog-${id}` }],
    );
  const finish = async (id) => {
    await start(id);
    await transition(id, "turn.processing_started", "processing");
    await transition(id, "turn.processing_completed", "completion", {
      completionCommitId: `${id}:completed`,
    });
    await transition(id, "turn.completed", "completion", {
      commandId: `${id}:completed`,
      terminalStatus: { command: "completed" },
    });
  };
  return { ...state, repository, start, finish };
}

const open = (journal, sessionId) =>
  openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });

test("terminal window keeps a fixed snapshot, includes active turn and retires deleted candidates", async (t) => {
  const { journal, sessionId, root, repository, start, finish } = await fixture(t);
  await finish("first");
  await finish("second");
  await using before = await open(journal, sessionId);
  const old = await before.readLifecycleSource({ terminalLimit: 1 });
  assert.deepEqual(Object.keys(old.turnLifecycle.turns), ["second"]);
  await start("active");
  await using current = await open(journal, sessionId);
  const latest = await current.readLifecycleSource({ terminalLimit: 1 });
  assert.deepEqual(Object.keys(latest.turnLifecycle.turns), ["second", "active"]);
  assert.deepEqual(latest.messageTurnScopeIds, ["second", "active"]);
  assert.deepEqual(await before.readLifecycleSource({ terminalLimit: 1 }), old);
  await assert.rejects(current.readLifecycleSource({ terminalLimit: 101 }), TypeError);
  await repository.commit(
    await prepare(journal, repository, "delete-second", {
      messageDeletion: { commandId: "delete-second", anchor: { turnScopeId: "second" } },
    }),
  );
  await current.close();
  await before.close();
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  await using reader = await open(cold, sessionId);
  const retained = await reader.readLifecycleSource({ terminalLimit: 10 });
  assert.deepEqual(Object.keys(retained.turnLifecycle.turns), ["first"]);
  assert.deepEqual(retained.messageTurnScopeIds, ["first"]);
});

test("terminal window rejects a missing index instead of scanning lifecycle", async (t) => {
  const { journal, sessionId, finish } = await fixture(t);
  await finish("first");
  const transactions = new PartitionTransactions(journal);
  const entity = await journal.usingSnapshot(async (snapshot) => {
    const entries = await transactions.lookupLatestMany({
      snapshot,
      collection: "metadata",
      keys: ["lifecycleIndex"],
    });
    return entries.get("lifecycleIndex");
  });
  await commitFixtureTransaction(transactions, {
    epoch: journal.head.epoch,
    expectedGeneration: journal.head.sequence,
    sequence: journal.head.sequence + 1,
    operationId: "corrupt-index",
    input: {},
    result: null,
    mutations: [
      { collection: "metadata", key: "lifecycleIndex", owner: entity.owner, remove: true },
    ],
  });
  await using reader = await open(journal, sessionId);
  await assert.rejects(reader.readLifecycleSource({ terminalLimit: 1 }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
});
