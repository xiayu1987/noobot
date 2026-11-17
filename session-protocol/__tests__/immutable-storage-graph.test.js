/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  immutableCollectionValueReferences,
  immutableCommitReferences,
  immutableOperationReceiptReferences,
  requireImmutableCommitRecord,
  requireImmutableOperationId,
  IMMUTABLE_VALUE_BLOCK_BYTES as BLOCK_BYTES,
  immutableValueSplitOffset,
  requireImmutableValueBytePage,
  requireImmutableMessageResult,
  requireImmutableOperationReceipt,
  assertImmutableOperationRetryAvailable,
  IMMUTABLE_OPERATION_RETRY_UNAVAILABLE,
} from "../src/immutable-storage-graph.js";

const first = "a".repeat(64);
const second = "b".repeat(64);
const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };
const mutation = { collection: "messages", key: first, reference: second };
const commit = () => ({
  generation: 2,
  operationId: first,
  previous: first,
  mutations: [mutation],
});

test("historical retry unavailability is explicit, bounded and retains receipt evidence", () => {
  const receipt = { generation: 1, commit: first, digest: second, result: { legacy: true } };
  assert.equal(requireImmutableOperationReceipt(receipt, 1), receipt);
  assert.doesNotThrow(() => assertImmutableOperationRetryAvailable(receipt, "op"));
  const unavailable = { ...receipt, retryUnavailable: IMMUTABLE_OPERATION_RETRY_UNAVAILABLE };
  assert.equal(requireImmutableOperationReceipt(unavailable, 1), unavailable);
  assert.throws(() => assertImmutableOperationRetryAvailable(unavailable, "op"), {
    code: "SESSION_OPERATION_RETRY_UNAVAILABLE",
    operationId: "op",
    generation: 1,
    reason: IMMUTABLE_OPERATION_RETRY_UNAVAILABLE,
  });
  for (const retryUnavailable of [undefined, null, true, "unknown"])
    assert.throws(
      () => requireImmutableOperationReceipt({ ...receipt, retryUnavailable }, 1),
      invalid,
    );
  const { result, ...missingEvidence } = unavailable;
  assert.ok(result);
  assert.throws(() => requireImmutableOperationReceipt(missingEvidence, 1), invalid);
});

test("message result receipts contain canonical identities and never message bodies", () => {
  assert.deepEqual(requireImmutableMessageResult(["one", "one", "two"]), ["one", "one", "two"]);
  for (const value of [null, {}, [""], [" one"], [1], [{ messageUid: "one", content: "body" }]])
    assert.throws(() => requireImmutableMessageResult(value), invalid);
});

test("stable value splits remain aligned and strictly inside every safe integer boundary", () => {
  for (let size = BLOCK_BYTES * 2; Number.isSafeInteger(size); size *= 2) {
    for (const bytes of [size - 1, size, size + 1].filter(Number.isSafeInteger)) {
      const split = immutableValueSplitOffset(bytes);
      assert.ok(split > 0 && split < bytes);
      assert.equal(split % BLOCK_BYTES, 0);
      assert.equal(split, bytes > size ? size : size / 2);
    }
  }
  assert.ok(immutableValueSplitOffset(Number.MAX_SAFE_INTEGER) < Number.MAX_SAFE_INTEGER);
  for (const bytes of [null, 0, BLOCK_BYTES, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => immutableValueSplitOffset(bytes), invalid);
});

test("byte-page protocol rejects invalid sizes, kinds and mismatched subtree totals", () => {
  assert.equal(requireImmutableValueBytePage({ kind: "value", bytes: 0 }).bytes, 0);
  for (const page of [
    null,
    { kind: "value", bytes: -1 },
    { kind: "value", bytes: BLOCK_BYTES + 1 },
    { kind: "value-branch", bytes: BLOCK_BYTES },
    { kind: "other", bytes: 0 },
  ])
    assert.throws(() => requireImmutableValueBytePage(page), invalid);
  assert.throws(
    () =>
      requireImmutableValueBytePage(
        { kind: "value-branch", bytes: BLOCK_BYTES + 2 },
        BLOCK_BYTES + 1,
      ),
    invalid,
  );
});

test("commit edges include the predecessor and explicit mutation targets only", () => {
  const record = commit();
  assert.equal(requireImmutableCommitRecord(record, 2), record);
  assert.deepEqual(immutableCommitReferences(record), [first, second]);
  assert.deepEqual(
    immutableCommitReferences({
      ...record,
      generation: 1,
      previous: null,
      mutations: [{ ...mutation, reference: null }],
    }),
    [null, null],
  );
});

test("commit identity, predecessor, collection and duplicate mutation corruption are rejected", () => {
  const record = commit();
  for (const corrupt of [
    { ...record, generation: 1 },
    { ...record, previous: null },
    { ...record, operationId: "" },
    { ...record, unexpected: true },
    { ...record, mutations: [{ ...mutation, collection: "unknown" }] },
    { ...record, mutations: [{ ...mutation, key: "" }] },
    { ...record, mutations: [{ ...mutation, reference: "invalid" }] },
    { ...record, mutations: [mutation, mutation] },
    { ...record, mutations: [{ ...mutation, extra: second }] },
  ])
    assert.throws(() => requireImmutableCommitRecord(corrupt, 2), invalid);
  assert.throws(() => requireImmutableCommitRecord(null, 2), invalid);
  assert.throws(() => requireImmutableCommitRecord(record, 1), invalid);
});

test("operation identity uses UTF-8 byte limits across runtimes", () => {
  assert.equal(requireImmutableOperationId("a".repeat(1024)).length, 1024);
  assert.equal(requireImmutableOperationId("中".repeat(341)).length, 341);
  for (const value of [null, 1, "", "a".repeat(1025), "中".repeat(342)])
    assert.throws(() => requireImmutableOperationId(value), TypeError);
});

test("receipt results and digests cannot be inferred as storage edges", () => {
  const receipt = {
    generation: 2,
    commit: first,
    digest: second,
    result: { root: second, nested: [first] },
  };
  assert.deepEqual(immutableOperationReceiptReferences(receipt), [first]);
  assert.throws(
    () => immutableOperationReceiptReferences({ ...receipt, commit: "invalid" }),
    invalid,
  );
  assert.throws(
    () => immutableOperationReceiptReferences({ ...receipt, digest: "invalid" }),
    invalid,
  );
});

test("collection contracts distinguish commit references from opaque message content", () => {
  assert.deepEqual(immutableCollectionValueReferences("commitOrder", "2", commit()), [
    first,
    second,
  ]);
  assert.throws(() => immutableCollectionValueReferences("commitOrder", "2", first), invalid);
  assert.deepEqual(
    immutableCollectionValueReferences("messages", first, { root: first, content: second }),
    [],
  );
  assert.deepEqual(immutableCollectionValueReferences("metadata", "session", { root: second }), []);
  assert.deepEqual(
    immutableCollectionValueReferences("turns", "turn", {
      messagesRoot: first,
      messageOrderRoot: second,
      messageCount: 1,
    }),
    [first, second],
  );
  assert.deepEqual(
    immutableCollectionValueReferences("turnOutbox", "turn", { root: null, count: 0 }),
    [null],
  );
  assert.throws(() => immutableCollectionValueReferences("commitOrder", "1", "invalid"), invalid);
  assert.throws(() => immutableCollectionValueReferences("unknown", "1", first), invalid);
});
