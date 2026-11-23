/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { encodeJournalKey, decodeJournalKeyJson } from "../src/partition-journal-key-codec.js";
import {
  PARTITION_COLLECTION_FRAME,
  decodePartitionCollectionFrameSlot,
  encodePartitionJournalFrameRequest,
  decodePartitionJournalFrameRequest,
  partitionCollectionFrameBodyStart,
  partitionCollectionSlotOffset,
  requirePartitionCollectionFrameSlot,
} from "../src/partition-journal.js";
import { PARTITION_COLLECTION_NAMES } from "../src/partition-collection-names.js";
import { PARTITION_TRANSACTION_FORMAT } from "../src/partition-transaction.js";
import { storageBytesDigest } from "../src/storage-digest.js";

const limits = { transactionBytes: 4096 };

function frame(value) {
  const epoch = "a".repeat(32);
  return {
    epoch,
    sequence: 1,
    payload: {
      format: PARTITION_TRANSACTION_FORMAT,
      expectedGeneration: 0,
      operationId: "key-fidelity",
      requestDigest: "b".repeat(64),
      mutations: [{ collection: "messages", key: "literal:0", owner: null, value }],
      result: null,
    },
  };
}

test("compact collection frames preserve nested user keys, arrays and prototype-like data", () => {
  const value = JSON.parse(
    '{"message":{"0":"zero",":0":"colon",":message":"literal", "__proto__":{"polluted":true},"constructor":"data","prototype":null,"":"empty","中文😀":"unicode","a\\\"\\\\b":"escaped"},"content":[{"sessionId":"nested","01":1},null,false,3]}',
  );
  const input = frame(value);
  const encoded = encodePartitionJournalFrameRequest(input, limits, "collections");
  const decoded = decodePartitionJournalFrameRequest(encoded.body, "collections");
  assert.deepEqual(decoded, input);
  assert.deepEqual(encoded.request, input);
  assert.equal(Object.hasOwn(decoded.payload.mutations[0].value.message, "__proto__"), true);
  assert.equal(Object.prototype.polluted, undefined);
});

test("journal key identifiers and literal markers cannot collide", () => {
  for (const key of [
    "message",
    "sessionId",
    "0",
    "01",
    "",
    ":",
    ":0",
    ":message",
    "__proto__",
    "😀",
  ]) {
    const wire = JSON.stringify({ [encodeJournalKey(key)]: { [encodeJournalKey(key)]: true } });
    assert.deepEqual(decodeJournalKeyJson(wire), { [key]: { [key]: true } });
  }
  assert.equal(encodeJournalKey("message"), "0");
  assert.equal(encodeJournalKey("0"), ":0");
});

test("journal decoding rejects unmarked keys and noncanonical identifiers", () => {
  for (const token of [
    "message",
    ":message",
    ":sessionId",
    "01",
    "-0",
    "-1",
    "1e0",
    "1.0",
    "+1",
    "999",
    "9007199254740992",
    "",
    " ",
  ]) {
    assert.throws(() => decodeJournalKeyJson(JSON.stringify([{ [token]: true }])), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  }
});

function lifecycleNode(prefix, value) {
  return { collection: "lifecycleOrder", key: `p:${prefix}`, owner: null, value };
}

function lifecycleDescriptor(root) {
  return { collection: "metadata", key: "lifecycleIndex", owner: null, value: { root } };
}

function readSlot(body, slot) {
  const { countBytes, slotBytes } = PARTITION_COLLECTION_FRAME;
  const layout = partitionCollectionFrameBodyStart(body.subarray(0, countBytes), body.length);
  const start = partitionCollectionSlotOffset(slot);
  const position = requirePartitionCollectionFrameSlot(
    body.subarray(start, start + slotBytes),
    layout.envelopeStart,
    body.length,
  );
  const bytes = body.subarray(position.offset, position.offset + position.length);
  return { bytes, layout, slot, position };
}

test("collection frames compact lifecycle paths without losing empty or leading-zero paths", () => {
  const zero = "0".repeat(309);
  const one = `1${"0".repeat(308)}`;
  const input = frame(null);
  input.payload.mutations = [
    lifecycleNode("", { kind: "branch", prefix: "", zero, one }),
    lifecycleNode(zero, { kind: "terminal", prefix: zero, sequence: 1, turnScopeId: "a" }),
    { collection: "lifecycleOrder", key: `p:${one}`, owner: null, remove: true },
    lifecycleDescriptor(""),
    lifecycleDescriptor("001"),
    lifecycleDescriptor(null),
  ];
  const encoded = encodePartitionJournalFrameRequest(input, limits, "collections");
  assert.deepEqual(encoded.request, input);
  assert.deepEqual(decodePartitionJournalFrameRequest(encoded.body, "collections"), input);
  const request = { epoch: input.epoch, sequence: input.sequence };
  const branch = readSlot(encoded.body, 0);
  assert.equal(branch.bytes[0], 0, "branch uses the packed slot marker");
  assert.deepEqual(
    decodePartitionCollectionFrameSlot({ ...branch, request }),
    input.payload.mutations[0],
  );
  const removal = readSlot(encoded.body, 2);
  assert.equal(removal.bytes[0], 0, "a long key may use a packed removal slot");
  assert.deepEqual(
    decodePartitionCollectionFrameSlot({ ...removal, request }),
    input.payload.mutations[2],
  );
  const shortRemoval = frame(null);
  shortRemoval.payload.mutations = [
    { collection: "lifecycleOrder", key: "p:001", owner: null, remove: true },
  ];
  const shortFrame = encodePartitionJournalFrameRequest(shortRemoval, limits, "collections");
  assert.equal(JSON.parse(new TextDecoder().decode(readSlot(shortFrame.body, 0).bytes))[1], "p:9");
  assert.ok(branch.bytes.length < zero.length + one.length);
});

test("collection frames reject illegal lifecycle paths and non-JSON record properties", () => {
  const terminal = { kind: "terminal", prefix: "0" };
  const getter = Object.defineProperty({ ...terminal }, "prefix", {
    get() {
      assert.fail("path getter must not run");
    },
  });
  const hidden = Object.defineProperty({ ...terminal }, "hidden", { value: 1 });
  for (const mutation of [
    lifecycleNode("2", terminal),
    lifecycleNode("0".repeat(310), terminal),
    lifecycleNode("0", getter),
    lifecycleNode("0", hidden),
    lifecycleNode("", { kind: "branch", prefix: "", zero: "z", one: "1" }),
    lifecycleDescriptor(" 0"),
  ]) {
    const input = frame(null);
    input.payload.mutations = [mutation];
    assert.throws(
      () => encodePartitionJournalFrameRequest(input, limits, "collections"),
      /Invalid lifecycle index path encoding|Journal JSON cannot discard/,
    );
  }
});

test("collection frame decoding rejects noncanonical lifecycle tokens after digest validation", () => {
  const input = frame(null);
  const id = PARTITION_COLLECTION_NAMES.indexOf("lifecycleOrder");
  const padding = "fixture-padding:".repeat(4);
  const valid = [
    id,
    "p:14",
    {
      [encodeJournalKey("kind")]: "terminal",
      [encodeJournalKey("prefix")]: "14",
      [encodeJournalKey("padding")]: padding,
    },
  ];
  const invalidKey = [id, "p:04"];
  const invalidPath = [id, "p:14", { ...valid[2], [encodeJournalKey("prefix")]: "1G" }];
  const packed = (tuple) => Buffer.concat([Buffer.of(0), deflateRawSync(JSON.stringify(tuple))]);
  const decode = (bytes) => decodeCheckedSlot(input, bytes);
  assert.deepEqual(
    decode(packed(valid)),
    lifecycleNode("0100", { kind: "terminal", prefix: "0100", padding }),
  );
  for (const bytes of [Buffer.from(JSON.stringify(invalidKey)), packed(invalidPath)])
    assert.throws(() => decode(bytes), {
      code: "SESSION_STORAGE_CORRUPT",
      message: "Invalid lifecycle index path encoding",
    });
});

function decodeCheckedSlot({ epoch, sequence }, bytes) {
  const offset = 100;
  const bodyBytes = offset + bytes.length;
  const digest = storageBytesDigest(
    Buffer.concat([Buffer.from(`${epoch}:${sequence}:1:${bodyBytes}:0:${offset}:`), bytes]),
  );
  return decodePartitionCollectionFrameSlot({
    bytes,
    request: { epoch, sequence },
    layout: { count: 1, bodyBytes },
    slot: 0,
    position: { offset, length: bytes.length, digest },
  });
}

test("collection slots distinguish a null value from removal with and without an owner", () => {
  const input = frame(null);
  input.sequence = 3;
  input.payload.expectedGeneration = 2;
  const owner = { epoch: input.epoch, partition: 0, sequence: 1, slot: 0 };
  input.payload.mutations = [
    { collection: "messages", key: "a", owner: null, value: null },
    { collection: "messages", key: "b", owner: null, remove: true },
    { collection: "messages", key: "c", owner, value: null },
    { collection: "messages", key: "d", owner, remove: true },
  ];
  const encoded = encodePartitionJournalFrameRequest(input, limits, "collections");
  assert.deepEqual(decodePartitionJournalFrameRequest(encoded.body, "collections"), input);
  for (const [slot, arity] of [3, 2, 6, 5].entries()) {
    const entry = readSlot(encoded.body, slot);
    assert.equal(JSON.parse(new TextDecoder().decode(entry.bytes)).length, arity);
    assert.deepEqual(
      decodePartitionCollectionFrameSlot({ ...entry, request: input }),
      input.payload.mutations[slot],
    );
  }
});

test("packed slots reject expansion beyond the protocol limit even with a valid physical digest", () => {
  const bytes = Buffer.concat([Buffer.of(0), deflateRawSync("x".repeat(4096))]);
  assert.throws(
    () => decodeCheckedSlot(frame(null), bytes),
    (error) => {
      assert.equal(error.code, "SESSION_STORAGE_CORRUPT");
      assert.equal(error.cause?.code, "ERR_BUFFER_TOO_LARGE");
      return true;
    },
  );
});
