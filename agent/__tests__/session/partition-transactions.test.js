/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { requirePartitionJournalHead } from "@noobot/session-protocol/partition-journal";
import { captureSessionTransactionInput } from "@noobot/session-protocol/session-changes";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
  directoryPageRead,
  observeDirectoryPageReads,
  wrapHandle,
} from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import { request, createAt } from "./partition-transactions.test-helpers.js";

test("invalid request epochs are rejected before scope validation, without entering the batch", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  let scopes = 0;
  await assert.rejects(
    writer.commit(
      { epoch: "invalid", expectedGeneration: 0, input: {}, operationId: "invalid-epoch" },
      {
        validateScope: () => {
          scopes += 1;
        },
        prepare: () => assert.fail("Malformed request reached preparation"),
      },
    ),
    TypeError,
  );
  assert.equal(scopes, 0);
  const result = await commitFixtureTransaction(writer, createAt(journal, 1));
  assert.equal(result.generation, 1);
});

test("aborted results write nothing and do not reserve a sequence or a receipt", async (t) => {
  const { journal, root } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const { epoch, expectedGeneration, input } = request(journal, 1);
  const identity = { epoch, expectedGeneration, input, operationId: "unchanged" };
  let preparations = 0;
  const callbacks = {
    validateScope: () => {},
    prepare: () => ({ action: "abort", result: { attempt: ++preparations } }),
  };
  const current = `${root}/CURRENT`;
  const before = await readFile(current);
  const { writeBytes, controlWriteBytes, dataSyncs, publications } = journal.work;
  const unchanged = (attempt) => ({
    status: "aborted",
    generation: 0,
    reference: null,
    replayed: false,
    result: { attempt },
    mutations: [],
  });
  assert.deepEqual(await writer.commit(identity, callbacks), unchanged(1));
  assert.deepEqual(await readFile(current), before);
  assert.equal(journal.work.writeBytes, writeBytes);
  assert.equal(journal.work.controlWriteBytes, controlWriteBytes);
  assert.equal(journal.work.dataSyncs, dataSyncs);
  assert.equal(journal.work.publications, publications);
  const [second, committed] = await Promise.all([
    writer.commit(identity, callbacks),
    commitFixtureTransaction(writer, request(journal, 1)),
  ]);
  assert.deepEqual(second, unchanged(2));
  assert.equal(committed.status, "committed");
  assert.equal(committed.generation, 1);
  await assert.rejects(writer.commit(identity, callbacks), { code: "SESSION_OPERATION_CONFLICT" });
  assert.equal(preparations, 2);
});

test("collection readers reuse decoded slots within a snapshot operation without sharing values", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const key = "m";
  const value = { nested: { text: "stored" } };
  const input = request(journal, 1, [{ collection, key, owner: null, value }]);
  const [created] = (await commitFixtureTransaction(writer, input)).mutations;
  const readRecordSlots = journal.readRecordSlots.bind(journal);
  let slotReads = 0;
  journal.readRecordSlots = (query) => {
    slotReads += 1;
    return readRecordSlots(query);
  };
  await journal.usingSnapshot(async (snapshot) => {
    await writer.withCollectionReader(snapshot, async (read) => {
      const query = { collection, keys: [key] };
      const first = (await read(query)).get(key);
      first.value.nested.text = "changed by caller";
      const second = (await read({ ...query, includeOwner: true })).get(key);
      assert.deepEqual(second.mutation.value, value);
      assert.deepEqual(second.owner, created.owner);
      second.owner.slot += 1;
      const third = (await read({ ...query, includeOwner: true })).get(key);
      assert.deepEqual(third.owner, created.owner);
      assert.equal(slotReads, 1);
    });
    await writer.withCollectionReader(snapshot, (read) => read({ collection, keys: [key] }));
    assert.equal(slotReads, 2);
  });
});

test("concurrent slot reads preserve key order and share the operation byte budget", async (t) => {
  const { journal, root } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  for (let sequence = 1; sequence <= 6; sequence += 1)
    await commitFixtureTransaction(writer, createAt(journal, sequence));

  await journal.usingSnapshot(async (snapshot) => {
    const keys = ["m6", "missing", "m4", "m2", "m5", "m1", "m3"];
    const query = { collection: "messages", keys };
    const read = (consumeReadBytes) =>
      writer.withCollectionReader(snapshot, (get) => get(query), { consumeReadBytes });
    let bytes = 0;
    const result = await read((size) => (bytes += size));
    assert.deepEqual(
      [...result].map(([key, mutation]) => [key, mutation === null ? null : mutation.value]),
      [
        ["m6", 6],
        ["missing", null],
        ["m4", 4],
        ["m2", 2],
        ["m5", 5],
        ["m1", 1],
        ["m3", 3],
      ],
    );

    const limit = bytes - 1;
    const failure = new Error("Operation budget exhausted");
    let admitted = 0;
    const { work } = await observeStorageIo(root, () =>
      assert.rejects(
        read((size) => {
          if (admitted + size > limit) throw failure;
          admitted += size;
        }),
        (error) => error === failure,
      ),
    );
    assert.ok(admitted > 0 && admitted <= limit);
    assert.ok(work.readBytes > 0 && work.readBytes <= admitted);
  });
});

test(
  "a damaged concurrent slot read drains its sibling before closing the scoped body",
  { timeout: 5000 },
  async (t) => {
    const { journal, root } = await createTransactionCase(t, {}, { autoClose: false });
    const writer = new PartitionTransactions(journal);
    const first = await commitFixtureTransaction(writer, createAt(journal, 1));
    const secondOffset = journal.head.tail.offset;
    await commitFixtureTransaction(writer, createAt(journal, 2));
    t.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));

    const file = journalPartitionPath(root, first.reference.partition);
    const slowStarted = Promise.withResolvers();
    const damagedRead = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const previous = getFsAdapter();
    const readsFinished = [];
    let closes = 0;
    setFsAdapter({
      ...previous,
      async open(path, flags, ...args) {
        const handle = await previous.open(path, flags, ...args);
        if (String(path) !== file || flags !== "r") return handle;
        return wrapHandle(handle, {
          async read(buffer, offset, length, position) {
            if (position === 0) {
              slowStarted.resolve();
              await resume.promise;
              readsFinished.push("slow");
            }
            if (position === secondOffset) {
              readsFinished.push("damaged");
              damagedRead.resolve();
              return { bytesRead: 0 };
            }
            return handle.read(buffer, offset, length, position);
          },
          async close() {
            closes += 1;
            await handle.close();
          },
        });
      },
    });
    const unpause = () => resume.resolve();
    t.signal.addEventListener("abort", unpause, { once: true });
    try {
      await journal.usingSnapshot(async (snapshot) => {
        let finished = false;
        const rejected = assert.rejects(
          writer.withCollectionReader(snapshot, async (read) => {
            try {
              await read({ collection: "messages", keys: ["m1", "m2"] });
            } finally {
              finished = true;
            }
          }),
          { code: "SESSION_STORAGE_CORRUPT", message: "Committed journal range is truncated" },
        );
        try {
          await Promise.race([Promise.all([slowStarted.promise, damagedRead.promise]), rejected]);
          assert.deepEqual(readsFinished, ["damaged"]);
          assert.equal(finished, false);
          assert.equal(closes, 0);
        } finally {
          unpause();
          await rejected;
        }
        assert.deepEqual(readsFinished, ["damaged", "slow"]);
        assert.equal(closes, 1);
      });
    } finally {
      t.signal.removeEventListener("abort", unpause);
      setFsAdapter(previous);
    }
  },
);

test("a scoped collection reader opens the journal body once for distinct slots and closes it on failure", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  await commitFixtureTransaction(
    writer,
    request(
      journal,
      1,
      ["a", "b"].map((key) => ({ collection, key, owner: null, value: key })),
    ),
  );
  const failure = new Error("reader callback failed");
  await journal.usingSnapshot(async (snapshot) => {
    const before = journal.work.partitionOpens;
    await assert.rejects(
      writer.withCollectionReader(snapshot, async (read) => {
        for (const key of ["a", "b"]) {
          assert.equal((await read({ collection, keys: [key] })).get(key).value, key);
        }
        throw failure;
      }),
      (error) => error === failure,
    );
    assert.equal(journal.work.partitionOpens - before, 1);
    await writer.withCollectionReader(snapshot, (read) => read({ collection, keys: ["b"] }));
    assert.equal(journal.work.partitionOpens - before, 2);
  });
});

test("commit scope validation and preparation reuse the journal body descriptor", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  await commitFixtureTransaction(
    writer,
    request(
      journal,
      1,
      ["a", "b"].map((key) => ({ collection, key, owner: null, value: key })),
    ),
  );
  const { epoch, expectedGeneration, input, operationId } = request(journal, 2);
  const requireValue = async (view, key) => {
    const entries = await view.getLatestMany({ collection, keys: [key] });
    assert.equal(entries.get(key).mutation.value, key);
  };
  const abort = (key) =>
    writer.commit(
      { epoch, expectedGeneration, input, operationId },
      {
        validateScope: (_, view) => requireValue(view, "a"),
        prepare: async (_, view) => {
          await requireValue(view, key);
          return { action: "abort", result: null };
        },
      },
    );
  const before = journal.work.partitionOpens;
  assert.equal((await abort("b")).status, "aborted");
  assert.equal(journal.work.partitionOpens - before, 1);
  assert.equal((await abort("b")).status, "aborted");
  assert.equal(journal.work.partitionOpens - before, 2);
});

test("snapshot readers hide committed removals without forgetting creation ownership", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const key = "removed-message";
  const [created] = (
    await commitFixtureTransaction(
      writer,
      request(journal, 1, [{ collection, key, owner: null, value: "original" }]),
    )
  ).mutations;
  const query = { collection, keys: [key] };
  await journal.usingSnapshot(async (before) => {
    await commitFixtureTransaction(
      writer,
      request(journal, 2, [{ collection, key, owner: created.owner, remove: true }]),
    );
    await journal.usingSnapshot((after) =>
      writer.withCollectionReader(after, async (read) => {
        assert.equal((await read(query)).get(key), null);
        assert.deepEqual((await read({ ...query, includeOwner: true })).get(key), {
          owner: created.owner,
          mutation: { collection, key, owner: created.owner, remove: true },
        });
      }),
    );
    await writer.withCollectionReader(before, async (read) => {
      assert.equal((await read(query)).get(key).value, "original");
    });
  });
});

test("creation-owner reads use the batch pre-state without loading journal slots", async (t) => {
  const { journal } = await createTransactionCase(t, { batchWaitMs: 20 });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const [published] = (await commitFixtureTransaction(writer, request(journal, 1))).mutations;
  const staged = createAt(journal, 2);
  const key = staged.mutations[0].key;
  const before = journal.work.publications;
  const readRecordSlots = journal.readRecordSlots.bind(journal);
  let slotReads = 0;
  journal.readRecordSlots = (query) => {
    slotReads += 1;
    return readRecordSlots(query);
  };
  const [created] = await Promise.all([
    commitFixtureTransaction(writer, staged),
    writer.commit(
      {
        epoch: journal.head.epoch,
        expectedGeneration: 2,
        operationId: "inspect-owners",
        input: {},
      },
      {
        validateScope: () => {},
        prepare: async (_snapshot, view) => {
          const query = { collection, keys: ["m", key, "missing"] };
          const owners = await view.getCreationOwners(query);
          assert.deepEqual(owners.get("m"), published.owner);
          assert.equal(owners.get(key).sequence, 2);
          assert.equal(owners.get("missing"), null);
          owners.get(key).sequence += 1;
          assert.equal((await view.getCreationOwners(query)).get(key).sequence, 2);
          assert.equal(slotReads, 0);
          return { action: "abort", result: null };
        },
      },
    ),
  ]);
  assert.equal(created.generation, 2);
  assert.equal(journal.work.publications, before + 1);
});

test("cold creation-owner reads do not open version directories or cache stale values", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const [created] = (await commitFixtureTransaction(writer, request(journal, 1))).mutations;
  await commitFixtureTransaction(
    writer,
    request(journal, 2, [{ collection, key: "m", owner: created.owner, value: "updated" }]),
  );
  await writer.projectLatestUpdates();
  await commitFixtureTransaction(writer, createAt(journal, 3));

  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = new PartitionTransactions(cold);
  await reader.commit(
    { epoch: cold.head.epoch, expectedGeneration: 3, operationId: "cold-owners", input: {} },
    {
      validateScope: () => {},
      prepare: async (snapshot, view) => {
        const query = { collection, keys: ["m", "missing"] };
        assert.notEqual(snapshot.entityDirectory.latestUpdates, null);
        const { reads } = await observeDirectoryPageReads(async () => {
          const owners = await view.getCreationOwners(query);
          assert.deepEqual(owners.get("m"), created.owner);
          assert.equal(owners.get("missing"), null);
        });
        assert.deepEqual(reads, [
          directoryPageRead(root, snapshot.entityDirectory.identities.position),
        ]);
        const latest = await view.getLatestMany(query);
        assert.equal(latest.get("m").mutation.value, "updated");
        assert.equal(latest.get("missing"), null);
        return { action: "abort", result: null };
      },
    },
  );
});

test("an active owner miss does not read the projected history directory", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const [created] = (await commitFixtureTransaction(writer, request(journal, 1))).mutations;
  await commitFixtureTransaction(
    writer,
    request(journal, 2, [{ collection, key: "m", owner: created.owner, value: "updated" }]),
  );
  await writer.projectLatestUpdates();
  const [active] = (await commitFixtureTransaction(writer, createAt(journal, 3))).mutations;

  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = new PartitionTransactions(cold);
  await cold.usingSnapshot(async (snapshot) => {
    assert.notEqual(snapshot.entityDirectory.latestUpdates, null);
    assert.equal(active.owner.partition, snapshot.tail.partition);
    const { reads } = await observeDirectoryPageReads(() =>
      assert.rejects(
        reader.getLatestByOwner({
          snapshot,
          collection,
          entities: [{ key: "m", owner: active.owner }],
        }),
        { code: "SESSION_STORAGE_IDENTITY" },
      ),
    );
    assert.deepEqual(reads, [
      directoryPageRead(root, snapshot.entityDirectory.activeCollection.position),
    ]);
    const latest = await reader.getLatestMany({ snapshot, collection, keys: ["m"] });
    assert.equal(latest.get("m").value, "updated");
  });
});

test("cold transaction reads share the latest cross-partition version after owner validation", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const key = "m";
  const [created] = (await commitFixtureTransaction(writer, request(journal, 1))).mutations;
  await commitFixtureTransaction(writer, createAt(journal, 2));
  const [other] = (await commitFixtureTransaction(writer, createAt(journal, 3))).mutations;
  await commitFixtureTransaction(
    writer,
    request(journal, 4, [{ collection, key, owner: created.owner, value: "updated" }]),
  );
  await writer.projectLatestUpdates();
  await commitFixtureTransaction(writer, createAt(journal, 5));
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = new PartitionTransactions(cold);
  const readRecordSlots = cold.readRecordSlots.bind(cold);
  const slotReads = [];
  cold.readRecordSlots = (query) => {
    slotReads.push(query.reference.sequence);
    return readRecordSlots(query);
  };
  const byOwner = (view, owner) =>
    view.getLatestByOwner({ collection, entities: [{ key, owner }] });
  const wrongOwner = { code: "SESSION_STORAGE_IDENTITY" };
  await reader.commit(
    { epoch: cold.head.epoch, expectedGeneration: 5, operationId: "cold-latest", input: {} },
    {
      validateScope: async (snapshot, view) => {
        assert.ok(snapshot.tail.partition > other.owner.partition);
        assert.ok(other.owner.partition > created.owner.partition);
        assert.notEqual(snapshot.entityDirectory.latestUpdates, null);
        await assert.rejects(byOwner(view, other.owner), wrongOwner);
        assert.deepEqual(slotReads, []);
        const first = (await byOwner(view, created.owner)).get(key);
        assert.equal(first.mutation.value, "updated");
        first.mutation.value = "changed by caller";
      },
      prepare: async (_snapshot, view) => {
        const { reads } = await observeDirectoryPageReads(async () => {
          await assert.rejects(byOwner(view, other.owner), wrongOwner);
          const latest = (await view.getLatestMany({ collection, keys: [key] })).get(key);
          assert.deepEqual(latest.owner, created.owner);
          assert.equal(latest.mutation.value, "updated");
        });
        assert.deepEqual(reads, []);
        assert.deepEqual(slotReads, [4]);
        return { action: "abort", result: null };
      },
    },
  );
});

for (const budget of ["entityProjectionRecords", "entityProjectionBytes"]) {
  test(`entity projection automatically drains after ${budget} backpressure on cold reopen`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, {
      [budget]: budget === "entityProjectionRecords" ? 2 : 4096,
    });
    const writer = new PartitionTransactions(journal);
    const collection = "messages";
    const [created] = (await commitFixtureTransaction(writer, request(journal, 1))).mutations;
    const input = (target, sequence, key, owner, value) =>
      request(target, sequence, [{ collection, key, owner, value }]);
    const first = "a".repeat(1450);
    await commitFixtureTransaction(writer, input(journal, 2, "m", created.owner, first));
    await commitFixtureTransaction(writer, input(journal, 3, "other", null, "b".repeat(1450)));
    await journal.usingSnapshot(async (old) => {
      assert.deepEqual(old.deferredEntityUpdates, {
        start: old.deferredEntityUpdates.start,
        mutationCount: 1,
      });
      assert.equal(old.deferredEntityUpdates.start.sequence, 1);
      const invalid = structuredClone(old);
      invalid.limits[budget] =
        budget === "entityProjectionRecords" ? 1 : old.limits.transactionBytes;
      if (budget === "entityProjectionBytes") {
        invalid.limits.transactionBytes = 2048;
        invalid.limits.entityProjectionBytes = 2048;
      }
      assert.throws(() => requirePartitionJournalHead(invalid), /Invalid deferred entity update/);

      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      const cold = new PartitionTransactions(reopened);
      const next = input(reopened, 4, "last", null, "c".repeat(1600));
      const publications = reopened.work.publications;
      assert.equal((await commitFixtureTransaction(cold, next)).replayed, false);
      assert.equal(reopened.work.publications, publications + 2);
      await journal.usingSnapshot(async (projected) => {
        assert.equal(projected.sequence, old.sequence + 1);
        assert.notEqual(projected.entityDirectory.latestUpdates, null);
        assert.equal(projected.deferredEntityUpdates, null);
      });
      const read = async (reader, snapshot) =>
        (await reader.getLatestMany({ snapshot, collection, keys: ["m"] })).get("m").value;
      assert.equal(await read(writer, old), first);
      await reopened.usingSnapshot(async (snapshot) => {
        assert.equal(snapshot.tail.partition, old.tail.partition);
        assert.equal(snapshot.deferredEntityUpdates, null);
        assert.equal(await read(cold, snapshot), first);
      });
    });
  });
}

test("scope validation and preparation use the same bounded request captured before enqueue", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const submission = {
    epoch: journal.head.epoch,
    expectedGeneration: 0,
    operationId: "captured-input",
    input: { message: { content: "original" } },
  };
  const retry = structuredClone(submission);
  let validated;
  const pending = writer.commit(submission, {
    validateScope: (_snapshot, _view, input) => {
      validated = input;
      assert.equal(input.message.content, "original");
      assert.ok(Object.isFrozen(input.message));
    },
    prepare: (_snapshot, _view, input) => {
      assert.equal(input, validated);
      return {
        action: "commit",
        mutations: [{ collection: "messages", key: "m", owner: null, value: input.message }],
        result: input.message,
      };
    },
  });
  submission.input.message.content = "changed";
  const outcome = await pending;
  assert.deepEqual(outcome.result, retry.input.message);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  const callbacks = {
    validateScope: () => {},
    prepare: () => assert.fail("Replay or rejected input must not prepare"),
  };
  assert.deepEqual(await reader.commit(retry, callbacks), { ...outcome, replayed: true });
  await assert.rejects(reader.commit(submission, callbacks), {
    code: "SESSION_OPERATION_CONFLICT",
  });
  const oversized = { content: "x".repeat(reopened.head.limits.transactionBytes) };
  for (const input of [oversized, captureSessionTransactionInput(oversized)]) {
    await assert.rejects(reader.commit({ ...retry, input }, callbacks), {
      code: "SESSION_TRANSACTION_BUDGET",
    });
  }
  assert.equal(reopened.work.publications, 0);
});

test("business commit preparation enforces the byte budget during initial capture", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const before = journal.work.publications;
  await journal.usingSnapshot(async (snapshot) => {
    const command = {
      operationId: "oversized-capture",
      changes: {
        content: "x".repeat(snapshot.limits.transactionBytes),
        unvisited: undefined,
      },
      committedAt: "2026-11-19T00:00:00.000Z",
    };
    await assert.rejects(writer.prepareRequest(snapshot, command), {
      code: "SESSION_TRANSACTION_BUDGET",
    });
    command.changes.content = "short";
    await assert.rejects(writer.prepareRequest(snapshot, command), /finite JSON values/);
  });
  assert.equal(journal.work.publications, before);
});

test("business commit preparation preserves the original epoch, generation and replay identity", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const otherJournal = await PartitionJournal.open({ root, sessionId });
  t.after(() => otherJournal.close());
  const other = new PartitionTransactions(otherJournal);
  await commitFixtureTransaction(other, createAt(otherJournal, 1));
  assert.equal(journal.head.sequence, 0);

  const snapshot = await journal.snapshot();
  const command = {
    operationId: "snapshot-request",
    changes: { messages: [{ messageUid: "m2", content: "original" }] },
    committedAt: "2026-11-19T00:00:00.000Z",
  };
  const original = structuredClone(command);
  const { epoch } = snapshot;
  const foreignEpoch = `${epoch[0] === "0" ? "1" : "0"}${epoch.slice(1)}`;
  await assert.rejects(writer.prepareRequest(snapshot, { ...command, epoch }), TypeError);
  await assert.rejects(
    writer.prepareRequest(snapshot, { ...command, expectedGeneration: snapshot.sequence }),
    TypeError,
  );
  const unvalidated = await writer.prepareRequest(snapshot, { ...command, changes: {} });
  assert.deepEqual(unvalidated.input.changes, {});
  const pending = writer.prepareRequest(snapshot, command);
  command.operationId = "changed-operation";
  command.changes.messages[0].content = "changed";
  const submission = await pending;
  assert.equal(submission.epoch, snapshot.epoch);
  assert.equal(submission.expectedGeneration, snapshot.sequence);
  assert.equal(submission.operationId, original.operationId);
  assert.ok(Object.isFrozen(submission.input.changes.messages[0]));
  const transported = JSON.parse(JSON.stringify(submission));
  await journal.releaseSnapshot(snapshot);
  await assert.rejects(writer.prepareRequest(snapshot, command), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });

  const outcome = await writer.commit(submission, {
    validateScope: () => {},
    prepare: (_snapshot, _view, input) => ({
      action: "commit",
      mutations: [{ collection: "messages", key: "m2", owner: null, value: input }],
      result: input,
    }),
  });
  assert.equal(outcome.generation, 2);
  assert.deepEqual(outcome.result, {
    changes: original.changes,
    committedAt: original.committedAt,
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (latest) => {
    assert.equal(latest.sequence, 2);
    await assert.rejects(reader.prepareRequest(latest, transported), TypeError);
  });
  assert.deepEqual(
    await reader.commit(transported, {
      validateScope: () => {},
      prepare: () => assert.fail("Replay must return the persisted result"),
    }),
    { ...outcome, replayed: true },
  );
  await assert.rejects(
    reader.commit(
      { ...transported, epoch: foreignEpoch },
      {
        validateScope: () => {},
        prepare: () => assert.fail("Foreign epoch must not reach preparation"),
      },
    ),
    { code: "SESSION_REQUEST_EPOCH" },
  );
  assert.equal(reopened.work.publications, 0);
});
