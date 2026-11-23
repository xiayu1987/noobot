/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { truncate } from "node:fs/promises";
import { test } from "node:test";
import { PartitionAdmissionRejection } from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";
import { request, createAt } from "./partition-transactions.test-helpers.js";

test("state, events and result publish once and replay identically after reopen", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  const input = request(journal, 1, [
    { collection: "messages", key: "m", owner: null, value: { content: "hello" } },
    { collection: "outbox", key: "event-1", owner: null, value: { type: "message-added" } },
  ]);
  const { epoch, expectedGeneration, operationId, input: original } = input;
  const retryRequest = { epoch, expectedGeneration, operationId, input: original };
  const replayOnly = {
    validateScope: () => {},
    prepare: () => assert.fail("Rejected or replayed requests must not prepare"),
  };
  const [first, concurrent] = await Promise.all([
    commitFixtureTransaction(transactions, input),
    transactions.commit(retryRequest, replayOnly),
  ]);
  assert.deepEqual(concurrent, { ...first, replayed: true });
  assert.equal(journal.work.publications, 2);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  const retry = await reader.commit(retryRequest, replayOnly);
  assert.deepEqual(retry, { ...first, replayed: true });
  assert.deepEqual(
    await commitFixtureTransaction(reader, { ...input, mutations: [], result: null }),
    retry,
  );
  await assert.rejects(reader.commit({ ...retryRequest, input: null }, replayOnly), {
    code: "SESSION_OPERATION_CONFLICT",
  });
  await assert.rejects(reader.commit({ ...retryRequest, operationId: "other" }, replayOnly), {
    code: "SESSION_OPERATION_CONFLICT",
  });
  assert.equal(reopened.work.publications, 0);
  assert.equal(reopened.work.writeBytes, 0);
  const snapshot = await reopened.snapshot();
  const transaction = await reader.read({ snapshot, reference: first.reference });
  assert.deepEqual(
    await reader.readGeneration({ snapshot, generation: first.generation }),
    transaction,
  );
  await assert.rejects(
    reader.readGeneration({ snapshot, generation: first.generation + 1 }),
    RangeError,
  );
  assert.deepEqual(transaction.mutations, input.mutations);
  assert.deepEqual(transaction.result, input.result);
  for (const mutation of first.mutations)
    assert.deepEqual(
      await reader.readEntity({ snapshot, ...mutation }),
      input.mutations.find(({ key }) => key === mutation.key),
    );
});

test("partition replay expires by sequence even when another retained receipt has the same operation ID", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { receiptRecords: 1 });
  const writer = new PartitionTransactions(journal);
  const first = createAt(journal, 1);
  const second = { ...createAt(journal, 2), operationId: first.operationId, input: first.input };
  await commitFixtureTransaction(writer, first);
  const committed = await commitFixtureTransaction(writer, second);
  assert.equal(committed.generation, 2);
  assert.equal(committed.replayed, false);
  await journal.close();

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  const callbacks = {
    validateScope: () => {},
    prepare: () => assert.fail("Replay and expiry must not prepare a transaction"),
  };
  const replay = ({ epoch, expectedGeneration, operationId, input }) =>
    reader.commit({ epoch, expectedGeneration, operationId, input }, callbacks);
  await assert.rejects(replay(first), { code: "SESSION_REQUEST_EXPIRED" });
  assert.deepEqual(await replay(second), { ...committed, replayed: true });
  assert.equal(reopened.work.publications, 0);
  assert.equal(reopened.work.writeBytes, 0);
});

test("transaction scope reads a lock-bound snapshot before replay or generation admission", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const original = request(journal, 1);
  const first = await commitFixtureTransaction(writer, original);
  const { epoch, expectedGeneration, operationId, input } = original;
  const retry = { epoch, expectedGeneration, operationId, input };
  const mustNotPrepare = () => assert.fail("Preparation must not run");
  const rejected = new PartitionAdmissionRejection("SESSION_SCOPE_DENIED", "Scope denied");
  let escaped;
  let validations = 0;
  const validateScope = async (snapshot) => {
    validations += 1;
    escaped = snapshot;
    const entries = await writer.getLatestMany({ snapshot, collection: "messages", keys: ["m"] });
    assert.equal(entries.get("m").value, "x");
  };
  const controlBytes = journal.work.controlWriteBytes;
  for (const submission of [retry, { ...retry, expectedGeneration: 7 }]) {
    await assert.rejects(
      writer.commit(submission, {
        validateScope: async (snapshot) => {
          await validateScope(snapshot);
          throw rejected;
        },
        prepare: mustNotPrepare,
      }),
      (error) => error === rejected,
    );
  }
  assert.deepEqual(await writer.commit(retry, { validateScope, prepare: mustNotPrepare }), {
    ...first,
    replayed: true,
  });
  const otherEpoch = epoch === "0".repeat(32) ? "1".repeat(32) : "0".repeat(32);
  await assert.rejects(
    writer.commit(
      { ...retry, epoch: otherEpoch },
      {
        validateScope,
        prepare: mustNotPrepare,
      },
    ),
    { code: "SESSION_REQUEST_EPOCH" },
  );
  assert.equal(validations, 4);
  assert.equal(journal.work.controlWriteBytes, controlBytes);
  await assert.rejects(writer.read({ snapshot: escaped, reference: first.reference }), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });
  const next = request(journal, 2, []);
  await writer.commit(
    { epoch, expectedGeneration: 1, operationId: next.operationId, input: next.input },
    {
      validateScope,
      prepare: async (snapshot) => {
        assert.equal(snapshot, escaped);
        const committed = await writer.read({ snapshot, reference: first.reference });
        assert.deepEqual(committed.result, first.result);
        return { action: "abort", result: next.result };
      },
    },
  );
});

for (const phase of ["validateScope", "prepare"]) {
  test(`an oversized collection query during ${phase} rejects only that request`, async (t) => {
    const { journal } = await createTransactionCase(t, {
      batchWaitMs: 20,
      pageBytes: 4096,
    });
    const writer = new PartitionTransactions(journal);
    for (const [index, key] of ["left", "right"].entries()) {
      await commitFixtureTransaction(
        writer,
        request(journal, index + 1, [
          { collection: "messages", key, owner: null, value: "x".repeat(2400) },
        ]),
      );
    }
    const { epoch, expectedGeneration, input } = request(journal, 3, []);
    const read = async (view, key) => {
      const found = await view.getLatestMany({ collection: "messages", keys: [key] });
      assert.equal(found.get(key).mutation.value.length, 2400);
    };
    const readOversized = (view) =>
      view.getLatestMany({ collection: "messages", keys: ["left", "right"] });
    const before = journal.work.publications;
    const valid = (operationId, expectedGeneration) =>
      writer.commit(
        { epoch, expectedGeneration, input, operationId },
        {
          validateScope: () => {},
          prepare: () => ({ action: "commit", mutations: [], result: null }),
        },
      );
    const [first, rejected, last] = await Promise.allSettled([
      valid("before-over-budget", expectedGeneration),
      writer.commit(
        { epoch, expectedGeneration: expectedGeneration + 1, input, operationId: "over-budget" },
        {
          validateScope: async (_snapshot, view) => {
            if (phase === "validateScope") await readOversized(view);
            else await read(view, "left");
          },
          prepare: async (_snapshot, view) => {
            assert.equal(phase, "prepare");
            await read(view, "right");
            await read(view, "left");

            await view.readWindow(1, (readPage) =>
              readPage({ collection: "messages", keys: ["left", "right"] }),
            );
          },
        },
      ),
      valid("after-over-budget", expectedGeneration + 1),
    ]);
    assert.equal(first.status, "fulfilled");
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.reason.code, "SESSION_QUERY_BUDGET");
    assert.match(rejected.reason.message, /read byte budget/);
    assert.equal(last.status, "fulfilled");
    assert.equal(last.value.generation, first.value.generation + 1);
    assert.equal(journal.work.publications - before, 1);
  });

  test(`published record damage during ${phase} aborts the batch before publication`, async (t) => {
    const { journal, root } = await createTransactionCase(
      t,
      { batchWaitMs: 20 },
      { autoClose: false },
    );
    const writer = new PartitionTransactions(journal);
    const first = await commitFixtureTransaction(writer, request(journal, 1));
    await truncate(journalPartitionPath(root, first.reference.partition), 1);
    const before = journal.work.publications;
    const { epoch, expectedGeneration, operationId, input } = request(journal, 3, []);
    const check = async (snapshot) => {
      await writer.read({ snapshot, reference: first.reference });
      assert.fail("A truncated committed record must not be readable");
    };
    const outcomes = await Promise.allSettled([
      commitFixtureTransaction(writer, createAt(journal, 2)),
      writer.commit(
        { epoch, expectedGeneration, operationId, input },
        {
          validateScope: () => {},
          prepare: () => ({ action: "abort", result: null }),
          [phase]: check,
        },
      ),
    ]);
    for (const outcome of outcomes) {
      assert.equal(outcome.status, "rejected");
      assert.equal(outcome.reason.code, "SESSION_STORAGE_CORRUPT");
    }
    assert.equal(journal.work.publications, before);
    assert.equal(journal.head.sequence, 1);
    await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
  });
}

test("a lock-bound snapshot drains in-flight reads even when preparation rejects", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const first = await commitFixtureTransaction(writer, request(journal, 1));
  const { epoch, expectedGeneration, operationId, input } = request(journal, 2, []);
  const denied = new PartitionAdmissionRejection("SESSION_SCOPE_DENIED", "Preparation denied");
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let reading;
  const outcome = assert.rejects(
    writer.commit(
      { epoch, expectedGeneration, operationId, input },
      {
        validateScope: () => {},
        prepare: (snapshot) => {
          reading = journal.withSnapshot(snapshot, async () => {
            started.resolve(snapshot);
            await resume.promise;
            return writer.read({ snapshot, reference: first.reference });
          });
          throw denied;
        },
      },
    ),
    (error) => error === denied,
  );
  const snapshot = await started.promise;
  let settled = false;
  const observed = outcome.finally(() => {
    settled = true;
  });
  const completed = Promise.all([reading, observed]);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(writer.read({ snapshot, reference: first.reference }), {
      code: "SESSION_SNAPSHOT_RELEASED",
    });
    assert.equal(settled, false);
  } finally {
    resume.resolve();
    const [transaction] = await completed;
    assert.deepEqual(transaction.result, first.result);
  }
  assert.equal(journal.head.sequence, first.generation);
});

test("cached and staged slots share the same collection result budget", async (t) => {
  const { journal } = await createTransactionCase(t, { batchWaitMs: 20, pageBytes: 4096 });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const seed = (sequence, key) =>
    commitFixtureTransaction(
      writer,
      request(journal, sequence, [{ collection, key, owner: null, value: "x".repeat(2400) }]),
    );
  await seed(1, "published");
  const { epoch, expectedGeneration, operationId, input } = request(journal, 3, []);
  const staged = seed(2, "staged");
  await assert.rejects(
    writer.commit(
      { epoch, expectedGeneration, operationId, input },
      {
        async validateScope(snapshot, view) {
          assert.equal(snapshot.sequence, 1);
          await view.getLatestMany({ collection, keys: ["published"] });
        },
        async prepare(_snapshot, view) {
          assert.equal(view.generation, 2);
          const stagedEntry = await view.getLatestMany({ collection, keys: ["staged"] });
          assert.equal(stagedEntry.get("staged").mutation.value.length, 2400);
          await view.getLatestMany({ collection, keys: ["published", "staged"] });
          assert.fail("Combined slots exceed the collection result budget");
        },
      },
    ),
    { code: "SESSION_QUERY_BUDGET", message: "Entity slots exceed result byte budget" },
  );
  assert.equal((await staged).generation, 2);
  assert.equal(journal.head.sequence, 2);
});

test("scope denial and transaction byte budget reject only their own requests", async (t) => {
  const { journal } = await createTransactionCase(t, { batchWaitMs: 20 });
  const writer = new PartitionTransactions(journal);
  const { epoch, expectedGeneration, operationId, input } = request(journal, 1, []);
  const identity = { epoch, expectedGeneration, operationId, input };
  const denied = new PartitionAdmissionRejection("SESSION_SCOPE_DENIED", "Scope denied");
  const before = journal.work.publications;
  const [scope, budget, valid] = await Promise.allSettled([
    writer.commit(identity, {
      validateScope: () => {
        throw denied;
      },
      prepare: () => assert.fail("A denied request must not prepare"),
    }),
    writer.commit(identity, {
      validateScope: () => {},
      prepare: () => ({
        action: "abort",
        result: "x".repeat(journal.head.limits.transactionBytes),
      }),
    }),
    commitFixtureTransaction(writer, request(journal, 1)),
  ]);
  assert.equal(scope.status, "rejected");
  assert.equal(scope.reason, denied);
  assert.equal(budget.status, "rejected");
  assert.ok(budget.reason instanceof PartitionAdmissionRejection);
  assert.equal(budget.reason.code, "SESSION_TRANSACTION_BUDGET");
  assert.equal(valid.status, "fulfilled", valid.reason?.stack);
  assert.equal(valid.value.generation, 1);
  assert.equal(journal.work.publications, before + 1);
});

test("invalid prepared output aborts the batch before writes", async (t) => {
  const { journal } = await createTransactionCase(t, { batchWaitMs: 20 }, { autoClose: false });
  const writer = new PartitionTransactions(journal);
  const { epoch, expectedGeneration, operationId, input } = request(journal, 2, []);
  const before = { ...journal.work };
  const outcomes = await Promise.allSettled([
    commitFixtureTransaction(writer, request(journal, 1)),
    writer.commit(
      { epoch, expectedGeneration, operationId, input },
      {
        validateScope: () => {},
        prepare: () => ({ mutations: [], result: null }),
      },
    ),
  ]);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "rejected");
    assert.match(outcome.reason.message, /Invalid prepared transaction fields/);
  }
  assert.equal(outcomes[0].reason, outcomes[1].reason);
  assert.equal(journal.head.sequence, 0);
  assert.equal(journal.work.writeBytes, before.writeBytes);
  assert.equal(journal.work.publications, before.publications);
  await assert.rejects(journal.close(), (error) => error === outcomes[0].reason);
});

test("scope validation reads published state while preparation sees accepted batch mutations", async (t) => {
  const { journal } = await createTransactionCase(t, { batchWaitMs: 20 });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const original = await commitFixtureTransaction(writer, request(journal, 1));
  const old = await journal.snapshot();
  const keys = ["fresh", "m", "rejected"];
  const submit = (sequence, label, prepare, validateScope = () => {}) =>
    writer.commit(
      {
        epoch: journal.head.epoch,
        expectedGeneration: sequence - 1,
        operationId: label,
        input: { label },
      },
      { validateScope, prepare },
    );
  let escaped;
  const before = journal.work.publications;
  const values = await Promise.allSettled([
    submit(2, "create", () => ({
      action: "commit",
      mutations: [
        { collection, key: "fresh", owner: null, value: "staged" },
        { collection, key: "m", owner: original.mutations[0].owner, remove: true },
      ],
      result: null,
    })),
    submit(3, "duplicate", () => ({
      action: "commit",
      mutations: [
        { collection, key: "rejected", owner: null, value: "never visible" },
        { collection, key: "m", owner: null, value: "duplicate" },
      ],
      result: null,
    })),
    submit(
      3,
      "update",
      async (snapshot, view) => {
        assert.equal(snapshot.sequence, 1);
        assert.equal(view.generation, 2);
        escaped = view;
        const read = await view.getLatestMany({ collection, keys });
        assert.deepEqual([...read.keys()], keys);
        assert.equal(read.get("fresh").mutation.value, "staged");
        assert.equal(read.get("m").mutation.remove, true);
        assert.deepEqual(read.get("m").owner, original.mutations[0].owner);
        assert.equal(read.get("rejected"), null);
        const { owner, mutation } = read.get("fresh");
        mutation.value = "cannot mutate the batch";
        const outside = await writer.getLatestMany({ snapshot: old, collection, keys });
        assert.equal(outside.get("fresh"), null);
        assert.equal(outside.get("m").value, "x");
        assert.equal(journal.work.publications, before);
        return {
          action: "commit",
          mutations: [{ collection, key: "fresh", owner, value: "final" }],
          result: null,
        };
      },
      async (_snapshot, view) => {
        assert.equal(view.generation, 1);
        const read = await view.getLatestMany({ collection, keys });
        assert.equal(read.get("fresh"), null);
        assert.equal(read.get("m").mutation.value, "x");
        assert.equal(read.get("rejected"), null);
      },
    ),
  ]);
  assert.equal(values[0].status, "fulfilled", values[0].reason?.stack);
  assert.equal(values[1].reason?.code, "SESSION_ENTITY_EXISTS");
  assert.equal(values[2].status, "fulfilled", values[2].reason?.stack);
  assert.equal(journal.work.publications, before + 1);
  await assert.rejects(escaped.getLatestMany({ collection, keys }), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });
  assert.equal(
    (
      await writer.read({
        snapshot: await journal.snapshot(),
        reference: values[0].value.reference,
      })
    ).mutations[0].value,
    "staged",
  );
  await journal.releaseSnapshot(old);
});

test("input mutation while commit is pending cannot change the durable outcome", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  const input = request(journal, 1);
  const pending = commitFixtureTransaction(transactions, input);
  input.mutations[0].value = "changed";
  input.result.accepted = false;
  const outcome = await pending;
  assert.deepEqual(outcome.result, { accepted: true });
  const stored = await transactions.read({
    snapshot: await journal.snapshot(),
    reference: outcome.reference,
  });
  assert.equal(stored.mutations[0].value, "x");
});

test("invalid mutations, discarded fields and generation mismatch fail before publication", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  const valid = request(journal, 1);
  const invalid = [
    { ...valid, unknown: undefined },
    { ...valid, operationId: "" },
    { ...valid, expectedGeneration: 2 },
  ];
  const invalidPrepared = [
    { ...valid, mutations: [...valid.mutations, ...valid.mutations] },
    { ...valid, mutations: [{ collection: "messages", key: "m", value: 1 }] },
    {
      ...valid,
      mutations: [{ collection: "messages", key: "m", owner: { record: {}, slot: 0 }, value: 1 }],
    },
    { ...valid, mutations: [{ collection: "unknown", key: "m", owner: null, value: 1 }] },
    {
      ...valid,
      mutations: [{ collection: "messages", key: "m", owner: null, value: 1, parts: [] }],
    },
    { ...valid, mutations: [{ collection: "messages", key: "m", owner: null, value: undefined }] },
    { ...valid, mutations: [{ collection: "messages", key: "m", owner: null, remove: false }] },
    { ...valid, result: { ignored: undefined } },
  ];
  const publications = journal.work.publications;
  for (const input of invalid) await assert.rejects(commitFixtureTransaction(transactions, input));
  for (const input of invalidPrepared) {
    const { journal: broken } = await createTransactionCase(t, {}, { autoClose: false });
    const writer = new PartitionTransactions(broken);
    const before = broken.work.publications;
    const pending = commitFixtureTransaction(writer, { ...input, epoch: broken.head.epoch });
    await assert.rejects(pending);
    await assert.rejects(broken.close());
    assert.equal(broken.head.sequence, 0);
    assert.equal(broken.work.publications, before);
  }
  assert.equal(journal.work.publications, publications);
  assert.equal((await journal.snapshot()).sequence, 0);
  await commitFixtureTransaction(transactions, valid);
});
