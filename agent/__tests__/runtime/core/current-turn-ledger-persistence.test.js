/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { createTestMessagePersistenceReceipts } from "../../helpers/message-persistence-receipts.js";

const identity = { sessionId: "s1", dialogProcessId: "d1", turnScopeId: "t1" };
const message = (messageUid = "m1") => ({
  ...identity,
  messageUid,
  role: "assistant",
  content: "prefix",
});
const receipts = (entries, generation = 1) =>
  createTestMessagePersistenceReceipts(
    {
      ...identity,
      messages: entries.map((entry) => entry.message),
    },
    generation,
  );

function confirm(store, entries, generation = 1) {
  store.confirmPersistence(entries, receipts(entries, generation));
  store.acknowledgeChanges(entries);
}

test("append during persistence retains exactly the unconfirmed suffix", () => {
  const store = createCurrentTurnMessagesStore([message()]);
  confirm(store, store.readPendingChanges().entries);
  store.appendContentByUid("m1", " first");
  const submitted = store.readPendingChanges().entries;
  assert.equal(submitted[0].contentAppend, " first");
  store.appendContentByUid("m1", " second");
  confirm(store, submitted, 2);
  const pending = store.readPendingChanges().entries;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].contentAppend, " second");
  assert.equal(pending[0].persisted.receipt.generation, 2);
  confirm(store, pending, 3);
  assert.deepEqual(store.readPendingChanges().entries, []);
  assert.equal(store.readByUid("m1").content, "prefix first second");
});

test("old confirmation and acknowledgement cannot attach to a recreated UID", () => {
  const store = createCurrentTurnMessagesStore([message()]);
  const old = store.readPendingChanges().entries;
  store.evictCommittedByUids(["m1"]);
  store.push({ ...message(), content: "new instance" });
  confirm(store, old);
  const pending = store.readPendingChanges().entries;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].persisted, null);
  assert.equal(pending[0].contentAppend, null);
  assert.equal(pending[0].message.content, "new instance");
});

test("replacement invalidates append identity even while an older append is in flight", () => {
  const store = createCurrentTurnMessagesStore([message()]);
  confirm(store, store.readPendingChanges().entries);
  store.appendContentByUid("m1", " submitted");
  const submitted = store.readPendingChanges().entries;
  store.updateByUid("m1", { content: "replacement" });
  store.appendContentByUid("m1", " tail");
  confirm(store, submitted, 2);
  const pending = store.readPendingChanges().entries;
  assert.equal(pending[0].contentAppend, null);
  assert.equal(pending[0].message.content, "replacement tail");
});

test("invalid receipt batches never partially confirm the ledger", () => {
  for (const invalid of [
    (valid) => valid.slice(0, 1),
    (valid) => [valid[0], valid[0]],
    (valid) => [valid[0], { ...valid[1], contentReference: "" }],
    (valid) => [valid[0], { ...valid[1], dialogProcessId: "other" }],
    (valid) => [...valid, { ...valid[0], messageUid: "unknown" }],
  ]) {
    const store = createCurrentTurnMessagesStore([message(), message("m2")]);
    const entries = store.readPendingChanges().entries;
    assert.throws(() => store.confirmPersistence(entries, invalid(receipts(entries))));
    assert.ok(store.readPendingChanges().entries.every((entry) => entry.persisted === null));
  }
});

test("late confirmations cannot move the acknowledged content version backwards", () => {
  const store = createCurrentTurnMessagesStore([message()]);
  const old = store.readPendingChanges().entries;
  confirm(store, old);
  store.appendContentByUid("m1", " tail");
  confirm(store, store.readPendingChanges().entries, 2);
  assert.throws(() => store.confirmPersistence(old, receipts(old)), /cannot move backwards/);
  store.updateByUid("m1", { modelResponseMetadata: { tokens: 4 } });
  assert.equal(store.readPendingChanges().entries[0].persisted.receipt.generation, 2);
});

test("append and unchanged content patches never serialize the existing body", (t) => {
  const store = createCurrentTurnMessagesStore([
    { ...message(), content: "x".repeat(1024 * 1024) },
  ]);
  confirm(store, store.readPendingChanges().entries);
  const stringify = JSON.stringify;
  t.mock.method(JSON, "stringify", (value, ...args) => {
    const serialized = stringify(value, ...args);
    assert.ok(serialized.length < 1024, "mutation serialized the accumulated message body");
    return serialized;
  });
  store.appendContentByUid("m1", " tail");
  store.updateByUid("m1", { ...store.readByUid("m1"), modelResponseMetadata: { tokens: 4 } });
  const entry = store.readPendingChanges().entries[0];
  assert.equal(entry.contentAppend, " tail");
  assert.deepEqual(entry.message.modelResponseMetadata, { tokens: 4 });
});
