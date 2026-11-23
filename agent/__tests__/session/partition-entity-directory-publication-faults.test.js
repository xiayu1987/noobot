/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { mkdir, readFile, writeFile, appendFile, stat, readdir, rm } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { partitionEntityUnpublishedSegmentBudget } from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { entityDirectoryPath } from "../../src/session/partition-storage/entity-directory-io.js";
import { journalOffsetsPath } from "../../src/session/partition-storage/journal-offsets.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";

for (const committed of [false, true]) {
  test(`entity directory recovery preserves committed prefix and survives interrupted cleanup (committed=${committed})`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t);
    const writer = new PartitionTransactions(journal);
    if (committed)
      await commitFixtureTransaction(writer, {
        epoch: journal.head.epoch,
        sequence: 1,
        expectedGeneration: 0,
        operationId: `test-operation-${0}`,
        input: { fixtureGeneration: 0 },
        mutations: [{ collection: "messages", key: "m1", owner: null, value: "kept" }],
        result: null,
      });
    const head = await journal.snapshot();
    const tail = entityDirectoryPath(root, head.entityDirectory.segment);
    await mkdir(path.dirname(tail), { recursive: true });
    const prefix = committed ? await readFile(tail) : Buffer.alloc(0);
    if (committed) await appendFile(tail, "unpublished");
    const first = head.entityDirectory.segment + (committed ? 1 : 0);
    const last = head.entityDirectory.segment + partitionEntityUnpublishedSegmentBudget(head);
    for (let segment = first; segment <= last; segment += 1)
      await writeFile(entityDirectoryPath(root, segment), "unpublished");
    const excess = entityDirectoryPath(root, last + 1);
    await writeFile(excess, "outside budget");
    const catalog = path.dirname(tail);
    const beforeRecovery = (await readdir(catalog)).sort();
    await assert.rejects(PartitionJournal.open({ root, sessionId }), {
      code: "SESSION_STORAGE_CORRUPT",
      message: "Unpublished entity directory exceeds its recoverable segment budget",
    });
    assert.deepEqual((await readdir(catalog)).sort(), beforeRecovery);
    await rm(excess);
    const adapter = getFsAdapter();
    let removals = 0;
    setFsAdapter({
      ...adapter,
      async rm(file, ...args) {
        if (String(file).endsWith(".pages")) {
          removals += 1;
          if (removals === 2)
            throw Object.assign(new Error("Interrupted cleanup"), { code: "EIO" });
        }
        return adapter.rm(file, ...args);
      },
    });
    try {
      await assert.rejects(PartitionJournal.open({ root, sessionId }), { code: "EIO" });
    } finally {
      setFsAdapter(adapter);
    }
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const reopened = await PartitionJournal.open({ root, sessionId });
      const reader = new PartitionTransactions(reopened);
      assert.deepEqual(await reopened.snapshot(), head);
      if (committed) {
        assert.deepEqual(await readFile(tail), prefix);
        assert.equal((await stat(tail)).size, head.entityDirectory.offset);
        const result = await reader.getLatestMany({
          snapshot: head,
          collection: "messages",
          keys: ["m1"],
        });
        assert.equal(result.get("m1").value, "kept");
      }
      assert.deepEqual(
        await readdir(catalog),
        committed ? [`${head.entityDirectory.segment}.pages`] : [],
      );
      await reopened.close();
    }
  });
}

test("directory read failure aborts the entire unpublished batch", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { batchRecords: 3 });
  const request = (sequence, mutations = []) => ({
    epoch: journal.head.epoch,
    sequence,
    expectedGeneration: sequence - 1,
    operationId: `test-operation-${sequence - 1}`,
    input: { fixtureGeneration: sequence - 1 },
    mutations,
    result: null,
  });
  const create = (key) => ({ collection: "messages", key, owner: null, value: key });
  const created = await commitFixtureTransaction(
    new PartitionTransactions(journal),
    request(1, [create("first")]),
  );
  const update = request(2, [
    { ...create("first"), owner: created.mutations[0].owner, value: "updated" },
  ]);
  const writer = await PartitionJournal.open({ root, sessionId });
  const transactions = new PartitionTransactions(writer);
  const adapter = getFsAdapter();
  const failure = Object.assign(new Error("Injected directory read failure"), { code: "EIO" });
  const before = await readFile(path.join(root, "CURRENT"));
  let outcomes;
  setFsAdapter({
    ...adapter,
    async open(file, flags, ...args) {
      if (flags === "r" && String(file).endsWith(".pages")) throw failure;
      return adapter.open(file, flags, ...args);
    },
  });
  try {
    const { epoch, expectedGeneration, operationId, input } = request(3);
    outcomes = await Promise.allSettled([
      commitFixtureTransaction(transactions, update),
      transactions.commit(
        { epoch, expectedGeneration, operationId, input },
        {
          validateScope: () => {},
          async prepare(snapshot, view) {
            assert.equal(snapshot.sequence, 1);
            const staged = await view.getLatestMany({ collection: "messages", keys: ["first"] });
            assert.equal(staged.get("first").mutation.value, "updated");
            return { action: "commit", mutations: [create("next")], result: null };
          },
        },
      ),
      commitFixtureTransaction(transactions, request(4, [create("last")])),
    ]);
  } finally {
    setFsAdapter(adapter);
  }
  assert.deepEqual(
    outcomes.map(({ status }) => status),
    ["rejected", "rejected", "rejected"],
  );
  const error = outcomes[0].reason;
  assert.equal(error, failure);
  assert.ok(outcomes.every(({ reason }) => reason === error));
  await assert.rejects(commitFixtureTransaction(transactions, update), (cause) => cause === error);
  await assert.rejects(writer.close(), (cause) => cause === error);
  assert.deepEqual(await readFile(path.join(root, "CURRENT")), before);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  assert.equal(reopened.head.sequence, 1);
  const retry = await commitFixtureTransaction(new PartitionTransactions(reopened), update);
  assert.equal(retry.replayed, false);
  assert.equal(retry.generation, 2);
});

for (const projection of [false, true]) {
  test(`${projection ? "deferred projection" : "batch commit"} cannot replace CURRENT after an in-flight read finds committed damage`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(
      t,
      { partitionRecords: 2, batchRecords: 2 },
      { autoClose: false },
    );
    const transactions = new PartitionTransactions(journal);
    const commit = (sequence, owner) =>
      commitFixtureTransaction(transactions, {
        epoch: journal.head.epoch,
        sequence,
        expectedGeneration: sequence - 1,
        operationId: `test-operation-${sequence - 1}`,
        input: { fixtureGeneration: sequence - 1 },
        mutations: [{ collection: "messages", key: "m", owner, value: sequence }],
        result: null,
      });
    const first = await commit(1, null);
    const { owner } = first.mutations[0];
    if (projection) await commit(2, owner);
    const snapshot = await journal.snapshot();
    assert.equal(snapshot.deferredEntityUpdates !== null, projection);
    const current = path.join(root, "CURRENT");
    const before = await readFile(current);
    const offsets = journalOffsetsPath(root, 0);
    const adapter = getFsAdapter();
    let damage;
    let renames = 0;
    setFsAdapter({
      ...adapter,
      async open(file, flags, ...args) {
        const handle = await adapter.open(file, flags, ...args);
        if (file === `${current}.publish.tmp` && flags === "wx") {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            await sync();
            const original = await readFile(offsets);
            const corrupt = Buffer.from(original);
            corrupt.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER), 0);
            await writeFile(offsets, corrupt);
            try {
              await assert.rejects(
                journal.readSequenceRecord({ snapshot, sequence: 1 }),
                (error) => {
                  damage = error;
                  return error.code === "SESSION_STORAGE_CORRUPT";
                },
              );
            } finally {
              await writeFile(offsets, original);
            }
          };
        }
        return handle;
      },
      async rename(source, target) {
        if (target === current) renames += 1;
        return adapter.rename(source, target);
      },
    });
    try {
      const writes = projection
        ? [transactions.projectLatestUpdates()]
        : [commit(2, owner), commit(3, owner)];
      const outcomes = await Promise.allSettled(writes);
      assert.ok(damage, "the retained reader ran during CURRENT staging");
      assert.equal(renames, 0);
      for (const outcome of outcomes) {
        assert.equal(outcome.status, "rejected");
        assert.equal(outcome.reason, damage);
      }
      await assert.rejects(journal.close(), (error) => error === damage);
    } finally {
      setFsAdapter(adapter);
      await journal.releaseSnapshot(snapshot);
    }
    assert.deepEqual(await readFile(current), before);
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    assert.equal(reopened.head.sequence, snapshot.sequence);
    assert.deepEqual(reopened.head.deferredEntityUpdates, snapshot.deferredEntityUpdates);
    await reopened.usingSnapshot(async (retained) => {
      const values = await new PartitionTransactions(reopened).getLatestMany({
        snapshot: retained,
        collection: "messages",
        keys: ["m"],
      });
      assert.equal(values.get("m").value, snapshot.sequence);
    });
  });
}

for (const boundary of ["page-sync", "before-current", "after-current"]) {
  test(`automatic projection reopens and retries after ${boundary} failure`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
    const writer = new PartitionTransactions(journal);
    const request = (sequence, owner, value) => ({
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `test-operation-${sequence - 1}`,
      input: { fixtureGeneration: sequence - 1 },
      mutations: [{ collection: "messages", key: "m", owner, value }],
      result: { value },
    });
    const created = await commitFixtureTransaction(writer, request(1, null, "original"));
    const update = request(2, created.mutations[0].owner, "updated");
    const committed = await commitFixtureTransaction(writer, update);
    const next = request(3, created.mutations[0].owner, "next");
    const other = await PartitionJournal.open({ root, sessionId });
    const projector = new PartitionTransactions(other);
    const adapter = getFsAdapter();
    const failure = Object.assign(new Error("Injected projection failure"), { code: "EIO" });
    await journal.usingSnapshot(async (pinned) => {
      setFsAdapter({
        ...adapter,
        async open(file, flags, ...args) {
          const handle = await adapter.open(file, flags, ...args);
          if (boundary === "page-sync" && file.endsWith(".pages") && flags !== "r")
            handle.sync = async () => {
              throw failure;
            };
          return handle;
        },
        async rename(source, target) {
          const current = target === path.join(root, "CURRENT");
          if (current && boundary === "before-current") throw failure;
          await adapter.rename(source, target);
          if (current && boundary === "after-current") throw failure;
        },
      });
      try {
        await assert.rejects(
          commitFixtureTransaction(projector, next),
          (error) => error === failure,
        );
        await assert.rejects(other.close(), (error) => error === failure);
      } finally {
        setFsAdapter(adapter);
      }
      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      const reader = new PartitionTransactions(reopened);
      const published = boundary === "after-current";
      assert.equal(reopened.head.sequence, 2);
      assert.deepEqual(reopened.head.entityDirectory.identities, pinned.entityDirectory.identities);
      assert.equal(reopened.head.deferredEntityUpdates === null, published);
      assert.deepEqual(await reader.projectLatestUpdates(), { sequence: 2, projected: !published });
      assert.deepEqual(await commitFixtureTransaction(reader, update), {
        ...committed,
        replayed: true,
      });
      const read = (transactions, snapshot) =>
        transactions.getLatestMany({ snapshot, collection: "messages", keys: ["m"] });
      await journal.usingSnapshot(async (latest) => {
        assert.equal(latest.deferredEntityUpdates, null);
        assert.notEqual(latest.entityDirectory.latestUpdates, null);
        assert.deepEqual(await read(writer, latest), await read(writer, pinned));
        assert.equal((await read(writer, latest)).get("m").value, "updated");
      });
      const recovered = await commitFixtureTransaction(reader, next);
      assert.equal(recovered.generation, 3);
      assert.equal(recovered.replayed, false);
      assert.deepEqual(await commitFixtureTransaction(reader, next), {
        ...recovered,
        replayed: true,
      });
      await reopened.usingSnapshot(async (latest) => {
        assert.equal((await read(reader, latest)).get("m").value, "next");
        assert.equal((await read(writer, pinned)).get("m").value, "updated");
      });
    });
  });
}

test("a projection failure rejects only the unpublished suffix of a batch", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(
    t,
    { partitionRecords: 2, batchRecords: 2 },
    { autoClose: false },
  );
  const writer = new PartitionTransactions(journal);
  const request = (sequence, owner) => ({
    epoch: journal.head.epoch,
    sequence,
    expectedGeneration: sequence - 1,
    operationId: `test-operation-${sequence - 1}`,
    input: { fixtureGeneration: sequence - 1 },
    mutations: [{ collection: "messages", key: "m", owner, value: sequence }],
    result: { sequence },
  });
  const created = await commitFixtureTransaction(writer, request(1, null));
  const { owner } = created.mutations[0];
  const prefix = request(2, owner);
  const suffix = request(3, owner);
  const adapter = getFsAdapter();
  const failure = Object.assign(new Error("Injected projection failure"), { code: "EIO" });
  const current = path.join(root, "CURRENT");
  let currentRenames = 0;
  let receipt;
  setFsAdapter({
    ...adapter,
    async rename(source, target) {
      if (target === current && ++currentRenames === 2) throw failure;
      await adapter.rename(source, target);
    },
  });
  try {
    const first = commitFixtureTransaction(writer, prefix);
    const second = commitFixtureTransaction(writer, suffix);
    [receipt] = await Promise.all([first, assert.rejects(second, (error) => error === failure)]);
    assert.equal(currentRenames, 2);
    assert.equal(receipt.generation, 2);
    assert.equal(receipt.replayed, false);
    await assert.rejects(journal.close(), (error) => error === failure);
  } finally {
    setFsAdapter(adapter);
  }

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  assert.equal(reopened.head.sequence, 2);
  assert.notEqual(reopened.head.deferredEntityUpdates, null);
  const reader = new PartitionTransactions(reopened);
  assert.deepEqual(await commitFixtureTransaction(reader, prefix), { ...receipt, replayed: true });
  const committed = await commitFixtureTransaction(reader, suffix);
  assert.equal(committed.generation, 3);
  assert.equal(committed.replayed, false);
});

for (const projection of [false, true]) {
  test(`recovery discards a real multi-segment ${projection ? "projection" : "commit"} suffix`, async (t) => {
    const options = { partitionBytes: 4096, partitionRecords: 2 };
    const { journal, root, sessionId } = await createTransactionCase(t, options);
    const initial = new PartitionTransactions(journal);
    const collection = "messages";
    const mutations = Array.from({ length: 24 }, (_, index) => ({
      collection,
      key: `message-${createHash("sha512").update(String(index)).digest("hex")}`,
      owner: null,
      value: "original",
    }));
    const request = (sequence, changes) => ({
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `test-operation-${sequence - 1}`,
      input: { fixtureGeneration: sequence - 1 },
      mutations: changes,
      result: null,
    });
    const created = await commitFixtureTransaction(initial, request(1, mutations));
    const update = request(
      2,
      (projection ? mutations.slice(0, -1) : mutations).map((mutation, index) =>
        projection
          ? { ...mutation, owner: created.mutations[index].owner, value: 1 }
          : { ...mutation, key: mutation.key.replace("message-", "new-") },
      ),
    );
    if (projection) await commitFixtureTransaction(initial, update);

    const writer = await PartitionJournal.open({ root, sessionId });
    const transactions = new PartitionTransactions(writer);
    const operation = (target) =>
      projection ? target.projectLatestUpdates() : commitFixtureTransaction(target, update);
    const catalog = path.join(root, "catalog");
    const current = path.join(root, "CURRENT");
    const failure = Object.assign(new Error("Injected publication failure"), { code: "EIO" });
    const adapter = getFsAdapter();
    await journal.usingSnapshot(async (pinned) => {
      const { segment, offset } = pinned.entityDirectory;
      const tail = entityDirectoryPath(root, segment);
      const prefix = await readFile(tail);
      const head = await readFile(current);
      const sealedFiles = (await readdir(catalog)).sort();
      assert.equal(prefix.length, offset);
      setFsAdapter({
        ...adapter,
        async rename(source, target) {
          if (target === current) throw failure;
          await adapter.rename(source, target);
        },
      });
      try {
        const expected = (error) =>
          projection
            ? error === failure
            : error.code === "SESSION_COMMIT_UNCERTAIN" && error.cause === failure;
        await assert.rejects(operation(transactions), expected);
        if (projection) await writer.close();
        else await assert.rejects(writer.close(), expected);
      } finally {
        setFsAdapter(adapter);
      }
      assert.deepEqual(await readFile(current), head);
      const successors = (await readdir(catalog)).filter((name) => !sealedFiles.includes(name));
      assert.ok(
        successors.some((name) => name.endsWith(".pages")),
        `must roll: committed=${offset}, unpublished=${(await stat(tail)).size - offset}`,
      );

      const probes = [];
      setFsAdapter({
        ...adapter,
        async stat(file, ...args) {
          if (path.dirname(file) === catalog && file.endsWith(".pages")) probes.push(file);
          return adapter.stat(file, ...args);
        },
      });
      let recovered;
      try {
        recovered = await PartitionJournal.open({ root, sessionId });
      } finally {
        setFsAdapter(adapter);
      }
      t.after(() => recovered.close());
      const segments = successors.filter((name) => name.endsWith(".pages")).length;
      assert.ok(segments <= partitionEntityUnpublishedSegmentBudget(pinned));
      assert.deepEqual(
        probes,
        Array.from({ length: segments + 1 }, (_, index) =>
          entityDirectoryPath(root, segment + index + 1),
        ),
      );
      assert.deepEqual(await readFile(tail), prefix);
      assert.deepEqual((await readdir(catalog)).sort(), sealedFiles);
      const again = await PartitionJournal.open({ root, sessionId });
      await again.close();

      const reader = new PartitionTransactions(recovered);
      const receipt = await operation(reader);
      const replay = await operation(reader);
      if (projection) {
        assert.deepEqual(receipt, { sequence: 2, projected: true });
        assert.deepEqual(replay, { sequence: 2, projected: false });
      } else {
        assert.equal(receipt.replayed, false);
        assert.deepEqual(replay, { ...receipt, replayed: true });
      }
      const key = update.mutations[0].key;
      await recovered.usingSnapshot(async (snapshot) => {
        const entries = await reader.getLatestMany({ snapshot, collection, keys: [key] });
        assert.equal(entries.get(key).value, update.mutations[0].value);
      });
      const previous = await initial.getLatestMany({ snapshot: pinned, collection, keys: [key] });
      assert.equal(previous.get(key)?.value, projection ? update.mutations[0].value : undefined);
    });
  });
}
