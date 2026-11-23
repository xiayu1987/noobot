/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PARTITION_ENTITY_DIRECTORY,
  PARTITION_ENTITY_DIRECTORY_FORMAT,
  decodePartitionEntityDirectoryPage,
  decodePartitionHistoricalDirectoryPage,
  encodePartitionEntityDirectoryPage,
  encodePartitionHistoricalDirectoryPage,
  partitionEntityPageBytes,
  partitionEntityPageCapacity,
  requireEntityDirectoryNode,
} from "../src/partition-entity-directory.js";
import {
  decodePartitionJournalControl,
  encodePartitionJournalControl,
} from "../src/partition-journal.js";
import {
  partitionEntityPageKeyBytes,
  requirePartitionEntityPageKey,
} from "../src/partition-entity-page-budget.js";
import { PARTITION_COLLECTION_NAMES } from "../src/partition-collection-names.js";
import {
  partitionEntityCollectionRange,
  partitionEntityKey,
} from "../src/partition-transaction.js";

test("entity key byte accounting matches its embedded JSON encoding", () => {
  for (const key of ["", "ascii", '"\\', "\b\t\n\f\r\u0000\u001f", "é中🙂", "\ud800a\udfff"]) {
    const encoded = JSON.stringify(JSON.stringify(key));
    assert.equal(partitionEntityPageKeyBytes(key), Buffer.byteLength(encoded.slice(1, -1)));
  }
});

test("collection ranges select exactly their canonical tuple keys", () => {
  for (const collection of PARTITION_COLLECTION_NAMES) {
    const { start, end } = partitionEntityCollectionRange(collection);
    for (const candidate of PARTITION_COLLECTION_NAMES) {
      for (const key of ["0", ",", "-", '"', "\\", "\u0000", "\u{1f642}"]) {
        const identity = partitionEntityKey(candidate, key);
        assert.equal(start <= identity && identity < end, candidate === collection);
      }
    }
  }
});

test("full entity directory pages fit their literal encoding with maximum-width fields", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const epoch = "f".repeat(32);
  const head = { epoch, sequence: max, tail: { partition: max }, limits: {} };
  const record = { epoch, partition: max, sequence: max };
  const leaf = {
    owner: { ...record, sequence: max - 1, slot: max },
    reference: { record, slot: max },
  };
  const child = { segment: max, offset: max - 1, bytes: 1 };
  const escapedBytes = (key) => Buffer.byteLength(JSON.stringify(JSON.stringify(key))) - 2;
  const indexWidth = String(PARTITION_ENTITY_DIRECTORY.maxEntries - 1).length;
  const keys = Array.from({ length: PARTITION_ENTITY_DIRECTORY.maxEntries }, (_, index) => {
    let key = `${String(index).padStart(indexWidth, "0")}-\u00e9-"\\`;
    while (escapedBytes(JSON.stringify(["messages", key])) < 512) key += "x";
    assert.equal(escapedBytes(JSON.stringify(["messages", key])), 512);
    assert.throws(() => partitionEntityKey("messages", `${key}x`), RangeError);
    return partitionEntityKey("messages", key);
  });

  for (const limits of [
    { pageBytes: 4096, partitionBytes: 8192 },
    { pageBytes: 8192, partitionBytes: 4096 },
    { pageBytes: 65536, partitionBytes: 65536 },
  ]) {
    head.limits = limits;
    const capacity = partitionEntityPageCapacity(limits);
    for (const [level, pointer] of [
      [0, leaf],
      [PARTITION_ENTITY_DIRECTORY.maxLevel, child],
    ]) {
      const node = {
        format: PARTITION_ENTITY_DIRECTORY_FORMAT,
        epoch,
        level,
        entries: keys
          .slice(0, capacity)
          .map((key) => (level ? [key, pointer, max] : [key, pointer])),
      };
      for (const [key] of node.entries) requirePartitionEntityPageKey(key);
      assert.equal(requireEntityDirectoryNode(node, head), node);
      assert.ok(
        1 + Buffer.byteLength(encodePartitionEntityDirectoryPage(node)) <=
          partitionEntityPageBytes(limits),
      );
      assert.deepEqual(
        decodePartitionEntityDirectoryPage(encodePartitionEntityDirectoryPage(node), head),
        node,
      );
      assert.throws(
        () => decodePartitionEntityDirectoryPage(encodePartitionJournalControl(node), head),
        TypeError,
      );
    }
  }
});

test("creation references have one canonical location on disk", () => {
  const epoch = "f".repeat(32);
  const head = { epoch, sequence: 10, tail: { partition: 2 }, limits: {} };
  const record = { epoch, partition: 2, sequence: 9 };
  const key = partitionEntityKey("messages", "one");
  const node = {
    format: PARTITION_ENTITY_DIRECTORY_FORMAT,
    epoch,
    level: 0,
    entries: [[key, { owner: { ...record, slot: 1 }, reference: { record, slot: 1 } }]],
  };
  const serialized = encodePartitionEntityDirectoryPage(node);
  assert.deepEqual(decodePartitionJournalControl(serialized), [epoch, 0, [[key, [2, 9, 1]]]]);
  assert.deepEqual(decodePartitionEntityDirectoryPage(serialized, head), node);
  const repeated = encodePartitionJournalControl([epoch, 0, [[key, [2, 9, 1, 2, 9, 1]]]]);
  assert.throws(() => decodePartitionEntityDirectoryPage(repeated, head), /Redundant entity owner/);
});

test("historical branch encoding preserves the slot bitmap and position byte base", () => {
  const epoch = "f".repeat(32);
  const head = { epoch, sequence: 1, tail: { partition: 1 }, limits: { pageBytes: 4096 } };
  const node = {
    format: PARTITION_ENTITY_DIRECTORY_FORMAT,
    epoch,
    historical: true,
    level: 1,
    sharedPrefix: "abc",
    entries: ["0", "f"].map((slot) => [slot, { segment: 1, offset: 2, bytes: 23 }, 0]),
  };
  const stored = Buffer.from("040180abc00102002d9075bac7027cf19512dd4f76e1a4dd49", "hex");
  assert.deepEqual(encodePartitionHistoricalDirectoryPage(node), stored);
  assert.deepEqual(decodePartitionHistoricalDirectoryPage(stored, head), node);
});

test("historical directory pages encode full digests and creation-only positions canonically", () => {
  const epoch = "f".repeat(32);
  const limits = { pageBytes: 4096, partitionBytes: 4096 };
  const max = Number.MAX_SAFE_INTEGER;
  const head = { epoch, sequence: max, tail: { partition: max }, limits };
  const record = { epoch, partition: max, sequence: max };
  const key = partitionEntityKey("historicalOperations", "0".repeat(64));
  const node = { format: PARTITION_ENTITY_DIRECTORY_FORMAT, epoch, historical: true };
  const leaf = {
    ...node,
    level: 0,
    entries: [[key, { owner: { ...record, slot: max }, reference: { record, slot: max } }]],
  };
  const branch = {
    ...node,
    level: 1,
    sharedPrefix: "abc",
    entries: ["0", "f"].map((slot) => [slot, { segment: max, offset: max - 1, bytes: max }, 0]),
  };
  assert.throws(
    () => encodePartitionHistoricalDirectoryPage({ ...branch, entries: branch.entries.slice(1) }),
    /page shape/,
  );

  for (const page of [leaf, branch]) {
    const serialized = encodePartitionHistoricalDirectoryPage(page);
    assert.deepEqual(decodePartitionHistoricalDirectoryPage(serialized, head), page);
    const corrupted = Buffer.from(serialized);
    corrupted[2] ^= 1;
    assert.throws(() => decodePartitionHistoricalDirectoryPage(corrupted, head), /integrity check/);
    assert.throws(() => decodePartitionHistoricalDirectoryPage(serialized.subarray(0, -1), head));
    assert.throws(() =>
      decodePartitionHistoricalDirectoryPage(serialized, { ...head, epoch: "0".repeat(32) }),
    );

    const count = page.level ? 16 : 1;
    const full = {
      ...page,
      entries: Array.from({ length: count }, (_, index) => [
        page.level
          ? index.toString(16)
          : partitionEntityKey("historicalOperations", index.toString(16).padStart(64, "0")),
        ...page.entries[0].slice(1),
      ]),
    };
    const encoded = encodePartitionHistoricalDirectoryPage(full);
    assert.ok(1 + Buffer.byteLength(encoded) <= partitionEntityPageBytes(limits));
    assert.deepEqual(decodePartitionHistoricalDirectoryPage(encoded, head), full);
  }
});

test("historical branch addresses retain distinct offsets near the integer limit", () => {
  const epoch = "a".repeat(32);
  const head = {
    epoch,
    sequence: 1,
    tail: { partition: 0 },
    limits: { pageBytes: 4096, partitionBytes: 4096 },
  };
  const node = {
    format: PARTITION_ENTITY_DIRECTORY_FORMAT,
    epoch,
    historical: true,
    level: 1,
    sharedPrefix: "123",
    entries: Array.from({ length: 16 }, (_, index) => [
      index.toString(16),
      { segment: 200, offset: Number.MAX_SAFE_INTEGER - index * 64, bytes: 64 + index },
      0,
    ]),
  };
  const encoded = encodePartitionHistoricalDirectoryPage(node);
  assert.ok(encoded.length < 100, "nearby addresses should not repeat their high bits");
  assert.deepEqual(decodePartitionHistoricalDirectoryPage(encoded, head), node);
});
