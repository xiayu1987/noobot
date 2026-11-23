/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { withPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { listSnapshotRetentionFiles } from "../helpers/partition-journal-cases.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

test("scoped partition reader binds generation and releases retention after its callback", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  let escaped;
  await withPartitionSessionReader({ journal, sessionId, parentSessionId: "" }, async (reader) => {
    escaped = reader;
    const original = await reader.readMetadata();
    assert.equal(reader.generation, journal.head.sequence);
    await messages.commit(
      await prepare(journal, messages, "settings", {
        sessionMetadata: { customTitle: "new title" },
      }),
    );
    assert.deepEqual(await reader.readMetadata(), original);
    await withPartitionSessionReader(
      { journal, sessionId, parentSessionId: "" },
      async (current) => {
        assert.ok(current.generation > reader.generation);
        assert.equal((await current.readMetadata()).customTitle, "new title");
      },
    );
  });
  await assert.rejects(escaped.readMetadata(), { code: "SESSION_READER_CLOSED" });
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("partition reader rejects foreign scope and callback failures without leaking retention", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  let invoked = false;
  await assert.rejects(
    withPartitionSessionReader({ journal, sessionId, parentSessionId: "foreign" }, () => {
      invoked = true;
    }),
    { code: "SESSION_SCOPE_IDENTITY_CONFLICT" },
  );
  assert.equal(invoked, false);
  const failure = new Error("consumer failure");
  let escaped;
  await assert.rejects(
    withPartitionSessionReader({ journal, sessionId, parentSessionId: "" }, async (reader) => {
      escaped = reader;
      throw failure;
    }),
    (error) => error === failure,
  );
  await assert.rejects(escaped.readMetadata(), { code: "SESSION_READER_CLOSED" });
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("first turn message reads only committed content from the retained snapshot", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const options = { journal, sessionId, parentSessionId: "" };
  const { turnScopeId } = scope;
  const first = message(sessionId, "m1");
  const request = await prepare(journal, messages, "create", {
    messages: [first, message(sessionId, "m2")],
  });
  await withPartitionSessionReader(options, async (empty) => {
    assert.equal(await empty.readFirstTurnMessage(turnScopeId), null);
    const committed = await messages.commit(request);
    assert.equal(await empty.readFirstTurnMessage(turnScopeId), null);
    assert.deepEqual(await messages.commit(request), { ...committed, replayed: true });
    const [{ owner, contentReference }] = committed.result.messageReceipts;
    await withPartitionSessionReader(options, async (reader) => {
      const original = await reader.readFirstTurnMessage(turnScopeId);
      assert.equal(original.messageUid, first.messageUid);
      assert.equal(original.content, first.content);
      assert.deepEqual(original.attachments, first.attachments);
      await messages.commit(
        await prepare(journal, messages, "append-first", {
          messageContentAppends: [
            {
              ...scope,
              messageUid: first.messageUid,
              owner,
              expectedContentReference: contentReference,
              content: " tail",
            },
          ],
        }),
      );
      assert.deepEqual(await reader.readFirstTurnMessage(turnScopeId), original);
      await withPartitionSessionReader(options, async (current) => {
        const headerBytes =
          Buffer.byteLength(JSON.stringify(original)) -
          Buffer.byteLength(JSON.stringify(original.content)) -
          Buffer.byteLength(',"content":');
        await assert.rejects(current.readFirstTurnMessage(turnScopeId, headerBytes + 2), {
          code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
        });
        assert.equal((await current.readFirstTurnMessage(turnScopeId)).content, "m1 tail");
      });
    });
  });
});

test("scoped body pages bind dialog and pinned generation across publication and reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { pageRecords: 2 });
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "seed", {
      messages: [message(sessionId, "m1"), message(sessionId, "m2")],
    }),
  );
  await messages.commit(
    await prepare(journal, messages, "extend-seed", {
      messages: [message(sessionId, "m3")],
    }),
  );
  const options = { journal, sessionId, parentSessionId: "" };
  const query = { lookupKey: scope, cursor: null, limit: 3 };
  const foreign = { ...query, lookupKey: { ...scope, dialogProcessId: "other-dialog" } };
  let request;
  let result;
  let escaped;
  await withPartitionSessionReader(options, async (reader, commit, readCurrent) => {
    escaped = reader;
    assert.equal(await reader.readScopedTurnMessagePage(foreign), null);
    await assert.rejects(reader.readScopedTurnMessagePage({ ...query, maxBytes: 1 }), {
      code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
    });
    const first = await reader.readScopedTurnMessagePage(query);
    assert.equal(first.generation, reader.generation);
    assert.equal(first.messageCount, 3);
    assert.deepEqual(
      first.records.map(({ message }) => message.content),
      ["m1", "m2"],
    );
    assert.ok(first.nextCursor);
    const next = { ...query, cursor: first.nextCursor };
    const entryQuery = { ...scope, cursor: null, limit: 2 };
    const entries = await reader.readTurnMessageEntryPage(entryQuery);
    assert.ok(entries.nextCursor);
    await assert.rejects(
      reader.readScopedTurnMessagePage({ ...query, cursor: entries.nextCursor }),
      { code: "SESSION_PAGE_CURSOR_CONFLICT" },
    );
    await assert.rejects(
      reader.readTurnMessageEntryPage({ ...entryQuery, cursor: first.nextCursor }),
      { code: "SESSION_PAGE_CURSOR_CONFLICT" },
    );
    const finalEntries = await reader.readTurnMessageEntryPage({
      ...entryQuery,
      cursor: entries.nextCursor,
    });
    assert.equal(finalEntries.entries.length, 1);
    assert.equal(finalEntries.nextCursor, null);
    await assert.rejects(
      reader.readScopedTurnMessagePage({ ...foreign, cursor: first.nextCursor }),
      {
        code: "SESSION_PAGE_CURSOR_CONFLICT",
      },
    );
    await assert.rejects(
      reader.readScopedTurnMessagePage({ ...next, cursor: { ...first.nextCursor, after: 3 } }),
      {
        code: "SESSION_PAGE_CURSOR_CONFLICT",
      },
    );
    request = await prepare(journal, messages, "append", { messages: [message(sessionId, "m4")] });
    result = await commit(request);
    const last = await reader.readScopedTurnMessagePage(next);
    assert.equal(last.generation, first.generation);
    assert.equal(last.messageCount, 3);
    assert.equal(last.nextCursor, null);
    assert.deepEqual(
      last.records.map(({ message }) => message.content),
      ["m3"],
    );
    await readCurrent(async (current) => {
      await assert.rejects(current.readScopedTurnMessagePage(next), {
        code: "SESSION_PAGE_CURSOR_CONFLICT",
      });
      assert.equal((await current.readScopedTurnMessagePage(query)).messageCount, 4);
    });
  });
  await assert.rejects(escaped.readScopedTurnMessagePage(query), { code: "SESSION_READER_CLOSED" });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await withPartitionSessionReader({ ...options, journal: reopened }, async (reader, commit) => {
    const publications = reopened.work.publications;
    assert.deepEqual(await commit(request), { ...result, replayed: true });
    assert.equal(reopened.work.publications, publications);
    assert.equal(reopened.head.sequence, reader.generation);
    const first = await reader.readScopedTurnMessagePage(query);
    const last = await reader.readScopedTurnMessagePage({ ...query, cursor: first.nextCursor });
    assert.equal(last.messageCount, 4);
    assert.deepEqual(
      last.records.map(({ message }) => message.content),
      ["m3", "m4"],
    );
  });
});

test("scoped message pages retain order, suffix and content across a concurrent append", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const created = await messages.commit(
    await prepare(journal, messages, "create", {
      messages: [message(sessionId, "m1"), message(sessionId, "m2")],
    }),
  );
  const [{ owner, contentReference }] = created.result.messageReceipts;
  const content = { ...scope, messageUid: "m1", contentReference, cursor: null, limit: 1 };
  let escaped;
  await withPartitionSessionReader({ journal, sessionId, parentSessionId: "" }, async (reader) => {
    escaped = reader;
    const turn = await reader.readTurnMessageEntryPage({ ...scope, cursor: null, limit: 1 });
    const selection = { turnScopeId: scope.turnScopeId, limit: 1 };
    const first = await reader.readTurnPage(selection);
    assert.equal(first.generation, reader.generation);
    assert.equal(first.cursor, 1);
    assert.equal(first.hasMore, true);
    assert.equal(first.records[0].message.content, "m1");
    await assert.rejects(reader.readTurnPage({ ...selection, maxBytes: 1 }), {
      code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
    });
    const order = await reader.readSessionMessageOrderPage({ cursor: null, limit: 1 });
    const suffix = await reader.readMessageSuffixPage({
      turnScopeId: scope.turnScopeId,
      cursor: null,
      limit: 1,
    });
    assert.equal(turn.entries[0].contentReference, contentReference);
    assert.deepEqual(turn.entries[0].owner, owner);
    assert.deepEqual(order.entries, ["m1"]);
    assert.deepEqual(suffix.entries, ["m1"]);
    await messages.commit(
      await prepare(journal, messages, "append", {
        messages: [message(sessionId, "m3")],
        messageContentAppends: [
          {
            ...scope,
            messageUid: "m1",
            owner,
            expectedContentReference: contentReference,
            content: " tail",
          },
        ],
      }),
    );
    assert.deepEqual(await reader.readContentPage({ ...content, snapshot: journal.head }), {
      entries: ["m1"],
      nextCursor: null,
    });
    assert.deepEqual(
      await reader.readSessionMessageOrderPage({ cursor: order.nextCursor, limit: 1 }),
      {
        entries: ["m2"],
        nextCursor: null,
      },
    );
    const lastTurn = await reader.readTurnMessageEntryPage({
      ...scope,
      cursor: turn.nextCursor,
      limit: 1,
    });
    const last = await reader.readTurnPage({
      ...selection,
      after: first.cursor,
      snapshot: journal.head,
    });
    assert.equal(last.generation, first.generation);
    assert.equal(last.cursor, 2);
    assert.equal(last.hasMore, false);
    assert.equal(last.records[0].message.content, "m2");
    assert.equal(lastTurn.entries[0].message.messageUid, "m2");
    assert.equal(lastTurn.nextCursor, null);
    const lastSuffix = await reader.readMessageSuffixPage({
      turnScopeId: scope.turnScopeId,
      cursor: suffix.nextCursor,
      limit: 1,
    });
    assert.deepEqual(lastSuffix.entries, ["m2"]);
    assert.equal(lastSuffix.nextCursor, null);
    await withPartitionSessionReader(
      { journal, sessionId, parentSessionId: "" },
      async (current) => {
        const latest = await current.readTurnMessageEntryPage({ ...scope, cursor: null, limit: 3 });
        const body = await current.readTurnPage({ ...selection, limit: 3 });
        assert.deepEqual(
          body.records.map(({ message }) => message.content),
          ["m1 tail", "m2", "m3"],
        );
        assert.deepEqual(
          latest.entries.map(({ message }) => message.messageUid),
          ["m1", "m2", "m3"],
        );
        await assert.rejects(
          current.readSessionMessageOrderPage({ cursor: order.nextCursor, limit: 1 }),
          {
            code: "SESSION_PAGE_CURSOR_CONFLICT",
          },
        );
        await assert.rejects(current.readContentPage(content), {
          code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT",
        });
        const updated = { ...content, contentReference: latest.entries[0].contentReference };
        const first = await current.readContentPage(updated);
        assert.deepEqual(first.entries, ["m1"]);
        assert.ok(first.nextCursor);
        assert.deepEqual(await current.readContentPage({ ...updated, cursor: first.nextCursor }), {
          entries: [" tail"],
          nextCursor: null,
        });
      },
    );
  });
  for (const [method, options] of [
    ["readTurnPage", { turnScopeId: scope.turnScopeId, limit: 1 }],
    ["readTurnMessageEntryPage", { ...scope, cursor: null, limit: 1 }],
    ["readSessionMessageOrderPage", { cursor: null, limit: 1 }],
    ["readMessageSuffixPage", { turnScopeId: scope.turnScopeId, cursor: null, limit: 1 }],
    ["readContentPage", content],
  ])
    await assert.rejects(escaped[method](options), { code: "SESSION_READER_CLOSED" });
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});
