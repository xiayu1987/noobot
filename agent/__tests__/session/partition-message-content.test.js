/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { projectMessagePersistenceChange } from "@noobot/session-protocol/session-changes";
import {
  PARTITION_MESSAGE_COLLECTIONS,
  partitionMessageContentVersion,
} from "@noobot/session-protocol/partition-session-messages";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  preparePartitionContentWrite,
  readPartitionContentRange,
} from "../../src/session/partition-storage/partition-message-content.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import {
  committedAt,
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

test("empty content requires exactly one chunk before a byte range can read storage", async () => {
  const record = {
    message: { messageUid: "message" },
    firstChunk: 7,
    firstByteChunk: null,
    lastChunk: 7,
    contentBytes: 2,
  };
  const selection = { byteOffset: 0, maxBytes: 2 };
  let reads = 0;
  const read = async ({ keys: [key] }) => {
    reads += 1;
    return new Map([[key, { value: [1, ""] }]]);
  };
  await assert.rejects(readPartitionContentRange(read, { ...record, lastChunk: 100 }, selection), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  assert.equal(reads, 0);
  assert.equal(
    Buffer.from(await readPartitionContentRange(read, record, selection)).toString(),
    JSON.stringify(""),
  );
  assert.equal(reads, 1);
  await assert.rejects(
    readPartitionContentRange(async () => new Map(), record, selection),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
});

test("content append reads the previous chunk only to resolve a possible surrogate pair", async () => {
  const record = {
    message: { messageUid: "message" },
    firstChunk: 1,
    firstByteChunk: 1,
    lastChunk: 1,
    contentBytes: 8,
  };
  const owner = { slot: 1 };
  let reads = 0;
  const view = {
    getLatestMany: async ({ collection, keys: [key] }) => {
      assert.equal(collection, PARTITION_MESSAGE_COLLECTIONS.content);
      reads += 1;
      return new Map([[key, { owner, mutation: { value: [1, "\ud83d"] } }]]);
    },
  };
  const plain = await preparePartitionContentWrite(view, record, "x", false);
  assert.equal(reads, 0);
  assert.deepEqual(
    plain.mutations.map(({ value }) => value),
    [[7, "x"]],
  );
  assert.equal(plain.fields.contentBytes, 9);

  const paired = await preparePartitionContentWrite(view, record, "\ude00", false);
  assert.equal(reads, 1);
  assert.deepEqual(
    paired.mutations.map(({ value }) => value),
    [
      [1, ""],
      [1, "\ud83d\ude00"],
    ],
  );
  assert.equal(paired.mutations[0].owner, owner);
  assert.equal(paired.fields.firstByteChunk, 2);
  assert.equal(paired.fields.contentBytes, 6);
});

test("production message deltas coalesce into one header and retain the body version for metadata-only commits", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const transactions = new PartitionTransactions(journal);
  const first = message(sessionId, "m1");
  const ownership = { sessionId, ...scope };
  const commit = async (id, changes) =>
    repository.commit(await prepare(journal, repository, id, changes));
  const created = await commit("create", projectMessagePersistenceChange(first, null, ownership));
  const receipt = created.result.messageReceipts[0];
  const { owner } = receipt;
  const invalid = { ...first, workspaceRootDirectory: "/workspace" };
  await assert.rejects(
    commit(
      "invalid",
      projectMessagePersistenceChange(invalid, { receipt, message: first }, ownership),
    ),
    {
      code: "SESSION_MESSAGE_ENTITY_INVALID",
    },
  );
  const withTimeline = { ...first, activityTimeline: [] };
  const metadata = await commit(
    "metadata",
    projectMessagePersistenceChange(withTimeline, { receipt, message: first }, ownership),
  );
  const metadataReceipt = metadata.result.messageReceipts[0];
  assert.deepEqual(metadataReceipt.owner, owner);
  assert.equal(metadataReceipt.generation, 3);
  assert.equal(metadataReceipt.contentReference, receipt.contentReference);
  const finished = { ...first, content: "m1 tail", summarized: true };
  const combined = await commit(
    "combined",
    projectMessagePersistenceChange(
      finished,
      { receipt: metadataReceipt, message: withTimeline },
      ownership,
      " tail",
    ),
  );
  await journal.usingSnapshot(async (snapshot) => {
    const metaFrame = await transactions.read({ snapshot, reference: metadata.reference });
    assert.deepEqual(
      metaFrame.mutations.map(({ collection }) => collection),
      [PARTITION_MESSAGE_COLLECTIONS.messages],
    );
    const frame = await transactions.read({ snapshot, reference: combined.reference });
    assert.deepEqual(
      frame.mutations.map(({ collection }) => collection),
      [
        PARTITION_MESSAGE_COLLECTIONS.messages,
        PARTITION_MESSAGE_COLLECTIONS.content,
        "dialogs",
        "contextDialogRanges",
        "contextDialogRanges",
      ],
    );
    const { contentReference } = combined.result.messageReceipts[0];
    assert.equal(
      contentReference,
      partitionMessageContentVersion(snapshot.epoch, combined.generation, 0),
    );
    assert.equal(frame.mutations[0].value.contentVersion, contentReference);
    const page = await repository.readTurnPage({ snapshot, ...scope, cursor: null, limit: 2 });
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0].message.summarized, true);
    assert.equal(Object.hasOwn(page.entries[0].message, "activityTimeline"), false);
    assert.deepEqual(
      await repository.readContentPage({
        snapshot,
        ...scope,
        messageUid: "m1",
        contentReference,
        cursor: null,
        limit: 2,
      }),
      {
        entries: ["m1", " tail"],
        nextCursor: null,
      },
    );
  });
});

test("message metadata updates can exceed the partition query page size", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const messages = Array.from({ length: 9 }, (_, index) => message(sessionId, `m${index}`));
  const commit = async (id, changes) =>
    repository.commit(await prepare(journal, repository, id, changes));
  const first = await commit("create-first", { messages: messages.slice(0, 8) });
  const second = await commit("create-last", { messages: messages.slice(8) });
  const receipts = [...first.result.messageReceipts, ...second.result.messageReceipts];
  const messageMetadataUpdates = receipts.map(({ messageUid, owner, contentReference }) => ({
    ...scope,
    messageUid,
    owner,
    expectedContentReference: contentReference,
    metadata: { summarized: true },
    metadataRemovals: [],
  }));

  const updated = await commit("complete-turn", { messageMetadataUpdates });
  assert.deepEqual(
    updated.result.messageReceipts.map(({ messageUid, contentReference }) => ({
      messageUid,
      contentReference,
    })),
    receipts.map(({ messageUid, contentReference }) => ({ messageUid, contentReference })),
  );
  await journal.usingSnapshot(async (snapshot) => {
    for (const { messageUid } of receipts) {
      const entry = await repository.readMessageEntry({ snapshot, messageUid });
      assert.equal(entry.message.summarized, true);
    }
  });
});

test("only the valid creation handle can update a message in the batch", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { batchWaitMs: 25 });
  const repository = openTestMessages(journal, sessionId);
  const created = await repository.commit(
    await prepare(journal, repository, "create", {
      messages: [message(sessionId, "m1"), message(sessionId, "m2")],
    }),
  );
  const [{ owner, contentReference }, sibling] = created.result.messageReceipts;
  const append = { ...scope, messageUid: "m1", expectedContentReference: contentReference };
  const invalidInput = "SESSION_COMMIT_INPUT_INVALID";
  const wrongIdentity = "SESSION_STORAGE_IDENTITY";
  const attempts = [
    ["missing", {}, invalidInput],
    ["malformed", { owner: { ...owner, slot: -1 } }, invalidInput],
    [
      "epoch",
      {
        owner: { ...owner, epoch: `${owner.epoch[0] === "0" ? "1" : "0"}${owner.epoch.slice(1)}` },
      },
      wrongIdentity,
    ],
    ["partition", { owner: { ...owner, partition: owner.partition + 1 } }, wrongIdentity],
    ["sequence", { owner: { ...owner, sequence: owner.sequence - 1 } }, wrongIdentity],
    ["slot", { owner: { ...owner, slot: sibling.owner.slot } }, wrongIdentity],
    ["uid", { owner, messageUid: sibling.messageUid }, wrongIdentity],
    ["mixed-owners", { owner }, invalidInput],
  ];
  const rejected = await Promise.all(
    attempts.map(async ([id, fields, code]) => {
      const changes = { messageContentAppends: [{ ...append, ...fields, content: " bad" }] };
      if (id === "mixed-owners") {
        changes.messageMetadataUpdates = [
          { ...append, owner: sibling.owner, metadata: { summarized: true }, metadataRemovals: [] },
        ];
      }
      return [await prepare(journal, repository, id, changes), code];
    }),
  );
  const healthy = await prepare(journal, repository, "healthy", {
    messageContentAppends: [{ ...append, owner, content: " healthy" }],
  });
  const before = journal.work.publications;
  const results = await Promise.all(
    rejected
      .map(([request, code]) => assert.rejects(repository.commit(request), { code }))
      .concat(repository.commit(healthy)),
  );
  const success = results.at(-1);
  assert.equal(success.generation, created.generation + 1);
  assert.equal(journal.work.publications, before + 1);
  assert.deepEqual(success.result.messageReceipts[0].owner, owner);
  await journal.usingSnapshot(async (snapshot) => {
    const page = await repository.readContentPage({
      snapshot,
      ...scope,
      messageUid: append.messageUid,
      contentReference: success.result.messageReceipts[0].contentReference,
      cursor: null,
      limit: 2,
    });
    assert.deepEqual(page.entries, ["m1", " healthy"]);
  });
});

test("invalid message references do not abort healthy work in the same batch", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { batchWaitMs: 20 });
  const repository = openTestMessages(journal, sessionId);
  const first = message(sessionId, "m1");
  const created = await repository.commit(
    await prepare(journal, repository, "create", { messages: [first] }),
  );
  const [{ contentReference, owner }] = created.result.messageReceipts;
  const invalidCreates = [
    { attachments: [{}] },
    { resourceRefs: [{}] },
    { mutationRefs: [{}] },
    { transferEnvelopes: [{}] },
  ];
  const invalidChanges = invalidCreates.map((fields) => ({
    messages: [{ ...message(sessionId, "invalid"), ...fields }],
  }));
  for (const metadata of [invalidCreates[0], invalidCreates[3]]) {
    invalidChanges.push({
      messageMetadataUpdates: [
        {
          ...scope,
          messageUid: first.messageUid,
          owner,
          expectedContentReference: contentReference,
          metadata,
          metadataRemovals: [],
        },
      ],
    });
  }
  const invalid = await Promise.all(
    invalidChanges.map((changes, index) =>
      prepare(journal, repository, `invalid-${index}`, changes),
    ),
  );
  const healthy = await prepare(journal, repository, "healthy", {
    messages: [message(sessionId, "healthy")],
  });
  const before = journal.work.publications;
  const results = await Promise.allSettled([
    ...invalid.map((request) => repository.commit(request)),
    repository.commit(healthy),
  ]);
  const success = results.pop();
  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.equal(result.reason.code, "SESSION_COMMIT_INPUT_INVALID");
  }
  assert.equal(success.status, "fulfilled");
  assert.equal(success.value.generation, created.generation + 1);
  assert.equal(journal.work.publications, before + 1);
});

test("message content pages share one storage-read budget across header and chunks", async (t) => {
  const pageBytes = 4096;
  const { journal, root, sessionId } = await createMessageCase(t, { pageBytes });
  const repository = openTestMessages(journal, sessionId);
  const content = "x".repeat(2304);
  const created = await repository.commit(
    await prepare(journal, repository, "create", {
      messages: [{ ...message(sessionId, "m1"), content }],
    }),
  );
  const appended = await repository.commit(
    await prepare(journal, repository, "append", {
      messageContentAppends: [
        {
          ...scope,
          messageUid: "m1",
          owner: created.result.messageReceipts[0].owner,
          expectedContentReference: created.result.messageReceipts[0].contentReference,
          content,
        },
      ],
    }),
  );
  const verifyPages = (source, reader) =>
    source.usingSnapshot(async (snapshot) => {
      const read = (cursor, limit) =>
        reader.readContentPage({
          snapshot,
          ...scope,
          messageUid: "m1",
          contentReference: appended.result.messageReceipts[0].contentReference,
          cursor,
          limit,
        });
      const observePage = async (cursor) => {
        let failure;
        const { result, work } = await observeStorageIo(root, async () => {
          try {
            return await read(cursor, 1);
          } catch (error) {
            failure = error;
          }
        });
        const reads = JSON.stringify(Object.fromEntries(work.readBytesByPath));
        if (failure)
          throw new Error(`Page reads: ${reads}; ${failure.message}`, { cause: failure });
        assert.ok(work.readBytes <= snapshot.limits.pageBytes, reads);
        return result;
      };
      const chunks = [];
      let cursor = null;
      do {
        const page = await observePage(cursor);
        assert.equal(page.entries.length, 1);
        chunks.push(...page.entries);
        cursor = page.nextCursor;
      } while (cursor !== null);
      assert.equal(chunks.join(""), content + content);
      await assert.rejects(read(null, 4), {
        code: "SESSION_QUERY_BUDGET",
        message: /read byte budget/,
      });
    });
  await verifyPages(journal, repository);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await verifyPages(reopened, openTestMessages(reopened, sessionId));
});

test("same-batch message append reads the staged creation version and publishes once", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { batchWaitMs: 10 });
  const repository = openTestMessages(journal, sessionId);
  const create = await prepare(journal, repository, "create", {
    messages: [message(sessionId, "m1")],
  });
  const expectedContentReference = partitionMessageContentVersion(
    create.epoch,
    create.expectedGeneration + 1,
    0,
  );
  const owner = {
    epoch: create.epoch,
    partition: 0,
    sequence: create.expectedGeneration + 1,
    slot: 0,
  };
  const append = {
    epoch: create.epoch,
    expectedGeneration: create.expectedGeneration + 1,
    operationId: "append",
    input: {
      committedAt,
      changes: {
        messageContentAppends: [
          { ...scope, messageUid: "m1", owner, expectedContentReference, content: " tail" },
        ],
      },
    },
  };
  const publications = journal.work.publications;
  const [created, appended] = await Promise.all([
    repository.commit(create),
    repository.commit(append),
  ]);
  assert.equal(journal.work.publications, publications + 1);
  assert.equal(created.result.messageReceipts[0].contentReference, expectedContentReference);
  assert.deepEqual(appended.result.messageReceipts[0].owner, owner);
  await journal.usingSnapshot(async (snapshot) => {
    assert.equal(snapshot.sequence, append.expectedGeneration + 1);
    assert.deepEqual(
      await repository.readContentPage({
        snapshot,
        ...scope,
        messageUid: "m1",
        contentReference: appended.result.messageReceipts[0].contentReference,
        cursor: null,
        limit: 2,
      }),
      {
        entries: ["m1", " tail"],
        nextCursor: null,
      },
    );
  });
});
