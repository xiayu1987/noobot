/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import {
  readCommittedIndex,
  committedIndexEntries,
  readCommittedPage,
  readCommittedValue,
  readCommittedValueMetadata,
  collectValueRecords,
  forbidRecordReads,
} from "./helpers/immutable-record-reads.js";
import test from "node:test";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import {
  ImmutableSessionChanges,
  prepareImmutableMessages,
} from "../../src/session/session-artifact-session/immutable-message-changes.js";
import {
  readImmutableMessage,
  readImmutableTurnPage,
} from "../../src/session/session-artifact-session/immutable-message-reader.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { timestamp, message, fixture, append } from "./immutable-message-changes.test-helpers.js";

test("indexed messages preserve ownership, timestamps, batch updates and ordinal allocation", async (t) => {
  const store = await fixture(t);
  const first = message("m1");
  const updated = message("m1", { content: "updated", ts: "2026-02-01T00:00:00.000Z" });
  await append(store, [first, message("m2"), updated]);
  const head = await store.snapshot();
  const record = await store.get(head, "messages", "m1");
  assert.equal(record.ordinal, 1);
  assert.equal(record.message.content, "updated");
  assert.equal(record.message.ts, timestamp);
  const turn = await store.get(head, "turns", "turn-1");
  assert.equal(turn.messageCount, 2);
  assert.equal(
    (await readCommittedValue(store, await readCommittedIndex(store, turn.messagesRoot, "m1")))
      .message.content,
    "updated",
  );
  assert.equal((await store.get(head, "metadata", "facts")).messageCount, 2);
  assert.equal((await store.get(head, "dialogs", "dialog-1")).userMessageUid, "m1");
  await assert.rejects(append(store, [message("m1", { turnScopeId: "other" })], "conflict"), {
    code: "SESSION_MESSAGE_IDENTITY_CONFLICT",
  });
  assert.equal((await store.snapshot()).generation, head.generation);
});

test("message preparation publishes no superseded records or intermediate turn message leaves", async (t) => {
  const store = await fixture(t);
  const putValue = store.objects.putValue.bind(store.objects);
  const putPage = store.objects.putPage.bind(store.objects);
  const records = new Map();
  let messageEncodings = 0;
  const leaves = new Set();
  const published = new Set();
  const createBatch = store.objects.segments.createBatch.bind(store.objects.segments);
  t.mock.method(store.objects.segments, "createBatch", (...args) => {
    const batch = createBatch(...args);
    const publish = batch.publish.bind(batch);
    batch.publish = async (references) => {
      await publish(references);
      for (const reference of references)
        published.add(decodeImmutableRecordReference(reference).digest);
    };
    return batch;
  });
  t.mock.method(store.objects, "putValue", async (value, options) => {
    const reference = await putValue(value, options);
    if (value?.message) {
      messageEncodings += 1;
      records.set(reference, structuredClone(value));
    }
    return reference;
  });
  t.mock.method(store.objects, "putPage", async (page) => {
    const reference = await putPage(page);
    if (
      page.kind === "index-leaf" &&
      page.entries.every(([key, value]) => key.startsWith("batch-") && records.has(value))
    )
      leaves.add(reference);
    return reference;
  });
  const input = Array.from({ length: 32 }, (_, index) => message(`batch-${index}`));
  input.push(message("batch-0", { content: "replacement" }));
  await append(store, input);
  assert.equal(messageEncodings, 32);
  assert.equal(records.size, 32);
  assert.equal(
    [...records.values()].find((record) => record.message.messageUid === "batch-0").message.content,
    "replacement",
  );
  const snapshot = await store.snapshot();
  const turn = await store.get(snapshot, "turns", "turn-1");
  const messagesRoot = await readCommittedIndex(store, snapshot.root, "messages");
  for (const [reference, record] of records) {
    assert.equal(
      await readCommittedIndex(store, messagesRoot, record.message.messageUid),
      reference,
    );
    assert.equal(
      await readCommittedIndex(store, turn.messagesRoot, record.message.messageUid),
      reference,
    );
  }
  const reachable = new Set();
  async function visit(reference) {
    reachable.add(reference);
    const page = await readCommittedPage(store, reference);
    if (page.kind === "index-branch")
      for (const child of Object.values(page.children)) await visit(child);
  }
  await visit(turn.messagesRoot);
  await visit(messagesRoot);
  assert.ok(leaves.size > 0);
  for (const reference of leaves)
    assert.equal(
      published.has(reference),
      reachable.has(reference),
      `intermediate leaf ${reference}`,
    );
});

test("dialog turn batches publish one transition and preserve old snapshots and ordinal allocation", async (t) => {
  const store = await fixture(t);
  await append(store, [message("seed")], "seed");
  const previous = await store.snapshot();
  const old = await store.get(previous, "dialogTurns", "dialog-1");
  const setMany = store.index.setMany.bind(store.index);
  const counts = [];
  let preparing = true;
  t.mock.method(store.index, "setMany", async (root, entries) => {
    if (preparing && root === old.root) counts.push(entries.length);
    return setMany(root, entries);
  });
  const messages = Array.from({ length: 32 }, (_, index) =>
    message(`new-${index}`, { turnScopeId: `new-turn-${index}` }),
  );
  messages.push(message("new-0", { turnScopeId: "new-turn-0", content: "updated" }));
  await store.transact({
    expectedGeneration: previous.generation,
    operationId: "batch-turns",
    input: { messages, updatedAt: timestamp },
    prepare: async ({ get, getMany, getMetadata, input }) => {
      const plan = new ImmutableSessionChanges(get, { getMany, getMetadata });
      const turns = await prepareImmutableMessages({ store, plan, ...input });
      preparing = false;
      return { changes: plan.changes(), result: { turns } };
    },
  });
  assert.deepEqual(counts, [32]);
  const current = await store.snapshot();
  const next = await store.get(current, "dialogTurns", "dialog-1");
  assert.equal(next.count, 33);
  const turns = [];
  for await (const [, reference] of committedIndexEntries(store, next.root))
    turns.push(await readCommittedValue(store, reference));
  assert.deepEqual(
    new Set(turns),
    new Set(["turn-1", ...messages.map((item) => item.turnScopeId)]),
  );
  assert.deepEqual(await store.get(previous, "dialogTurns", "dialog-1"), old);
  const oldTurns = [];
  for await (const [, reference] of committedIndexEntries(store, old.root))
    oldTurns.push(await readCommittedValue(store, reference));
  assert.deepEqual(oldTurns, ["turn-1"]);
  await append(store, [message("last", { turnScopeId: "last-turn" })], "last-turn");
  assert.equal((await store.get(await store.snapshot(), "dialogTurns", "dialog-1")).count, 34);
});

test("presentation replacement demotes only the previous indexed owner, including within one batch", async (t) => {
  const store = await fixture(t);
  const assistant = (uid) =>
    message(uid, {
      role: "assistant",
      userMessageId: undefined,
      messageOrigin: undefined,
      modelMessageId: `model-${uid}`,
      presentationMessageId: "presentation-1",
      chatPresentation: true,
      workspaceRootDirectory: "/workspace",
    });
  await append(store, [assistant("a1"), assistant("a2")]);
  let head = await store.snapshot();
  const old = (await store.get(head, "messages", "a1")).message;
  assert.equal(old.chatPresentation, false);
  assert.equal(Object.hasOwn(old, "workspaceRootDirectory"), false);
  assert.equal((await store.get(head, "messages", "a2")).message.chatPresentation, true);
  await append(store, [assistant("a3")], "replace");
  head = await store.snapshot();
  assert.equal((await store.get(head, "messages", "a2")).message.chatPresentation, false);
  assert.equal((await store.get(head, "turns", "turn-1")).canonicalAssistantUid, "a3");
});

test("presentation demotion reuses committed content without opening its body graph", async (t) => {
  const store = await fixture(t);
  const assistant = (uid, content) =>
    message(uid, {
      role: "assistant",
      userMessageId: undefined,
      messageOrigin: undefined,
      modelMessageId: `model-${uid}`,
      presentationMessageId: "presentation-1",
      chatPresentation: true,
      workspaceRootDirectory: "/workspace",
      content,
    });
  const content = "presentation body 中文".repeat(20000);
  await append(store, [assistant("old", content)], "seed");
  const previous = await store.snapshot();
  const reference = await readCommittedIndex(
    store,
    await readCommittedIndex(store, previous.root, "messages"),
    "old",
  );
  const before = await readCommittedValueMetadata(store, reference);
  const forbidden = await collectValueRecords(store, before.parts[0].reference);
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    await append(store, [assistant("new", "new presentation")], "replace");
  } finally {
    resetFsAdapter();
  }
  const current = await store.snapshot();
  const next = await readCommittedIndex(
    store,
    await readCommittedIndex(store, current.root, "messages"),
    "old",
  );
  const after = await readCommittedValueMetadata(store, next);
  assert.deepEqual(after.parts, before.parts);
  assert.equal(after.value.message.chatPresentation, false);
  assert.equal((await store.get(current, "messages", "old")).message.content, content);
  assert.equal((await store.get(previous, "messages", "old")).message.chatPresentation, true);
});

test("turn pages read committed ordinal ranges and preserve old snapshot visibility", async (t) => {
  const store = await fixture(t);
  await append(
    store,
    Array.from({ length: 20 }, (_, index) => message(`m-${index}`)),
    "seed",
  );
  const previous = await store.snapshot();
  await append(store, [message("m-10", { content: "updated" }), message("m-20")], "update");
  const current = await store.snapshot();
  const page = (snapshot, after = 8, limit = 4) =>
    readImmutableTurnPage({
      store,
      snapshot,
      turnScopeId: "turn-1",
      after,
      limit,
    });
  const oldPage = await page(previous);
  assert.deepEqual(
    oldPage.records.map(({ message: item }) => item.messageUid),
    ["m-8", "m-9", "m-10", "m-11"],
  );
  assert.equal(oldPage.records[2].message.content, "m-10");
  assert.equal(oldPage.cursor, 12);
  assert.equal(oldPage.hasMore, true);
  assert.equal((await page(current)).records[2].message.content, "updated");
  const tail = await page(current, 20);
  assert.deepEqual(
    tail.records.map(({ message: item }) => item.messageUid),
    ["m-20"],
  );
  assert.equal(tail.cursor, 21);
  assert.equal(tail.hasMore, false);
  assert.equal((await page(current, 100)).records.length, 0);
  assert.equal(await readImmutableMessage(store, current, "missing"), null);
  assert.equal((await readImmutableMessage(store, current, "m-10")).message.content, "updated");
  for (const [after, limit] of [
    [-1, 1],
    [0, 0],
    [0, 257],
    [0.5, 1],
  ])
    await assert.rejects(page(current, after, limit), TypeError);
});

test("turn page batches only its requested positions and never performs scalar position lookups", async (t) => {
  const store = await fixture(t);
  await append(
    store,
    Array.from({ length: 20 }, (_, index) => message(`m-${index}`)),
    "seed-page",
  );
  const snapshot = await store.snapshot();
  const turn = await store.get(snapshot, "turns", "turn-1");
  const scalar = store.index.get.bind(store.index);
  const batched = store.index.getMany.bind(store.index);
  const requested = [];
  t.mock.method(store.index, "get", async (root, key) => {
    assert.notEqual(root, turn.messageOrderRoot);
    assert.notEqual(root, turn.messagesRoot);
    return scalar(root, key);
  });
  t.mock.method(store.index, "getMany", async (root, keys) => {
    if (root === turn.messageOrderRoot || root === turn.messagesRoot) requested.push([...keys]);
    return batched(root, keys);
  });
  const page = await readImmutableTurnPage({
    store,
    snapshot,
    turnScopeId: "turn-1",
    after: 8,
    limit: 4,
  });
  assert.deepEqual(
    page.records.map(({ message: item }) => item.messageUid),
    ["m-8", "m-9", "m-10", "m-11"],
  );
  assert.equal(requested.length, 2);
  assert.equal(requested[0].length, 4);
  assert.deepEqual(requested[1], ["m-8", "m-9", "m-10", "m-11"]);
});
