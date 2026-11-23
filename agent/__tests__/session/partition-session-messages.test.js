/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  committedAt,
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

test("business message creation, append and retained paging across sealed partitions", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { partitionRecords: 3 });
  const repository = openTestMessages(journal, sessionId);
  const create = await prepare(journal, repository, "create", {
    messages: [message(sessionId, "m1"), message(sessionId, "m2")],
  });
  const {
    result: {
      messageReceipts: [first, second],
    },
  } = await repository.commit(create);
  assert.notEqual(first.contentReference, second.contentReference);
  await journal.usingSnapshot(async (old) => {
    const readTurn = (snapshot, cursor = null) =>
      repository.readTurnPage({ snapshot, ...scope, cursor, limit: 1 });
    const oldPage = await readTurn(old);
    assert.equal(oldPage.entries[0].message.messageUid, "m1");
    assert.deepEqual(oldPage.entries[0].owner, first.owner);
    assert.equal((await readTurn(old, oldPage.nextCursor)).entries[0].message.messageUid, "m2");

    const append = (reference, content) => ({
      messageContentAppends: [
        {
          ...scope,
          messageUid: "m1",
          owner: first.owner,
          expectedContentReference: reference,
          content,
        },
      ],
    });
    const wrong = await prepare(
      journal,
      repository,
      "wrong-message-version",
      append(second.contentReference, "discard"),
    );
    const request = await prepare(
      journal,
      repository,
      "append-1",
      append(first.contentReference, "\npart 1"),
    );
    const [, outcome] = await Promise.all([
      assert.rejects(repository.commit(wrong), {
        code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT",
        statusCode: 409,
      }),
      repository.commit(request),
    ]);
    const next = await prepare(
      journal,
      repository,
      "append-2",
      append(outcome.result.messageReceipts[0].contentReference, "part 2"),
    );
    const last = await repository.commit(next);
    assert.ok(last.reference.partition > outcome.reference.partition);
    const readContent = (snapshot, contentReference, cursor = null) =>
      repository.readContentPage({
        snapshot,
        ...scope,
        messageUid: "m1",
        contentReference,
        cursor,
        limit: 1,
      });
    await journal.usingSnapshot(async (snapshot) => {
      assert.equal(snapshot.sequence, 4);
      const reference = last.result.messageReceipts[0].contentReference;
      const chunks = [];
      let cursor = null;
      do {
        const page = await readContent(snapshot, reference, cursor);
        chunks.push(...page.entries);
        cursor = page.nextCursor;
      } while (cursor !== null);
      assert.deepEqual(chunks, ["m1", "\npart 1", "part 2"]);
      await assert.rejects(readTurn(snapshot, oldPage.nextCursor), {
        code: "SESSION_PAGE_CURSOR_CONFLICT",
      });
    });
    assert.deepEqual(await readContent(old, first.contentReference), {
      entries: ["m1"],
      nextCursor: null,
    });
    const script = `
    import { PartitionJournal } from ${JSON.stringify(new URL("../../src/session/partition-storage/partition-journal.js", import.meta.url).href)};
    import { PartitionSessionMessages } from ${JSON.stringify(new URL("../../src/session/partition-storage/partition-session-messages.js", import.meta.url).href)};
    import { observeStorageIo } from ${JSON.stringify(new URL("../helpers/storage-io-observation.js", import.meta.url).href)};
    const [root, sessionId, request, selection] = process.argv.slice(1);
    const { result: journal, work: opening } = await observeStorageIo(root, () =>
      PartitionJournal.open({ root, sessionId }),
    );
    try {
      const repository = new PartitionSessionMessages(journal, { sessionId, parentSessionId: "" });
      const { contentReference, owner, ...identity } = JSON.parse(selection);
      const { result: append, work: preparation } = await observeStorageIo(root, () =>
        journal.usingSnapshot((snapshot) => repository.prepareRequest(snapshot, {
          operationId: "append-after-reopen",
          committedAt: ${JSON.stringify(committedAt)},
          changes: { messageContentAppends: [
            { ...identity, owner, expectedContentReference: contentReference, content: " new process" },
          ] },
        })),
      );
      const { result: outcome, work: commit } = await observeStorageIo(root, () => repository.commit(append));
      const publications = journal.work.publications;
      const replay = await repository.commit(JSON.parse(request));
      const replayPublications = journal.work.publications - publications;
      const page = await journal.usingSnapshot((snapshot) => repository.readContentPage({
        snapshot, ...identity, contentReference: outcome.result.messageReceipts[0].contentReference,
        cursor: null, limit: 4,
      }));
      const io = {
        openReadBytes: opening.readBytes,
        prepareReadBytes: preparation.readBytes,
        commitReadBytes: commit.readBytes,
        commitWriteBytes: commit.writeBytes,
      };
      console.log(JSON.stringify({ replay, replayPublications, outcome, page, io, publications }));
    } finally { await journal.close(); }
  `;
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import",
      new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
      "-e",
      script,
      root,
      sessionId,
      JSON.stringify(request),
      JSON.stringify({
        ...scope,
        messageUid: "m1",
        owner: first.owner,
        contentReference: last.result.messageReceipts[0].contentReference,
      }),
    ]);
    const {
      replay,
      replayPublications,
      outcome: appended,
      page,
      io,
      publications,
    } = JSON.parse(stdout);
    assert.deepEqual(replay, { ...outcome, replayed: true });
    assert.equal(replayPublications, 0);
    assert.equal(publications, 1);
    assert.equal(appended.generation, last.generation + 1);
    assert.deepEqual(appended.result.messageReceipts[0].owner, first.owner);
    assert.ok(appended.reference.partition > outcome.reference.partition);
    assert.deepEqual(page, {
      entries: ["m1", "\npart 1", "part 2", " new process"],
      nextCursor: null,
    });
    for (const bytes of Object.values(io)) assert.ok(Number.isSafeInteger(bytes) && bytes > 0);
    t.diagnostic(`Cold append storage adapter bytes: ${JSON.stringify(io)}`);
    assert.deepEqual(await readContent(old, first.contentReference), {
      entries: ["m1"],
      nextCursor: null,
    });
  });
});

test("body replacement publishes a new visible range, preserves old snapshots and replays after reopen", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const transactions = new PartitionTransactions(journal);
  const messageUid = "m1";
  const selection = { ...scope, messageUid };
  const commit = async (id, changes) =>
    repository.commit(await prepare(journal, repository, id, changes));
  const reference = ({ result }) => result.messageReceipts[0].contentReference;
  const read = (snapshot, contentReference, cursor = null) =>
    repository.readContentPage({ snapshot, ...selection, contentReference, cursor, limit: 1 });
  const created = await commit("create", { messages: [message(sessionId, messageUid)] });
  const { owner } = created.result.messageReceipts[0];
  const write = (expectedContentReference, content) => ({
    ...selection,
    owner,
    expectedContentReference,
    content,
  });
  const original = await commit("append-old", {
    messageContentAppends: [write(reference(created), "old tail")],
  });
  const { request, replaced } = await journal.usingSnapshot(async (old) => {
    const originalRef = reference(original);
    const before = journal.work.publications;
    await assert.rejects(
      commit("stale", {
        messageContentReplacements: [write(reference(created), "discard")],
      }),
      { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT", statusCode: 409 },
    );
    await assert.rejects(
      commit("foreign", {
        messageContentReplacements: [{ ...write(originalRef, "discard"), turnScopeId: "other" }],
      }),
      { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" },
    );
    await assert.rejects(
      commit("oversized", {
        messageContentReplacements: [
          write(originalRef, "x".repeat(journal.head.limits.transactionBytes)),
        ],
      }),
      { code: "SESSION_TRANSACTION_BUDGET" },
    );
    assert.equal(journal.work.publications, before);

    const request = await prepare(journal, repository, "replace", {
      messageContentReplacements: [write(originalRef, "")],
      messageMetadataUpdates: [
        {
          ...selection,
          owner,
          expectedContentReference: originalRef,
          metadata: { summarized: true },
          metadataRemovals: [],
        },
      ],
    });
    const replaced = await repository.commit(request);
    const replacedRef = reference(replaced);
    assert.notEqual(replacedRef, originalRef);
    assert.equal(journal.work.publications, before + 1);
    const displaySelection = { cursor: null, direction: "forward", limit: 1, maxBytes: 4096 };
    await journal.usingSnapshot(async (snapshot) => {
      const frame = await transactions.read({ snapshot, reference: replaced.reference });
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
      const display = await repository.readDisplayPage({ snapshot, selection: displaySelection });
      assert.equal(display.messages[0].messageUid, messageUid);
      assert.equal(display.messages[0].summarized, true);
      assert.equal(display.messages[0].contentReference, replacedRef);
      assert.equal(display.messages[0].contentBytes, 2);
      const page = await repository.readTurnPage({ snapshot, ...scope, cursor: null, limit: 1 });
      assert.equal(page.entries[0].message.summarized, true);
      assert.deepEqual(await read(snapshot, replacedRef), { entries: [""], nextCursor: null });
      await assert.rejects(read(snapshot, originalRef), {
        code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT",
      });
    });
    const appended = await commit("append-new", {
      messageContentAppends: [write(replacedRef, "new tail")],
    });
    await journal.usingSnapshot(async (snapshot) => {
      const page = await read(snapshot, reference(appended));
      assert.deepEqual(page.entries, [""]);
      assert.deepEqual(await read(snapshot, reference(appended), page.nextCursor), {
        entries: ["new tail"],
        nextCursor: null,
      });
    });
    const oldPage = await read(old, originalRef);
    const oldDisplay = await repository.readDisplayPage({
      snapshot: old,
      selection: displaySelection,
    });
    assert.equal(oldDisplay.messages[0].messageUid, messageUid);
    assert.equal(oldDisplay.messages[0].summarized, false);
    assert.equal(oldDisplay.messages[0].contentReference, originalRef);
    assert.equal(
      oldDisplay.messages[0].contentBytes,
      Buffer.byteLength(JSON.stringify(`${messageUid}old tail`)),
    );
    assert.deepEqual(oldPage.entries, [messageUid]);
    assert.deepEqual(await read(old, originalRef, oldPage.nextCursor), {
      entries: ["old tail"],
      nextCursor: null,
    });
    return { request, replaced };
  });

  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = openTestMessages(reopened, sessionId);
  const published = await readFile(join(root, "CURRENT"));
  assert.deepEqual(await cold.commit(request), { ...replaced, replayed: true });
  assert.deepEqual(await readFile(join(root, "CURRENT")), published);
});

test("message creation conflicts leave the published generation intact", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const first = message(sessionId, "m1");
  const publications = journal.work.publications;
  for (const [id, messages, code] of [
    ["duplicate", [first, first], "SESSION_MESSAGE_IDENTITY_CONFLICT"],
    ["other-session", [message("other-session", "m2")], "SESSION_MESSAGE_IDENTITY_CONFLICT"],
    ["non-text", [{ ...first, content: [] }], "SESSION_MESSAGE_ENTITY_INVALID"],
  ]) {
    const request = await prepare(journal, repository, id, { messages });
    await assert.rejects(repository.commit(request), { code });
  }
  assert.equal(journal.work.publications, publications);
  await journal.usingSnapshot((snapshot) => assert.equal(snapshot.sequence, 1));
  await repository.commit(await prepare(journal, repository, "create", { messages: [first] }));
  const existing = await prepare(journal, repository, "existing", { messages: [first] });
  await assert.rejects(repository.commit(existing), { code: "SESSION_ENTITY_EXISTS" });
  const foreignTurn = await prepare(journal, repository, "foreign-turn", {
    messages: [{ ...message(sessionId, "m2"), dialogProcessId: "dialog-2" }],
  });
  await assert.rejects(repository.commit(foreignTurn), { code: "SESSION_TURN_IDENTITY_CONFLICT" });
  await journal.usingSnapshot((snapshot) => assert.equal(snapshot.sequence, 2));
});

test("cold message creation rejects a sealed UID without reading its prior value", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t, { partitionRecords: 1 });
  const repository = openTestMessages(journal, sessionId);
  const first = message(sessionId, "m1");
  const firstCommit = await repository.commit(
    await prepare(journal, repository, "create", { messages: [first] }),
  );
  const second = { ...message(sessionId, "m2"), turnScopeId: "turn-2" };
  const secondCommit = await repository.commit(
    await prepare(journal, repository, "roll", { messages: [second] }),
  );
  assert.ok(secondCommit.reference.partition > firstCommit.reference.partition);

  const reopened = await PartitionJournal.open({ root, sessionId });
  try {
    const cold = openTestMessages(reopened, sessionId);
    const request = await prepare(reopened, cold, "duplicate", {
      messages: [{ ...first, turnScopeId: "turn-3" }],
    });
    const readRecordSlots = reopened.readRecordSlots.bind(reopened);
    reopened.readRecordSlots = (query) => {
      assert.notEqual(query.reference.sequence, firstCommit.generation);
      return readRecordSlots(query);
    };
    const before = reopened.work.publications;
    await assert.rejects(cold.commit(request), { code: "SESSION_ENTITY_EXISTS" });
    assert.equal(reopened.work.publications, before);
    await reopened.usingSnapshot((snapshot) => {
      assert.equal(snapshot.sequence, request.expectedGeneration);
    });
  } finally {
    await reopened.close();
  }
});
