/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { openImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { commitSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { registerDialogOrderMessage } from "../../src/session/entities/dialog-order-entity.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { collectValueRecords, forbidRecordReads } from "./helpers/immutable-record-reads.js";
import { MESSAGE_READ_BUDGET_ERROR } from "@noobot/session-protocol/message-read-budget";

const ts = "2026-01-01T00:00:00.000Z";
function message(uid, scope = uid, dialog = scope) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: dialog,
    parentDialogProcessId: "",
    turnScopeId: scope,
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: uid,
    attachments: [],
    ts,
  };
}
async function fixture(t, messages) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-range-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      modelAlias: "",
      shortMemoryCheckpoint: 0,
      selectedConnectorIds: [],
      messages,
      dialogOrder: messages.reduce(registerDialogOrderMessage, []),
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  const open = () =>
    openImmutableSessionReader({ sessionDir, sessionId: "s1", parentSessionId: "" });
  return { store, open };
}

test("message selection shares its budget and preserves order and missing records", async (t) => {
  const content = "a".repeat(6000);
  const { open } = await fixture(t, [
    { ...message("first", "target"), content },
    { ...message("second", "target"), content },
  ]);
  await using reader = await open();
  for (const uid of ["first", "second"])
    assert.equal(
      (await reader.readMessages({ messageUids: [uid], maxBytes: 10000 }))[0].message.content,
      content,
    );
  await assert.rejects(reader.readMessages({ messageUids: ["first", "second"], maxBytes: 10000 }), {
    code: MESSAGE_READ_BUDGET_ERROR,
  });
  const records = await reader.readMessages({ messageUids: ["second", "missing", "first"] });
  assert.deepEqual(
    records.map((record) => record?.message.messageUid ?? null),
    ["second", null, "first"],
  );
  assert.deepEqual(await reader.readMessages({ messageUids: [] }), []);
  assert.equal((await reader.readMessage("first")).message.content, content);
  assert.equal(await reader.readMessage("missing"), null);
});

test("message tail pages use global positions across turns and a pinned generation", async (t) => {
  const { store, open } = await fixture(t, [
    message("keep"),
    message("anchor", "target"),
    message("second", "target"),
    message("tail"),
  ]);
  const reader = await open();
  const first = await reader.readMessageTailPage({ turnScopeId: "target", limit: 1 });
  assert.deepEqual(first.messageSuffix, { firstOrdinal: 2, previousMessageCount: 4 });
  assert.equal(first.nextCursor.after, 1);
  assert.deepEqual(
    first.records.map((record) => record.message.messageUid),
    ["anchor"],
  );
  await commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: "s1",
    expectedGeneration: reader.generation,
    operationId: "append",
    changes: { messages: [message("new")] },
    committedAt: ts,
  });
  const next = await reader.readMessageTailPage({
    turnScopeId: "target",
    cursor: first.nextCursor,
  });
  assert.deepEqual(
    next.records.map((record) => record.message.messageUid),
    ["second", "tail"],
  );
  assert.equal(next.nextCursor, null);
  assert.equal(next.generation, reader.generation);
  await assert.rejects(
    reader.readMessageTailPage({
      turnScopeId: "target",
      cursor: { ...first.nextCursor, after: 3 },
    }),
    { code: "SESSION_PAGE_CURSOR_CONFLICT" },
  );
  await using reopened = await open();
  const current = await reopened.readMessageTailPage({ turnScopeId: "target" });
  assert.deepEqual(current.messageSuffix, { firstOrdinal: 2, previousMessageCount: 5 });
  assert.equal(current.records.at(-1).message.messageUid, "new");
  await assert.rejects(
    reopened.readMessageTailPage({ turnScopeId: "target", cursor: first.nextCursor }),
    { code: "SESSION_PAGE_CURSOR_CONFLICT" },
  );
  await assert.rejects(
    reader.readMessageTailPage({ turnScopeId: "keep", cursor: first.nextCursor }),
    { code: "SESSION_PAGE_CURSOR_CONFLICT" },
  );
  assert.equal(await reader.readMessageTailPage({ turnScopeId: "missing" }), null);
});

test("global pages preserve committed order across turns and pin the publication", async (t) => {
  const { store, open } = await fixture(t, [
    message("one", "a"),
    message("two", "b"),
    message("three", "a"),
  ]);
  await using reader = await open();
  const first = await reader.readMessagePage({ limit: 1 });
  const { message: storedMessage } = await reader.readMessage("one");
  assert.deepEqual(first.records, [{ ordinal: 1, turnOrdinal: 1, message: storedMessage }]);
  assert.equal(first.generation, reader.generation);
  assert.equal(first.messageCount, 3);
  await commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: "s1",
    expectedGeneration: reader.generation,
    operationId: "append-after-global-page",
    changes: { messages: [message("four")] },
    committedAt: ts,
  });
  const last = await reader.readMessagePage({ cursor: first.nextCursor });
  assert.equal(last.messageCount, 3);
  assert.equal(last.nextCursor, null);
  assert.deepEqual(
    [...first.records, ...last.records].map(({ ordinal, message }) => [
      ordinal,
      message.messageUid,
    ]),
    [
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ],
  );
  const cursorError = { code: "SESSION_PAGE_CURSOR_CONFLICT" };
  const suffix = await reader.readMessageTailPage({ turnScopeId: "a", limit: 1 });
  await assert.rejects(reader.readMessagePage({ cursor: suffix.nextCursor }), cursorError);
  await assert.rejects(
    reader.readMessagePage({ cursor: { ...first.nextCursor, after: 3 } }),
    cursorError,
  );
  await using current = await open();
  await assert.rejects(current.readMessagePage({ cursor: first.nextCursor }), cursorError);
  assert.equal((await current.readMessagePage()).messageCount, 4);
});

test("global pages return a terminal page from an empty snapshot", async (t) => {
  const { open } = await fixture(t, []);
  await using reader = await open();
  assert.deepEqual(await reader.readMessagePage(), {
    generation: reader.generation,
    messageCount: 0,
    records: [],
    nextCursor: null,
  });
});

test("tail continuation checks the anchor against global order after reopen", async (t) => {
  const { store, open } = await fixture(t, [message("anchor"), message("tail")]);
  await using retained = await open();
  await store.commit({
    expectedGeneration: retained.generation,
    operationId: "corrupt-anchor-order",
    changes: [{ collection: "messageOrder", key: immutableOrderKey(1), value: "tail" }],
  });
  await using reopened = await open();
  await assert.rejects(reopened.readMessageTailPage({ turnScopeId: "anchor" }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    message: "Message range anchor disagrees with global order",
  });
  const first = await retained.readMessageTailPage({ turnScopeId: "anchor", limit: 1 });
  const page = await retained.readMessageTailPage({
    turnScopeId: "anchor",
    cursor: first.nextCursor,
  });
  assert.deepEqual(
    page.records.map((record) => record.message.messageUid),
    ["tail"],
  );
});

test("cold tail selection reads no retained message bodies", async (t) => {
  const prefix = Array.from({ length: 128 }, (_, index) => message(`keep-${index}`));
  const { store, open } = await fixture(t, [
    ...prefix,
    message("anchor", "target"),
    message("tail"),
  ]);
  const snapshot = await store.snapshot();
  const references = await store.objects.withSnapshot(snapshot, async () => {
    const messagesRoot = await store.index.get(snapshot.root, "messages");
    const identities = new Set();
    for (const item of prefix) {
      const reference = await store.index.get(messagesRoot, item.messageUid);
      assert.ok(reference);
      identities.add(reference);
    }
    return identities;
  });
  setFsAdapter(await forbidRecordReads(store, references));
  t.after(resetFsAdapter);
  const page = await (await open()).readMessageTailPage({ turnScopeId: "target" });
  assert.deepEqual(page.messageSuffix, { firstOrdinal: 129, previousMessageCount: 130 });
  assert.deepEqual(
    page.records.map((record) => record.message.messageUid),
    ["anchor", "tail"],
  );
});

test("tail selection rejects invalid cursors and page sizes", async (t) => {
  const { open } = await fixture(t, [message("k1"), message("k2"), message("anchor")]);
  const reader = await open();
  for (const options of [
    { cursor: -1 },
    { cursor: 1 },
    { cursor: { after: 1, scope: "foreign" } },
    { limit: 0 },
    { limit: 257 },
    { limit: 1.5 },
    { turnScopeId: " " },
  ])
    await assert.rejects(
      reader.readMessageTailPage({ turnScopeId: "anchor", ...options }),
      TypeError,
    );
});

test("tail selection reports missing global positions instead of skipping them", async (t) => {
  const { store, open } = await fixture(t, [message("anchor"), message("tail")]);
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "damage",
    changes: [{ collection: "messageOrder", key: immutableOrderKey(2), remove: true }],
  });
  await assert.rejects((await open()).readMessageTailPage({ turnScopeId: "anchor" }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

for (const method of ["readTurnPage", "readMessageTailPage", "readMessagePage"]) {
  test(`${method} shares a byte budget across all returned messages`, async (t) => {
    const { open } = await fixture(t, [
      { ...message("one", "target"), content: "a".repeat(8192) },
      { ...message("two", "target"), content: "b".repeat(8192) },
    ]);
    await using reader = await open();
    const options = { turnScopeId: "target", maxBytes: 12 * 1024 };
    const first = await reader[method]({ ...options, limit: 1 });
    assert.equal(first.records[0].message.content.length, 8192);
    await assert.rejects(reader[method]({ ...options, limit: 2 }), {
      code: MESSAGE_READ_BUDGET_ERROR,
    });
    const continuation =
      method === "readTurnPage" ? { after: first.cursor } : { cursor: first.nextCursor };
    const second = await reader[method]({ ...options, ...continuation, limit: 1 });
    assert.equal(second.records[0].message.messageUid, "two");
    if (method === "readTurnPage") assert.equal(second.hasMore, false);
    else assert.equal(second.nextCursor, null);
  });
}

test("tail paging uses anchor metadata without expanding an earlier oversized body", async (t) => {
  const { store, open } = await fixture(t, [
    { ...message("anchor", "target"), content: "a".repeat(128 * 1024) },
    message("tail", "target"),
  ]);
  const snapshot = await store.snapshot();
  const anchor = (await store.getManyMetadata(snapshot, "messages", ["anchor"])).get("anchor");
  const references = new Set();
  for (const { reference } of anchor.parts) await collectValueRecords(store, reference, references);
  assert.ok(references.size > 1);
  const adapter = await forbidRecordReads(store, references);
  await using reader = await open();
  const { nextCursor } = await reader.readMessageTailPage({ turnScopeId: "target", limit: 1 });
  setFsAdapter(adapter);
  try {
    const page = await reader.readMessageTailPage({
      turnScopeId: "target",
      cursor: nextCursor,
      limit: 1,
      maxBytes: 4096,
    });
    assert.equal(page.records[0].message.content, "tail");
  } finally {
    resetFsAdapter();
  }
});

test("page byte budget rejects an oversized content tree before reading descendants", async (t) => {
  const { store, open } = await fixture(t, [
    { ...message("large", "target"), content: "a".repeat(128 * 1024) },
  ]);
  const snapshot = await store.snapshot();
  const metadata = (await store.getManyMetadata(snapshot, "messages", ["large"])).get("large");
  const descendants = new Set();
  for (const { reference } of metadata.parts) {
    await collectValueRecords(store, reference, descendants);
    descendants.delete(reference);
  }
  assert.ok(descendants.size > 0);
  const adapter = await forbidRecordReads(store, descendants);
  await using reader = await open();
  setFsAdapter(adapter);
  try {
    for (const method of ["readTurnPage", "readMessageTailPage"])
      await assert.rejects(reader[method]({ turnScopeId: "target", limit: 1, maxBytes: 4096 }), {
        code: MESSAGE_READ_BUDGET_ERROR,
      });
  } finally {
    resetFsAdapter();
  }
});

test("content pages preserve JSON bytes across Unicode and escape boundaries", async (t) => {
  const content = '你好🌏\\\"\n\u0000\ud800'.repeat(30);
  const { open } = await fixture(t, [{ ...message("encoded"), content }]);
  await using reader = await open();
  const chunks = [];
  let byteOffset = 0;
  let expectedContentReference = null;
  let page;
  do {
    page = await reader.readMessageContentPage({
      messageUid: "encoded",
      byteOffset,
      maxBytes: 17,
      expectedContentReference,
    });
    assert.equal(page.encoding, "json-utf8-base64");
    const bytes = Buffer.from(page.dataBase64, "base64");
    assert.ok(bytes.length <= 17);
    assert.equal(page.nextByteOffset, byteOffset + bytes.length);
    assert.equal(page.generation, reader.generation);
    chunks.push(bytes);
    byteOffset = page.nextByteOffset;
    expectedContentReference = page.contentReference;
  } while (page.hasMore);
  assert.equal(JSON.parse(Buffer.concat(chunks).toString("utf8")), content);
  assert.equal(byteOffset, Buffer.byteLength(JSON.stringify(content)));
  const end = await reader.readMessageContentPage({
    messageUid: "encoded",
    byteOffset,
    maxBytes: 17,
    expectedContentReference,
  });
  assert.equal(end.hasMore, false);
  assert.equal(end.dataBase64, "");
  await assert.rejects(
    reader.readMessageContentPage({
      messageUid: "encoded",
      byteOffset: byteOffset + 1,
      maxBytes: 17,
      expectedContentReference,
    }),
    RangeError,
  );
});

test("content pages pin old snapshots and reject continuation across content versions", async (t) => {
  const { store, open } = await fixture(t, [message("versioned")]);
  await using before = await open();
  const first = await before.readMessageContentPage({
    messageUid: "versioned",
    byteOffset: 0,
    maxBytes: 3,
    expectedContentReference: null,
  });
  await commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: "s1",
    expectedGeneration: before.generation,
    operationId: "append-content",
    committedAt: ts,
    changes: {
      messageContentAppends: [
        {
          messageUid: "versioned",
          dialogProcessId: "versioned",
          turnScopeId: "versioned",
          expectedContentReference: first.contentReference,
          owner: (await store.get(await store.snapshot(), "messages", "versioned")).ordinal,
          content: " appended",
        },
      ],
    },
  });
  const options = {
    messageUid: "versioned",
    byteOffset: first.nextByteOffset,
    maxBytes: 100,
    expectedContentReference: first.contentReference,
  };
  const last = await before.readMessageContentPage(options);
  assert.equal(
    JSON.parse(
      Buffer.concat([
        Buffer.from(first.dataBase64, "base64"),
        Buffer.from(last.dataBase64, "base64"),
      ]).toString(),
    ),
    "versioned",
  );
  await using current = await open();
  await assert.rejects(current.readMessageContentPage(options), {
    code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT",
  });
  assert.equal(
    await current.readMessageContentPage({
      messageUid: "absent",
      byteOffset: 0,
      maxBytes: 1,
      expectedContentReference: null,
    }),
    null,
  );
});

test("dialog membership pages pin their generation and reject cursors outside the snapshot", async (t) => {
  const { store, open } = await fixture(t, [
    message("first", "t1", "dialog"),
    message("other", "other", "other"),
    message("second", "t2", "dialog"),
  ]);
  await using before = await open();
  const page = await before.readDialogTurnPage({ dialogProcessId: "dialog", limit: 1 });
  assert.deepEqual(page.turnScopeIds, ["t1"]);
  assert.equal(page.cursor, 1);
  assert.equal(page.hasMore, true);
  await commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: "s1",
    expectedGeneration: before.generation,
    operationId: "append-dialog-member",
    committedAt: ts,
    changes: { messages: [message("third", "t3", "dialog")] },
  });
  const next = await before.readDialogTurnPage({ dialogProcessId: "dialog", after: page.cursor });
  assert.deepEqual(next.turnScopeIds, ["t2"]);
  assert.equal(next.generation, before.generation);
  assert.equal(next.hasMore, false);
  assert.deepEqual(
    (await before.readDialogTurnPage({ dialogProcessId: "dialog", after: 2 })).turnScopeIds,
    [],
  );
  await assert.rejects(
    before.readDialogTurnPage({ dialogProcessId: "dialog", after: 3 }),
    TypeError,
  );
  await assert.rejects(before.readDialogTurnPage({ dialogProcessId: "dialog", maxBytes: 1 }), {
    code: MESSAGE_READ_BUDGET_ERROR,
  });
  assert.equal(await before.readDialogTurnPage({ dialogProcessId: "absent" }), null);
  await using current = await open();
  assert.deepEqual((await current.readDialogTurnPage({ dialogProcessId: "dialog" })).turnScopeIds, [
    "t1",
    "t2",
    "t3",
  ]);
});

test("dialog pages reject corrupted member ownership", async (t) => {
  const { store, open } = await fixture(t, [message("m1", "t1", "dialog")]);
  const snapshot = await store.snapshot();
  const turn = await store.get(snapshot, "turns", "t1");
  await store.commit({
    expectedGeneration: snapshot.generation,
    operationId: "corrupt-member",
    changes: [{ collection: "turns", key: "t1", value: { ...turn, dialogProcessId: "other" } }],
  });
  await using reader = await open();
  await assert.rejects(
    reader.readDialogTurnPage({ dialogProcessId: "dialog" }),
    /ownership mismatch/,
  );
});
