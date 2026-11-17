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
import { createHash, randomBytes } from "node:crypto";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { projectMessagePersistenceChange } from "@noobot/session-protocol/session-changes";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeMessageEntity } from "../../src/session/entities/message-entity.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { prepareImmutableMessages } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { readImmutableIndexedTitle } from "../../src/session/session-artifact-session/immutable-title-index.js";
import { IMMUTABLE_MESSAGE_TAIL_VERSION } from "../../src/session/session-artifact-session/immutable-message-tail-index.js";
import {
  readImmutableMessage,
  readImmutableTurnPage,
} from "../../src/session/session-artifact-session/immutable-message-reader.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { registerImmutableMessageBodyStorageTests } from "../helpers/immutable-message-body-storage-cases.js";

const timestamp = "2026-01-01T00:00:00.000Z";
function message(messageUid, overrides = {}) {
  const input = {
    messageUid,
    userMessageId: `user-${messageUid}`,
    sessionId: "session-1",
    parentSessionId: "",
    dialogProcessId: "dialog-1",
    parentDialogProcessId: "",
    turnScopeId: "turn-1",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: messageUid,
    attachments: [],
    transferEnvelopes: [],
    ts: timestamp,
    ...overrides,
  };
  for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
  return normalizeMessageEntity(input);
}

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-messages-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "session-1",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initialize",
    changes: [
      {
        collection: "metadata",
        key: "messageTailIndex",
        value: { version: IMMUTABLE_MESSAGE_TAIL_VERSION },
      },
      { collection: "metadata", key: "titleIndex", value: { version: 1, root: null } },
      { collection: "metadata", key: "lifecycleIndex", value: { version: 1, root: null } },
      {
        collection: "metadata",
        key: "session",
        value: { sessionId: "session-1", parentSessionId: "", updatedAt: timestamp },
      },
      {
        collection: "metadata",
        key: "facts",
        value: {
          messageCount: 0,
          messageSequence: 0,
          dialogSequence: 0,
          turnSequence: 0,
          lastDialogOrdinal: 0,
          lastMessageOrdinal: 0,
          lastMessageUid: "",
        },
      },
    ],
  });
  return store;
}

async function append(store, messages, operationId = "append") {
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId,
    input: { messages, updatedAt: timestamp },
    prepare: ({ get, getMetadata, input }) =>
      prepareImmutableMessages({ store, get, getMetadata, ...input }),
  });
}

test("content fragments commit with exact versions, shared indexes and idempotent receipts", async (t) => {
  const store = await fixture(t);
  const content = "prefix ".repeat(100000);
  await append(store, [message("fragment", { content })]);
  const before = await store.snapshot();
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, before.root, "messages"),
      "fragment",
    ),
  );
  const request = {
    messageUid: "fragment",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    expectedContentReference: stored.parts[0].reference,
    content: '🙂"\\\n',
  };
  const options = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "content-fragment",
    committedAt: timestamp,
    changes: { messageContentAppends: [request], messages: [message("other")] },
  };
  const result = await commitSessionChanges(options);
  assert.equal(result.result.messageReceipts.length, 2);
  const after = await store.snapshot();
  const record = await store.get(after, "messages", "fragment");
  assert.equal(record.message.content, content + request.content);
  assert.equal(record.ordinal, 1);
  const turn = await store.get(after, "turns", "turn-1");
  assert.equal(
    (
      await readCommittedValue(
        store,
        await readCommittedIndex(store, turn.messagesRoot, "fragment"),
      )
    ).message.content,
    content + request.content,
  );
  assert.deepEqual(
    (await commitSessionChanges(options)).result.messageReceipts,
    result.result.messageReceipts,
  );
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "stale-content",
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  assert.equal((await store.snapshot()).generation, after.generation);
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "wrong-owner",
      changes: { messageContentAppends: [{ ...request, dialogProcessId: "other" }] },
    }),
    { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" },
  );
});

test("metadata deltas reuse content without any body reads and replay their exact receipt", async (t) => {
  const store = await fixture(t);
  const content = randomBytes(400000).toString("base64");
  await append(store, [message("metadata", { content })]);
  const before = await store.snapshot();
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, before.root, "messages"),
      "metadata",
    ),
  );
  const request = {
    messageUid: "metadata",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    expectedContentReference: stored.parts[0].reference,
    metadata: { summarized: true },
    metadataRemovals: [],
  };
  const options = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "metadata-delta",
    committedAt: timestamp,
    changes: { messageMetadataUpdates: [request] },
  };
  const forbidden = await collectValueRecords(store, stored.parts[0].reference);
  setFsAdapter(await forbidRecordReads(store, forbidden));
  let outcome;
  try {
    outcome = await commitSessionChanges(options);
    assert.equal(
      outcome.result.messageReceipts[0].contentReference,
      request.expectedContentReference,
    );
    assert.deepEqual(await commitSessionChanges(options), { ...outcome, replayed: true });
  } finally {
    resetFsAdapter();
  }
  const after = await store.snapshot();
  const record = await store.get(after, "messages", "metadata");
  assert.equal(record.message.content, content);
  assert.equal(record.message.summarized, true);
  const turn = await store.get(after, "turns", "turn-1");
  assert.deepEqual(
    await readCommittedValue(store, await readCommittedIndex(store, turn.messagesRoot, "metadata")),
    record,
  );
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "metadata-wrong-owner",
      changes: { messageMetadataUpdates: [{ ...request, turnScopeId: "other" }] },
    }),
    { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" },
  );
});

test("presentation metadata demotion preserves body versions and both snapshot indexes without body IO", async (t) => {
  const store = await fixture(t);
  const source = message("presentation-metadata", {
    role: "assistant",
    userMessageId: undefined,
    messageOrigin: undefined,
    modelMessageId: "model-presentation-metadata",
    presentationMessageId: "presentation-1",
    chatPresentation: true,
    workspaceRootDirectory: "/workspace",
    content: randomBytes(400000).toString("base64"),
  });
  await append(store, [source]);
  const before = await store.snapshot();
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, before.root, "messages"),
      source.messageUid,
    ),
  );
  const request = {
    messageUid: source.messageUid,
    dialogProcessId: source.dialogProcessId,
    turnScopeId: source.turnScopeId,
    expectedContentReference: stored.parts[0].reference,
    metadata: { chatPresentation: false },
    metadataRemovals: ["workspaceRootDirectory"],
  };
  const options = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "presentation-metadata-demotion",
    committedAt: timestamp,
    changes: { messageMetadataUpdates: [request] },
  };
  const forbidden = await collectValueRecords(store, request.expectedContentReference);
  const prototype = store.objects.constructor.prototype;
  const put = prototype.put;
  const writeGuard = t.mock.method(prototype, "put", function (bytes) {
    const identity = createHash("sha256").update(bytes).digest("hex");
    assert.equal(forbidden.has(identity), false, `Unexpected body write preparation: ${identity}`);
    return put.call(this, bytes);
  });
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    const observed = await observeSessionStorageWork(() => commitSessionChanges(options));
    assert.ok(observed.work.immutableWriteBytes < 32768, JSON.stringify(observed.work));
    assert.equal(
      observed.result.result.messageReceipts[0].contentReference,
      request.expectedContentReference,
    );
    assert.deepEqual(await commitSessionChanges(options), { ...observed.result, replayed: true });
  } finally {
    resetFsAdapter();
    writeGuard.mock.restore();
  }
  const after = await store.snapshot();
  const record = await store.get(after, "messages", source.messageUid);
  assert.equal(record.message.content, source.content);
  assert.equal(record.message.chatPresentation, false);
  assert.equal(Object.hasOwn(record.message, "workspaceRootDirectory"), false);
  const turn = await store.get(after, "turns", source.turnScopeId);
  assert.equal(turn.canonicalAssistantUid, "");
  assert.deepEqual(
    await readCommittedValue(
      store,
      await readCommittedIndex(store, turn.messagesRoot, source.messageUid),
    ),
    record,
  );
  const previousTurn = await store.get(before, "turns", source.turnScopeId);
  assert.equal(previousTurn.canonicalAssistantUid, source.messageUid);
  assert.deepEqual((await store.get(before, "messages", source.messageUid)).message, source);
  assert.deepEqual(
    (
      await readCommittedValue(
        store,
        await readCommittedIndex(store, previousTurn.messagesRoot, source.messageUid),
      )
    ).message,
    source,
  );
});

test("unchanged message confirmations reuse the body and preserve versioned receipts", async (t) => {
  const store = await fixture(t);
  const source = message("confirmation", { content: randomBytes(400000).toString("base64") });
  const ownership = {
    sessionId: store.sessionId,
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
  };
  const seed = await commitSessionChanges({
    sessionDir: store.sessionDir,
    ...ownership,
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "confirmation-seed",
    committedAt: timestamp,
    changes: { messages: [source] },
  });
  const receipt = seed.result.messageReceipts[0];
  const before = await store.snapshot();
  const changes = projectMessagePersistenceChange(source, { message: source, receipt }, ownership);
  assert.equal(changes.messages, undefined);
  const request = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "confirmation",
    committedAt: timestamp,
    changes,
  };
  const forbidden = await collectValueRecords(store, receipt.contentReference);
  const prototype = store.objects.constructor.prototype;
  const put = prototype.put;
  const writeGuard = t.mock.method(prototype, "put", function (bytes) {
    const identity = createHash("sha256").update(bytes).digest("hex");
    assert.equal(forbidden.has(identity), false, `Unexpected body write preparation: ${identity}`);
    return put.call(this, bytes);
  });
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    const observed = await observeSessionStorageWork(() => commitSessionChanges(request));
    const outcome = observed.result;
    assert.ok(observed.work.immutableWriteBytes < 32768, JSON.stringify(observed.work));
    assert.deepEqual(outcome.result.messageReceipts, [
      { ...receipt, generation: outcome.generation },
    ]);
    const replay = await observeSessionStorageWork(() => commitSessionChanges(request));
    assert.deepEqual(replay.result, { ...outcome, replayed: true });
    assert.equal(replay.work.immutableWriteBytes ?? 0, 0);
    await assert.rejects(
      commitSessionChanges({
        ...request,
        expectedGeneration: outcome.generation,
        operationId: "confirmation-foreign",
        changes: {
          messageMetadataUpdates: [
            { ...changes.messageMetadataUpdates[0], turnScopeId: "foreign" },
          ],
        },
      }),
      { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" },
    );
    assert.equal((await store.snapshot()).generation, outcome.generation);
  } finally {
    resetFsAdapter();
    writeGuard.mock.restore();
  }
  const after = await store.snapshot();
  assert.deepEqual((await store.get(after, "messages", source.messageUid)).message, source);
  await append(store, [{ ...source, content: "replacement" }], "confirmation-replace");
  const replaced = await store.snapshot();
  await assert.rejects(
    commitSessionChanges({
      ...request,
      expectedGeneration: replaced.generation,
      operationId: "confirmation-stale",
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  assert.equal((await store.snapshot()).generation, replaced.generation);
  assert.deepEqual((await commitSessionChanges(request)).result.messageReceipts, [
    { ...receipt, generation: after.generation },
  ]);
});

test("content and metadata deltas share one version check, one publication and one receipt", async (t) => {
  const store = await fixture(t);
  await append(store, [message("combined", { content: "prefix" })]);
  const before = await store.snapshot();
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, before.root, "messages"),
      "combined",
    ),
  );
  const identity = {
    messageUid: "combined",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    expectedContentReference: stored.parts[0].reference,
  };
  const options = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "combined-delta",
    committedAt: timestamp,
    changes: {
      messageContentAppends: [{ ...identity, content: " tail" }],
      messageMetadataUpdates: [
        { ...identity, metadata: { summarized: true }, metadataRemovals: [] },
      ],
    },
  };
  const outcome = await commitSessionChanges(options);
  assert.equal(outcome.result.messageReceipts.length, 1);
  assert.notEqual(
    outcome.result.messageReceipts[0].contentReference,
    identity.expectedContentReference,
  );
  const after = await store.snapshot();
  const record = await store.get(after, "messages", "combined");
  assert.equal(record.message.content, "prefix tail");
  assert.equal(record.message.summarized, true);
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "combined-stale",
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "metadata-stale",
      changes: { messageMetadataUpdates: options.changes.messageMetadataUpdates },
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  assert.equal((await store.snapshot()).generation, after.generation);
});

test("content append makes a blank user title eligible without discarding its stored prefix", async (t) => {
  const store = await fixture(t);
  await append(store, [message("blank", { content: "   " })]);
  const before = await store.snapshot();
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, before.root, "messages"),
      "blank",
    ),
  );
  await commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "title-fragment",
    committedAt: timestamp,
    changes: {
      messageContentAppends: [
        {
          messageUid: "blank",
          dialogProcessId: "dialog-1",
          turnScopeId: "turn-1",
          expectedContentReference: stored.parts[0].reference,
          content: "new title",
        },
      ],
    },
  });
  const head = await store.snapshot();
  assert.equal((await store.get(head, "metadata", "session")).autoTitle, "   new title");
  assert.equal(
    await store.objects.withSnapshot(head, () =>
      readImmutableIndexedTitle(store, {
        get: (collection, key) => store.get(head, collection, key),
      }),
    ),
    "   new title",
  );
});

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
    prepare: async ({ get, getMetadata, input }) => {
      const prepared = await prepareImmutableMessages({ store, get, getMetadata, ...input });
      preparing = false;
      return prepared;
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

registerImmutableMessageBodyStorageTests({ fixture, message, append, timestamp });
