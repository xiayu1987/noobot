/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import {
  PARTITION_ENTITY_DIRECTORY_FORMAT,
  decodePartitionEntityDirectoryPage,
  encodePartitionEntityDirectoryPage,
  partitionEntityPageCapacity,
  requireEntityDirectoryNode,
} from "../src/partition-entity-directory.js";
import { partitionEntityKey } from "../src/partition-transaction.js";

function fixture() {
  const epoch = "f".repeat(32);
  const head = {
    epoch,
    sequence: 10,
    tail: { partition: 2 },
    limits: { pageBytes: 65536, partitionBytes: 65536 },
  };
  const node = {
    format: PARTITION_ENTITY_DIRECTORY_FORMAT,
    epoch,
    level: 0,
    entries: [
      [
        partitionEntityKey("messages", "m"),
        {
          owner: { epoch, sequence: 4, partition: 1, slot: 0 },
          reference: { record: { epoch, sequence: 8, partition: 2 }, slot: 0 },
        },
      ],
    ],
  };
  return { head, node };
}

test("decoded directory pages freeze every container and retain snapshot boundaries", () => {
  const { head, node } = fixture();
  const decoded = decodePartitionEntityDirectoryPage(
    encodePartitionEntityDirectoryPage(node),
    head,
  );
  const [entry] = decoded.entries;
  const [, pointer] = entry;
  for (const value of [
    decoded,
    decoded.entries,
    entry,
    pointer,
    pointer.owner,
    pointer.reference,
    pointer.reference.record,
  ])
    assert.ok(Object.isFrozen(value));
  assert.equal(requireEntityDirectoryNode(decoded, head), decoded);
  assert.throws(() => requireEntityDirectoryNode(decoded, { ...head, sequence: 7 }));
  assert.throws(() => requireEntityDirectoryNode(decoded, { ...head, tail: { partition: 1 } }));
});

test("immutable validation proofs preserve epoch, sequence and partition boundaries", () => {
  const { head, node } = fixture();
  deepFreeze(node);
  assert.equal(requireEntityDirectoryNode(node, head), node);
  assert.equal(requireEntityDirectoryNode(node, { ...head, sequence: 20 }), node);
  assert.throws(() => requireEntityDirectoryNode(node, { ...head, epoch: "e".repeat(32) }));
  assert.throws(() => requireEntityDirectoryNode(node, { ...head, sequence: 7 }));
  assert.throws(() => requireEntityDirectoryNode(node, { ...head, tail: { partition: 1 } }));
  assert.equal(requireEntityDirectoryNode(node, { ...head, sequence: 8 }), node);
  head.sequence = 7;
  assert.throws(() => requireEntityDirectoryNode(node, head));
});

test("mutable and shallow-frozen pages never acquire immutable validation proofs", () => {
  for (const freeze of [(node) => node, Object.freeze]) {
    const { head, node } = fixture();
    freeze(node);
    requireEntityDirectoryNode(node, head);
    node.entries[0][1].reference.record.sequence = 11;
    assert.throws(() => requireEntityDirectoryNode(node, head));
  }
});

test("reused entries cannot bypass page kind, ordering or publication checks", () => {
  const { head, node } = fixture();
  deepFreeze(node);
  requireEntityDirectoryNode(node, head);
  const [entry] = node.entries;
  const page = (overrides) => deepFreeze({ ...node, ...overrides });
  const derived = page({ entries: [entry] });
  assert.equal(requireEntityDirectoryNode(derived, { ...head, sequence: 8 }), derived);
  assert.throws(() => requireEntityDirectoryNode(page({ entries: [entry, entry] }), head));
  assert.throws(() => requireEntityDirectoryNode(page({ historical: true }), head));
  assert.throws(() => requireEntityDirectoryNode(derived, { ...head, sequence: 7 }));
  assert.throws(() => requireEntityDirectoryNode(derived, { ...head, tail: { partition: 1 } }));
});

test("cloning a verified page cannot transfer a proof to modified data", () => {
  const { head, node } = fixture();
  deepFreeze(node);
  requireEntityDirectoryNode(node, head);
  const clone = structuredClone(node);
  clone.entries[0][0] = "invalid-key";
  deepFreeze(clone);
  assert.throws(() => requireEntityDirectoryNode(clone, head));
});

test("branch proofs revalidate smaller page capacity and child publication sequence", () => {
  const { head } = fixture();
  const smaller = { pageBytes: 4096, partitionBytes: 4096 };
  const count = partitionEntityPageCapacity(smaller) + 1;
  assert.ok(count <= partitionEntityPageCapacity(head.limits));
  const node = deepFreeze({
    format: PARTITION_ENTITY_DIRECTORY_FORMAT,
    epoch: head.epoch,
    level: 1,
    entries: Array.from({ length: count }, (_, index) => [
      partitionEntityKey("messages", String(index).padStart(6, "0")),
      { segment: 0, offset: index, bytes: 1 },
      9,
    ]),
  });
  requireEntityDirectoryNode(node, head);
  assert.throws(() => requireEntityDirectoryNode(node, { ...head, limits: smaller }));
  assert.throws(() => requireEntityDirectoryNode(node, { ...head, sequence: 8 }));
  assert.equal(requireEntityDirectoryNode(node, { ...head, sequence: 11 }), node);
});
