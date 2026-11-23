/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  committedAt,
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

function transition(sessionId) {
  return {
    ...scope,
    sessionId,
    commandId: "accept",
    causationId: "accept",
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    presentationMessageId: "presentation",
    executionId: "agent:turn-1",
    executionKind: "agent",
    rootExecutionId: "agent:turn-1",
  };
}

const timing = { ...scope, modelLoopRound: 1 };
const damageCases = [
  ["membership shape", "turns", () => null],
  ["membership count", "turns", (value) => ({ ...value, messageCount: 0 })],
  ["lifecycle shape", "lifecycle", () => null],
  ["lifecycle revision", "lifecycle", (value) => ({ ...value, revision: 0 })],
  ["lifecycle identity", "lifecycle", (value) => ({ ...value, turnScopeId: "other-turn" })],
  ["split ownership", "lifecycle", (value) => ({ ...value, dialogProcessId: "other-dialog" })],
  ["timing shape", "timings", () => null],
  ["timing identity", "timings", (value) => ({ ...value, turnScopeId: "other-turn" })],
  ["timing owner", "timings", (value) => ({ ...value, dialogProcessId: "other-dialog" })],
  [
    "timing normalization",
    "timings",
    (value) => ({ ...value, turnScopeId: ` ${value.turnScopeId}` }),
  ],
  ["timing fields", "timings", (value) => ({ ...value, unknown: true })],
];

for (const [name, collection, damage] of damageCases) {
  for (const operation of ["read", "write"]) {
    test(`cold timing ${operation} rejects corrupt ${name} without publication`, async (t) => {
      const { journal, sessionId, root } = await createMessageCase(
        t,
        { transactionBytes: 8 * 1024 },
        { autoClose: false },
      );
      const repository = openTestMessages(journal, sessionId);
      await repository.commit(
        await prepare(journal, repository, "seed", {
          messages: [message(sessionId, "seed")],
          turnTransition: transition(sessionId),
          timings: [timing],
        }),
      );
      const transactions = new PartitionTransactions(journal);
      await journal.usingSnapshot(async (snapshot) => {
        const query = { snapshot, collection, keys: [scope.turnScopeId] };
        const entry = (await transactions.lookupLatestMany(query)).get(scope.turnScopeId);
        const stored = (await transactions.getLatestMany(query)).get(scope.turnScopeId);
        await commitFixtureTransaction(transactions, {
          epoch: snapshot.epoch,
          expectedGeneration: snapshot.sequence,
          sequence: snapshot.sequence + 1,
          operationId: "damage",
          input: {},
          result: null,
          mutations: [
            { collection, key: scope.turnScopeId, owner: entry.owner, value: damage(stored.value) },
          ],
        });
      });
      await journal.close();
      const cold = await PartitionJournal.open({ root, sessionId });
      const reader = openTestMessages(cold, sessionId);
      const before = await readFile(`${root}/CURRENT`);
      if (operation === "read") {
        t.after(() => cold.close());
        await assert.rejects(
          cold.usingSnapshot((snapshot) =>
            reader.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }),
          ),
          { code: "SESSION_STORAGE_CORRUPT" },
        );
      } else {
        t.after(() => assert.rejects(cold.close(), { code: "SESSION_STORAGE_CORRUPT" }));
        await assert.rejects(
          reader.commit(
            await prepare(cold, reader, "update", {
              sessionMetadata: { customTitle: "must not publish" },
              timings: [{ ...scope, thinkingFinishedAt: committedAt }],
            }),
          ),
          { code: "SESSION_STORAGE_CORRUPT" },
        );
      }
      assert.deepEqual(await readFile(`${root}/CURRENT`), before);
    });
  }
}

test("timing ownership rejection isolates neighbors and retains old snapshots and cold receipts", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { batchWaitMs: 20 });
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "seed", { messages: [message(sessionId, "seed")] }),
  );
  const first = await prepare(journal, repository, "first", { timings: [timing] });
  const invalid = await prepare(journal, repository, "invalid", {
    sessionMetadata: { customTitle: "must not publish" },
    timings: [{ ...scope, dialogProcessId: "foreign", thinkingFinishedAt: committedAt }],
  });
  const last = await prepare(journal, repository, "last", {
    timings: [{ ...scope, thinkingFinishedAt: committedAt }],
  });
  let accepted;
  await journal.usingSnapshot(async (snapshot) => {
    accepted = await Promise.allSettled([
      repository.commit(first),
      repository.commit({ ...invalid, expectedGeneration: first.expectedGeneration + 1 }),
      repository.commit({ ...last, expectedGeneration: first.expectedGeneration + 1 }),
    ]);
    assert.deepEqual(
      accepted.map(({ status }) => status),
      ["fulfilled", "rejected", "fulfilled"],
      accepted.map(({ reason }) => reason?.stack).join("\n"),
    );
    assert.equal(accepted[1].reason.code, "SESSION_TURN_TIMING_CONFLICT");
    assert.equal(
      await repository.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }),
      null,
    );
  });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = openTestMessages(cold, sessionId);
  assert.deepEqual(await reader.commit(first), { ...accepted[0].value, replayed: true });
  await cold.usingSnapshot(async (snapshot) => {
    assert.deepEqual(await reader.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }), {
      ...timing,
      thinkingFinishedAt: committedAt,
    });
  });
});

for (const seed of ["messages", "turnTransition"]) {
  test(`timings accept same-request ${seed} ownership and merge after reopening`, async (t) => {
    const { journal, sessionId, root } = await createMessageCase(t);
    const repository = openTestMessages(journal, sessionId);
    const request = await prepare(journal, repository, "seed", {
      ...(seed === "messages"
        ? { messages: [message(sessionId, "seed")] }
        : { turnTransition: transition(sessionId) }),
      timings: [timing],
    });
    const committed = await repository.commit(request);
    await journal.close();
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    const reader = openTestMessages(cold, sessionId);
    assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
    await reader.commit(
      await prepare(cold, reader, "merge", {
        timings: [{ ...scope, thinkingFinishedAt: committedAt }],
      }),
    );
    await cold.usingSnapshot(async (snapshot) => {
      assert.deepEqual(await reader.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }), {
        ...timing,
        thinkingFinishedAt: committedAt,
      });
    });
  });
}

test("timing recreation retains its creation owner after a tombstone and cold reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "seed", {
      messages: [message(sessionId, "seed")],
      timings: [timing],
    }),
  );
  const transactions = new PartitionTransactions(journal);
  let owner;
  await journal.usingSnapshot(async (snapshot) => {
    owner = (
      await transactions.lookupLatestMany({
        snapshot,
        collection: "timings",
        keys: [scope.turnScopeId],
      })
    ).get(scope.turnScopeId).owner;
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "remove-timing",
      input: {},
      result: null,
      mutations: [{ collection: "timings", key: scope.turnScopeId, owner, remove: true }],
    });
    assert.deepEqual(
      await repository.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }),
      timing,
    );
  });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = openTestMessages(cold, sessionId);
  await cold.usingSnapshot(async (snapshot) => {
    assert.equal(await reader.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }), null);
  });
  const next = { ...scope, thinkingFinishedAt: committedAt };
  const request = await prepare(cold, reader, "recreate", { timings: [next] });
  const committed = await reader.commit(request);
  assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
  await cold.usingSnapshot(async (snapshot) => {
    assert.deepEqual(
      await reader.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }),
      next,
    );
    const entry = (
      await new PartitionTransactions(cold).lookupLatestMany({
        snapshot,
        collection: "timings",
        keys: [scope.turnScopeId],
      })
    ).get(scope.turnScopeId);
    assert.deepEqual(entry.owner, owner);
  });
});
