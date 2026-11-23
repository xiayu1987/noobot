/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  createPartitionHistoricalOperationMutation,
  partitionEntityKey,
  partitionHistoricalOperationAddress,
} from "@noobot/session-protocol/partition-transaction";
import { requirePartitionJournalHead } from "@noobot/session-protocol/partition-journal";
import { partitionHistoricalDirectorySlot } from "@noobot/session-protocol/partition-entity-directory";
import { readEntityDirectoryNode } from "../../src/session/partition-storage/entity-directory-io.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { lookupPartitionHistoricalOperation } from "../../src/session/partition-storage/partition-entity-directory.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
  directoryPageRead,
  observeDirectoryPageReads,
} from "../helpers/partition-journal-cases.js";
import { createAt } from "./partition-transactions.test-helpers.js";

function evidence(index) {
  return {
    format: "noobot.immutable-migration-operation/1",
    operationId: `imported-operation-${index}`,
    receipt: {
      generation: index + 1,
      commit: "a".repeat(64),
      digest: "b".repeat(64),
      result: null,
    },
  };
}

function historicalIdentity(index) {
  const { collection, key } = partitionHistoricalOperationAddress(evidence(index).operationId);
  return partitionEntityKey(collection, key);
}

test("one publication writes a shared historical branch once across distinct leaves", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  function request(index, sequence) {
    const operation = evidence(index);
    return {
      ...createAt(journal, sequence),
      operationId: operation.operationId,
      mutations: [createPartitionHistoricalOperationMutation(operation)],
    };
  }
  const seeded = 5;
  for (let index = 0; index < seeded; index += 1)
    await commitFixtureTransaction(writer, request(index, index + 1));

  const before = journal.head;
  const oldRoot = before.entityDirectory.historicalOperations;
  assert.equal(oldRoot.level, 1);
  const oldBranch = await readEntityDirectoryNode(journal, before, oldRoot.position);
  const oldPositions = new Map(oldBranch.entries);
  const bySlot = new Map();
  for (let index = seeded; index < seeded + 256 && bySlot.size < 2; index += 1) {
    const slot = partitionHistoricalDirectorySlot(historicalIdentity(index), "");
    if (!oldPositions.has(slot)) bySlot.set(slot, index);
  }
  assert.equal(bySlot.size, 2);
  const requests = [...bySlot.values()].map((index, slot) => request(index, seeded + slot + 1));
  const branchBytesBefore = journal.work.entityDirectoryWriteBytesByLevel[1];
  await Promise.all(requests.map((item) => commitFixtureTransaction(writer, item)));
  const after = journal.head;
  const newRoot = after.entityDirectory.historicalOperations;
  assert.equal(newRoot.level, 1);
  const newBranch = await readEntityDirectoryNode(journal, after, newRoot.position);
  const newPositions = new Map(newBranch.entries);
  assert.equal(newPositions.size, oldPositions.size + bySlot.size);
  for (const [slot, position] of oldPositions) assert.deepEqual(newPositions.get(slot), position);
  for (const slot of bySlot.keys()) assert.ok(newPositions.has(slot));
  assert.equal(
    journal.work.entityDirectoryWriteBytesByLevel[1] - branchBytesBefore,
    newRoot.position.bytes,
  );

  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  assert.deepEqual(cold.head.entityDirectory.historicalOperations, newRoot);
  const target = new PartitionTransactions(cold);
  const bytesBeforeReplay = cold.work.writeBytes;
  for (const item of requests) {
    const { key } = partitionHistoricalOperationAddress(item.operationId);
    const entry = await lookupPartitionHistoricalOperation(cold, cold.head, key);
    assert.equal(entry.reference.record.sequence, item.sequence);
    const replay = await commitFixtureTransaction(target, item);
    assert.equal(replay.generation, item.sequence);
  }
  assert.equal(cold.work.writeBytes, bytesBeforeReplay);
  assert.equal(cold.head.sequence, seeded + requests.length);
});

test("historical admission reads its own split directory after cold open, not global identities", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    partitionRecords: 2,
    receiptRecords: 1,
    pageBytes: 4096,
  });
  const writer = new PartitionTransactions(journal);
  const historyCount = 48;
  for (let index = 0; index < historyCount; index += 1) {
    const operation = evidence(index);
    await commitFixtureTransaction(writer, {
      ...createAt(journal, index + 1),
      operationId: operation.operationId,
      mutations: [createPartitionHistoricalOperationMutation(operation)],
    });
  }
  assert.equal(journal.head.entityDirectory.identities, null);
  assert.equal(journal.head.entityDirectory.activeCollection, null);
  const pinnedRoot = structuredClone(journal.head.entityDirectory.historicalOperations);
  assert.ok(pinnedRoot.level > 0);
  const generation = historyCount + 1;
  await commitFixtureTransaction(writer, createAt(journal, generation));
  assert.deepEqual(journal.head.entityDirectory.historicalOperations, pinnedRoot);
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const identityRoot = cold.head.entityDirectory.identities;
  assert.ok(identityRoot);
  const transactions = new PartitionTransactions(cold);
  const { reads } = await observeDirectoryPageReads(() =>
    assert.rejects(
      transactions.commit(
        {
          epoch: cold.head.epoch,
          expectedGeneration: generation,
          operationId: evidence(0).operationId,
          input: {},
        },
        { validateScope: () => {}, prepare: () => assert.fail("Historical operation executed") },
      ),
      { code: "SESSION_OPERATION_RETRY_UNAVAILABLE", sourceGeneration: 1 },
    ),
  );
  const expected = [];
  let position = pinnedRoot.position;
  let prefix = "";
  for (;;) {
    expected.push(directoryPageRead(root, position));
    const page = await readEntityDirectoryNode(journal, journal.head, position);
    if (page.level === 0) break;
    prefix = page.sharedPrefix;
    const slot = partitionHistoricalDirectorySlot(historicalIdentity(0), prefix);
    position = new Map(page.entries).get(slot);
    assert.ok(position);
  }
  assert.deepEqual(reads, expected);
  const [identityPath, identityOffset] = directoryPageRead(root, identityRoot.position);
  assert.ok(!reads.some(([path, offset]) => path === identityPath && offset === identityOffset));
  assert.equal(cold.head.sequence, generation);
});

test("inserting across a compressed prefix preserves the old branch and its children", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const firstKey = historicalIdentity(0);
  const firstSlot = partitionHistoricalDirectorySlot(firstKey, "");
  const firstTwo = firstSlot + partitionHistoricalDirectorySlot(firstKey, firstSlot);
  let matching;
  let divergent;
  for (
    let index = 1;
    index < 4096 && (matching === undefined || divergent === undefined);
    index += 1
  ) {
    const identity = historicalIdentity(index);
    if (partitionHistoricalDirectorySlot(identity, "") !== firstSlot) divergent = index;
    else if (partitionHistoricalDirectorySlot(identity, firstSlot) === firstTwo[1])
      matching = index;
  }
  assert.notEqual(matching, undefined);
  assert.notEqual(divergent, undefined);
  async function append(index, sequence) {
    const operation = evidence(index);
    await commitFixtureTransaction(writer, {
      ...createAt(journal, sequence),
      operationId: operation.operationId,
      mutations: [createPartitionHistoricalOperationMutation(operation)],
    });
    return partitionHistoricalOperationAddress(operation.operationId).key;
  }
  const first = await append(0, 1);
  const second = await append(matching, 2);
  await journal.usingSnapshot(async (before) => {
    const old = await readEntityDirectoryNode(
      journal,
      before,
      before.entityDirectory.historicalOperations.position,
    );
    assert.ok(old.sharedPrefix.startsWith(firstTwo));
    const third = await append(divergent, 3);
    const cold = await PartitionJournal.open({ root, sessionId });
    try {
      const after = cold.head;
      const branch = await readEntityDirectoryNode(
        cold,
        after,
        after.entityDirectory.historicalOperations.position,
      );
      assert.equal(branch.sharedPrefix, "");
      assert.deepEqual(
        new Map(branch.entries).get(firstSlot),
        before.entityDirectory.historicalOperations.position,
      );
      assert.equal(await lookupPartitionHistoricalOperation(cold, before, third), null);
      for (const [index, key] of [first, second, third].entries()) {
        const entry = await lookupPartitionHistoricalOperation(cold, after, key);
        assert.equal(entry.reference.record.sequence, index + 1);
      }
    } finally {
      await cold.close();
    }
  });
});

test("cold readers keep historical receipts isolated across a directory split", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { pageBytes: 4096 });
  const writer = new PartitionTransactions(journal);
  async function importReceipt(index) {
    const operation = evidence(index);
    await commitFixtureTransaction(writer, {
      ...createAt(journal, index + 1),
      operationId: operation.operationId,
      mutations: [createPartitionHistoricalOperationMutation(operation)],
    });
    return partitionHistoricalOperationAddress(operation.operationId).key;
  }
  const original = await importReceipt(0);
  await journal.usingSnapshot(async (before) => {
    assert.equal(before.entityDirectory.historicalOperations.level, 0);
    const imported = [];
    for (let index = 1; index < 48; index += 1) imported.push(await importReceipt(index));

    const cold = await PartitionJournal.open({ root, sessionId });
    try {
      const oldEntry = await lookupPartitionHistoricalOperation(cold, before, original);
      assert.equal(oldEntry.reference.record.sequence, 1);
      for (const key of imported)
        assert.equal(await lookupPartitionHistoricalOperation(cold, before, key), null);

      await cold.usingSnapshot(async (after) => {
        assert.ok(after.entityDirectory.historicalOperations.level > 0);
        assert.deepEqual(await lookupPartitionHistoricalOperation(cold, after, original), oldEntry);
        for (const [index, key] of imported.entries()) {
          const current = await lookupPartitionHistoricalOperation(cold, after, key);
          assert.equal(current.reference.record.sequence, index + 2);
        }
      });
    } finally {
      await cold.close();
    }
  });
});

test("historical directory is bound to the published snapshot and validates its full extent", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (before) => {
    const operation = evidence(0);
    const { key } = partitionHistoricalOperationAddress(operation.operationId);
    await commitFixtureTransaction(writer, {
      ...createAt(journal, 1),
      operationId: operation.operationId,
      mutations: [createPartitionHistoricalOperationMutation(operation)],
    });
    assert.equal(await lookupPartitionHistoricalOperation(journal, before, key), null);
    await journal.usingSnapshot(async (after) => {
      assert.ok(await lookupPartitionHistoricalOperation(journal, after, key));
    });
  });
  const missing = structuredClone(journal.head);
  delete missing.entityDirectory.historicalOperations;
  assert.throws(() => requirePartitionJournalHead(missing), /entity directory head/);
  const outside = structuredClone(journal.head);
  outside.entityDirectory.historicalOperations.position.offset = outside.entityDirectory.offset;
  const invalidExtent = { code: "SESSION_STORAGE_CORRUPT", message: /publication boundary/ };
  assert.throws(() => requirePartitionJournalHead(outside), invalidExtent);
  const position = outside.entityDirectory.historicalOperations.position;
  const { reads } = await observeDirectoryPageReads(() =>
    assert.rejects(readEntityDirectoryNode(journal, journal.head, position), invalidExtent),
  );
  assert.deepEqual(reads, []);
  const old = structuredClone(journal.head);
  for (const version of [65, 66]) {
    old.format = `noobot.partition-journal-prototype/${version}`;
    assert.throws(() => requirePartitionJournalHead(old), {
      name: "TypeError",
      message: "Invalid partition journal identity",
    });
  }
});

for (const publication of ["before-rename", "after-rename"]) {
  test(`historical directory recovery respects the committed boundary: ${publication}`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, {}, { autoClose: false });
    const writer = new PartitionTransactions(journal);
    await commitFixtureTransaction(writer, createAt(journal, 1));
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    const operation = evidence(7);
    const request = {
      ...createAt(journal, 2),
      operationId: operation.operationId,
      mutations: [createPartitionHistoricalOperationMutation(operation)],
    };
    const adapter = getFsAdapter();
    let injected = false;
    setFsAdapter({
      ...adapter,
      async rename(source, target) {
        if (String(target) !== current) return adapter.rename(source, target);
        injected = true;
        if (publication === "after-rename") await adapter.rename(source, target);
        throw Object.assign(new Error(`Injected ${publication} failure`), { code: "EIO" });
      },
    });
    try {
      await assert.rejects(commitFixtureTransaction(writer, request), {
        code: "SESSION_COMMIT_UNCERTAIN",
      });
      await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
      assert.equal(injected, true);
    } finally {
      setFsAdapter(adapter);
    }
    if (publication === "before-rename") assert.deepEqual(await readFile(current), before);
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    const committed = publication === "after-rename";
    assert.equal(cold.head.sequence, committed ? 2 : 1);
    const { key } = partitionHistoricalOperationAddress(operation.operationId);
    await cold.usingSnapshot(async (snapshot) => {
      const entry = await lookupPartitionHistoricalOperation(cold, snapshot, key);
      assert.equal(entry !== null, committed);
    });
    const target = new PartitionTransactions(cold);
    if (!committed) await commitFixtureTransaction(target, request);
    await commitFixtureTransaction(target, createAt(cold, 3));
    const currentBytes = await readFile(current);
    await assert.rejects(
      target.commit(
        {
          epoch: cold.head.epoch,
          expectedGeneration: 3,
          operationId: operation.operationId,
          input: {},
        },
        {
          validateScope: () => {},
          prepare: () => assert.fail("Committed historical operation executed"),
        },
      ),
      { code: "SESSION_OPERATION_RETRY_UNAVAILABLE", sourceGeneration: 8 },
    );
    assert.deepEqual(await readFile(current), currentBytes);
  });
}
