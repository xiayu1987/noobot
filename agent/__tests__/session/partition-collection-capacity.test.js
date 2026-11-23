/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  PARTITION_ENTITY_DIRECTORY,
  partitionEntityPageCapacity,
} from "@noobot/session-protocol/partition-entity-directory";
import {
  encodePartitionJournalFrameRequest,
  partitionEntityProjectionFits,
  partitionJournalReservedBytes,
  partitionJournalReservedInodes,
} from "@noobot/session-protocol/partition-journal";
import {
  encodeJournalFrame,
  publishJournalHead,
} from "../../src/session/partition-storage/journal-io.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
  encodeFixtureTransaction,
  journalTestLimits,
} from "../helpers/partition-journal-cases.js";

function input(epoch, sequence) {
  return {
    epoch,
    sequence,
    expectedGeneration: sequence - 1,
    operationId: `test-operation-${sequence - 1}`,
    input: { fixtureGeneration: sequence - 1 },
    mutations: [{ collection: "messages", key: `m${sequence}`, owner: null, value: sequence }],
    result: null,
  };
}

function firstCollectionFrameBytes(limits) {
  const request = encodeFixtureTransaction(input("0".repeat(32), 1), limits);
  const { body } = encodePartitionJournalFrameRequest(request, limits, "collections");
  return encodeJournalFrame(body).frame.length;
}

test("a receipt-only commit cannot exceed the partition quota", async (t) => {
  const { journal, root } = await createTransactionCase(t, {
    partitionRecords: 1,
    quotaPartitions: 1,
  });
  const writer = new PartitionTransactions(journal);
  const receipt = (sequence) => ({ ...input(journal.head.epoch, sequence), mutations: [] });
  await commitFixtureTransaction(writer, receipt(1));
  const current = path.join(root, "CURRENT");
  const before = await readFile(current);
  const { writeBytes, controlWriteBytes, publications } = journal.work;
  await assert.rejects(commitFixtureTransaction(writer, receipt(2)), {
    code: "SESSION_STORAGE_QUOTA",
  });
  assert.deepEqual(await readFile(current), before);
  assert.equal(journal.work.writeBytes, writeBytes);
  assert.equal(journal.work.controlWriteBytes, controlWriteBytes);
  assert.equal(journal.work.publications, publications);
  assert.equal((await commitFixtureTransaction(writer, receipt(1))).replayed, true);
});

function abortFixtureTransaction(
  writer,
  { epoch, expectedGeneration, operationId, input, result },
) {
  return writer.commit(
    { epoch, expectedGeneration, operationId, input },
    {
      validateScope: () => {},
      prepare: () => ({ action: "abort", result }),
    },
  );
}

for (const grouped of [false, true]) {
  test(`directory-only quota rejection is write-free and isolates batch state (grouped=${grouped})`, async (t) => {
    const limits = journalTestLimits();
    limits.quotaBytes = partitionJournalReservedBytes({
      publication: "collections",
      tail: { partition: 0 },
      dataBytes: firstCollectionFrameBytes(limits),
      sequence: 1,
      limits,
      entityDirectory: { segment: 0, bytes: 0 },
    });
    const { journal, root } = await createTransactionCase(t, limits);
    const writer = new PartitionTransactions(journal);
    const before = await readFile(path.join(root, "CURRENT"));
    const files = await readdir(root, { recursive: true });
    const writes = journal.work.writeBytes + journal.work.controlWriteBytes;
    const valid = input(journal.head.epoch, 1);
    if (grouped) {
      const outcomes = await Promise.allSettled([
        commitFixtureTransaction(writer, input(journal.head.epoch, 1)),
        abortFixtureTransaction(writer, valid),
      ]);
      assert.equal(outcomes[0].reason.code, "SESSION_STORAGE_QUOTA");
      assert.equal(outcomes[1].status, "fulfilled");
    } else {
      await assert.rejects(commitFixtureTransaction(writer, input(journal.head.epoch, 1)), {
        code: "SESSION_STORAGE_QUOTA",
      });
      await journal.startDrain();
      assert.equal(journal.work.writeBytes + journal.work.controlWriteBytes, writes);
      assert.deepEqual(await readFile(path.join(root, "CURRENT")), before);
      assert.deepEqual(await readdir(root, { recursive: true }), files);
      await abortFixtureTransaction(writer, valid);
    }
    assert.equal(journal.failure, null);
    assert.equal((await abortFixtureTransaction(writer, valid)).reference, null);
    assert.equal(journal.work.writeBytes + journal.work.controlWriteBytes, writes);
    const snapshot = await journal.snapshot();
    assert.equal(snapshot.sequence, 0);
    assert.equal(snapshot.entityDirectory.identities, null);
    assert.equal(snapshot.entityDirectory.latestUpdates, null);
    assert.equal(
      (await writer.lookupLatestMany({ snapshot, collection: "messages", keys: ["m1"] })).get("m1"),
      null,
    );
    await journal.releaseSnapshot(snapshot);
  });
}

for (const resource of ["bytes", "inodes"]) {
  test(`transaction ${resource} admission reserves sealed index before rollover`, async (t) => {
    const limits = journalTestLimits({ partitionRecords: 1 });
    const empty = {
      publication: "collections",
      tail: { partition: 0 },
      dataBytes: 0,
      sequence: 0,
      limits,
      entityDirectory: { segment: 0, bytes: 0 },
    };
    if (resource === "inodes") limits.quotaInodes = partitionJournalReservedInodes(empty);
    else
      limits.quotaBytes = partitionJournalReservedBytes({
        ...empty,
        dataBytes: firstCollectionFrameBytes(limits),
        sequence: 1,
        entityDirectory: { ...empty.entityDirectory, bytes: 1024 },
      });
    const { journal, root } = await createTransactionCase(t, limits);
    const transactions = new PartitionTransactions(journal);
    const first = input(journal.head.epoch, 1);
    await commitFixtureTransaction(transactions, first);
    await journal.startDrain();
    const current = await readFile(path.join(root, "CURRENT"));
    const files = await readdir(root, { recursive: true });
    const writes = journal.work.writeBytes + journal.work.controlWriteBytes;
    await assert.rejects(commitFixtureTransaction(transactions, input(journal.head.epoch, 2)), {
      code: "SESSION_STORAGE_QUOTA",
    });
    await journal.startDrain();
    assert.equal(journal.failure, null);
    assert.equal(journal.work.writeBytes + journal.work.controlWriteBytes, writes);
    assert.deepEqual(await readFile(path.join(root, "CURRENT")), current);
    assert.deepEqual(await readdir(root, { recursive: true }), files);
    assert.equal((await commitFixtureTransaction(transactions, first)).replayed, true);
  });
}

for (const [resource, reserved, quota] of [
  ["bytes", partitionJournalReservedBytes, "quotaBytes"],
  ["inodes", partitionJournalReservedInodes, "quotaInodes"],
]) {
  test(`repeated rollover preserves retained reads and replay under ${resource} backpressure`, async (t) => {
    const limits = journalTestLimits({ partitionRecords: 1, receiptRecords: 2 });
    const count = 6;
    const probe = await createTransactionCase(t, limits);
    const probeWriter = new PartitionTransactions(probe.journal);
    for (let sequence = 1; sequence <= count; sequence += 1)
      await commitFixtureTransaction(probeWriter, input(probe.journal.head.epoch, sequence));
    const fixture = await createTransactionCase(t, {
      ...limits,
      [quota]: reserved(probe.journal.head),
    });
    const { root, sessionId } = fixture;
    await fixture.journal.close();
    await publishJournalHead(fixture.journal, {
      ...fixture.journal.head,
      epoch: probe.journal.head.epoch,
    });
    const journal = await PartitionJournal.open({ root, sessionId });
    t.after(() => journal.close());
    const writer = new PartitionTransactions(journal);
    const request = (sequence) => input(journal.head.epoch, sequence);
    await commitFixtureTransaction(writer, request(1));
    const retained = await journal.snapshot();
    const current = path.join(root, "CURRENT");
    let before;
    let cold;
    try {
      for (let sequence = 2; sequence < count; sequence += 1)
        await commitFixtureTransaction(writer, request(sequence));
      const last = await commitFixtureTransaction(writer, request(count));
      assert.equal(journal.head.tail.partition, count - 1);
      assert.ok(journal.head.receiptStart.sequence > 1);
      await journal.startDrain();
      before = await readFile(current);
      const files = (await readdir(root, { recursive: true })).sort();
      await assert.rejects(commitFixtureTransaction(writer, request(count + 1)), {
        code: "SESSION_STORAGE_QUOTA",
      });
      await journal.close();
      cold = await PartitionJournal.open({ root, sessionId });
      t.after(() => cold.close());
      const reopened = new PartitionTransactions(cold);
      assert.deepEqual(await readFile(current), before);
      assert.deepEqual((await readdir(root, { recursive: true })).sort(), files);
      const read = (snapshot) =>
        reopened.getLatestMany({ snapshot, collection: "messages", keys: ["m1", `m${count}`] });
      const oldValues = await read(retained);
      assert.equal(oldValues.get("m1").value, 1);
      assert.equal(oldValues.get(`m${count}`), null);
      await cold.usingSnapshot(async (snapshot) => {
        const currentValues = await read(snapshot);
        assert.equal(currentValues.get("m1").value, 1);
        assert.equal(currentValues.get(`m${count}`).value, count);
      });
      const replay = await commitFixtureTransaction(reopened, request(count));
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.reference, last.reference);
      await assert.rejects(commitFixtureTransaction(reopened, request(1)), {
        code: "SESSION_REQUEST_EXPIRED",
      });
    } finally {
      await journal.releaseSnapshot(retained);
    }
    const reopened = new PartitionTransactions(cold);
    await assert.rejects(commitFixtureTransaction(reopened, request(count + 1)), {
      code: "SESSION_STORAGE_QUOTA",
    });
    assert.deepEqual(await readFile(current), before);
  });

  test(`projection publishes with the update when the ${resource} reservation would exceed quota`, async (t) => {
    const limits = journalTestLimits({ partitionBytes: 4096 });
    const probe = await createTransactionCase(t, limits);
    const writer = new PartitionTransactions(probe.journal);
    const sequence = 2;
    const update = (epoch, owner) => ({
      ...input(epoch, sequence),
      mutations: [{ collection: "messages", key: "m1", owner, value: sequence }],
    });
    const creation = await commitFixtureTransaction(writer, input(probe.journal.head.epoch, 1));
    await commitFixtureTransaction(
      writer,
      update(probe.journal.head.epoch, creation.mutations[0].owner),
    );
    const pending = probe.journal.head;
    const required = reserved(pending);
    assert.ok(required > reserved({ ...pending, deferredEntityUpdates: null }));
    await writer.projectLatestUpdates();
    await probe.journal.usingSnapshot((projected) => assert.ok(reserved(projected) <= required));
    const fixture = await createTransactionCase(t, { ...limits, [quota]: required - 1 });
    const { root, sessionId } = fixture;
    await fixture.journal.close();

    await publishJournalHead(fixture.journal, {
      ...fixture.journal.head,
      epoch: probe.journal.head.epoch,
    });
    const journal = await PartitionJournal.open({ root, sessionId });
    t.after(() => journal.close());
    const restricted = new PartitionTransactions(journal);
    const created = await commitFixtureTransaction(restricted, input(journal.head.epoch, 1));
    await journal.startDrain();
    const before = journal.work.publications;
    const request = update(journal.head.epoch, created.mutations[0].owner);
    const committed = await commitFixtureTransaction(restricted, request);
    assert.equal(journal.work.publications, before + 1);
    assert.equal(journal.head.deferredEntityUpdates, null);
    assert.ok(reserved(journal.head) <= required - 1);
    assert.notEqual(journal.head.entityDirectory.latestUpdates, null);
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const cold = new PartitionTransactions(reopened);
    await reopened.usingSnapshot(async (snapshot) => {
      const query = { snapshot, collection: "messages", keys: ["m1"] };
      assert.equal((await cold.getLatestMany(query)).get("m1").value, sequence);
    });
    assert.deepEqual(await commitFixtureTransaction(cold, request), {
      ...committed,
      replayed: true,
    });
  });
}

test("projection reserves the same extra capacity with the same root despite catalog growth", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const { epoch } = journal.head;
  const created = await commitFixtureTransaction(writer, input(epoch, 1));
  const { owner } = created.mutations[0];
  const update = (sequence) => ({
    ...input(epoch, sequence),
    mutations: [{ collection: "messages", key: "m1", owner, value: sequence }],
  });
  await commitFixtureTransaction(writer, update(2));
  await writer.projectLatestUpdates();
  await commitFixtureTransaction(writer, update(3));
  const pending = journal.head;
  for (let sequence = 4; sequence <= 20; sequence += 1)
    await commitFixtureTransaction(writer, input(epoch, sequence));
  const grown = journal.head;
  assert.ok(grown.entityDirectory.bytes > pending.entityDirectory.bytes);
  assert.deepEqual(grown.entityDirectory.latestUpdates, pending.entityDirectory.latestUpdates);
  assert.deepEqual(grown.deferredEntityUpdates, pending.deferredEntityUpdates);
  for (const reserved of [partitionJournalReservedBytes, partitionJournalReservedInodes]) {
    const extra = (head) => reserved(head) - reserved({ ...head, deferredEntityUpdates: null });
    assert.ok(extra(pending) > 0);
    assert.equal(extra(grown), extra(pending));
  }
});

for (const [resource, reserved, quota] of [
  ["bytes", partitionJournalReservedBytes, "quotaBytes"],
  ["inodes", partitionJournalReservedInodes, "quotaInodes"],
]) {
  test(`projection ${resource} backpressure without rollover resumes the queued commit`, async (t) => {
    const limits = journalTestLimits({ partitionBytes: 8192, pageBytes: 4096 });
    const capacity = partitionEntityPageCapacity(limits);
    const updatesAtBoundary = capacity - (PARTITION_ENTITY_DIRECTORY.maxEntries % capacity);
    const probe = await createTransactionCase(t, limits);
    const probeWriter = new PartitionTransactions(probe.journal);
    const probeEpoch = probe.journal.head.epoch;
    const creation = input(probeEpoch, 1);
    creation.mutations = Array.from({ length: updatesAtBoundary + 1 }, (_, slot) => ({
      ...creation.mutations[0],
      key: `m${slot + 1}`,
    }));
    const created = await commitFixtureTransaction(probeWriter, creation);
    const makeUpdate = (sequence, count) => ({
      ...input(probeEpoch, sequence),
      mutations: creation.mutations.slice(0, count).map((mutation, slot) => ({
        ...mutation,
        owner: created.mutations[slot].owner,
        value: sequence,
      })),
    });
    const seed = makeUpdate(2, 1);
    await commitFixtureTransaction(probeWriter, seed);
    await probeWriter.projectLatestUpdates();
    const update = makeUpdate(3, updatesAtBoundary);
    await commitFixtureTransaction(probeWriter, update);
    const next = makeUpdate(4, 1);
    const pending = probe.journal.head;
    assert.equal(pending.entityDirectory.latestUpdates.level, 0);
    await probeWriter.projectLatestUpdates();
    await commitFixtureTransaction(probeWriter, next);
    const projected = probe.journal.head;
    assert.equal(projected.tail.partition, pending.tail.partition);
    assert.ok(partitionEntityProjectionFits(pending.deferredEntityUpdates.start, projected));
    const cap = Math.max(reserved(pending), reserved(projected));
    assert.ok(
      reserved({
        ...projected,
        entityDirectory: pending.entityDirectory,
        deferredEntityUpdates: {
          ...pending.deferredEntityUpdates,
          mutationCount: pending.deferredEntityUpdates.mutationCount + next.mutations.length,
        },
      }) > cap,
    );

    const {
      root,
      sessionId,
      journal: fixture,
    } = await createTransactionCase(t, {
      ...limits,
      [quota]: cap,
    });
    await fixture.close();
    await publishJournalHead(fixture, { ...fixture.head, epoch: probeEpoch });
    const journal = await PartitionJournal.open({ root, sessionId });
    t.after(() => journal.close());
    const writer = new PartitionTransactions(journal);
    await commitFixtureTransaction(writer, creation);
    await commitFixtureTransaction(writer, seed);
    await writer.projectLatestUpdates();
    const outcomes = await Promise.allSettled([
      commitFixtureTransaction(writer, update),
      commitFixtureTransaction(writer, next),
      commitFixtureTransaction(writer, update),
    ]);
    assert.equal(outcomes[0].value.replayed, false);
    assert.equal(outcomes[1].value.replayed, false);
    assert.equal(outcomes[2].value.replayed, true);
    await journal.startDrain();
    await journal.usingSnapshot((head) => {
      assert.equal(head.sequence, 4);
      assert.equal(head.deferredEntityUpdates.start.sequence, 3);
      assert.equal(head.deferredEntityUpdates.mutationCount, next.mutations.length);
      assert.ok(reserved(head) <= cap);
    });
    assert.equal((await commitFixtureTransaction(writer, next)).replayed, true);
    assert.equal((await commitFixtureTransaction(writer, update)).replayed, true);
  });
}
