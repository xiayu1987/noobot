/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { CurrentImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-storage-backends.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

const committedAt = "2026-01-01T00:00:00.000Z";
const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

function message(messageUid, content) {
  return {
    messageUid,
    userMessageId: "user",
    sessionId: "receipts",
    parentSessionId: "",
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    parentDialogProcessId: "",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content,
    attachments: [],
    transferEnvelopes: [],
    ts: committedAt,
  };
}

async function fixture(t, objectStore, corrupt) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "receipt-migration-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const source = new ImmutableSessionStore({
    sessionDir,
    sessionId: "receipts",
    allowCreate: true,
    objectStore,
  });
  await source.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "session", value: { sessionId: "receipts" } }],
  });
  const messages = [
    message("one", "intermediate"),
    message("two", "second"),
    message("one", "final"),
  ];
  const request = {
    sessionDir,
    sessionId: source.sessionId,
    expectedGeneration: 1,
    operationId: "legacy-message-operation",
    changes: { messages },
    committedAt,
  };
  const result = { messages: structuredClone(messages), extra: { retained: true } };
  if (corrupt) corrupt(result, messages);
  await source.transact({
    expectedGeneration: request.expectedGeneration,
    operationId: request.operationId,
    input: { changes: request.changes, committedAt },
    prepare: async () => ({
      changes: [
        { collection: "messages", key: "one", value: { message: messages[2] } },
        { collection: "messages", key: "two", value: { message: messages[1] } },
      ],
      result,
    }),
  });
  await source.commit({
    expectedGeneration: 2,
    operationId: "later-removal",
    changes: [{ collection: "messages", key: "one", remove: true }],
  });
  return { source, request, sessionDir };
}

for (const objectStore of [
  ImmutableObjectStore,
  ImmutableRecordStore,
  CurrentImmutableRecordStore,
]) {
  test(`offline receipt migration replays original commit after removal: ${objectStore.format}`, async (t) => {
    const { source, request, sessionDir } = await fixture(t, objectStore);
    const before = await source.snapshot();
    const rootLocation = source.objects.locations
      ? await source.objects.locations.get(before.locationRoot, before.root)
      : null;
    await migrateImmutableSessionSegments({ sessionDir, migrateMessageReceipts: true });
    const store = await ImmutableSessionStore.open({ sessionDir });
    const head = await store.snapshot();
    assert.equal(head.generation, before.generation);
    assert.equal(await store.get(head, "messages", "one"), null);
    if (rootLocation !== null) {
      assert.equal(head.root, before.root);
      assert.equal(head.commit, before.commit);
      assert.deepEqual(
        await store.objects.locations.get(head.locationRoot, head.root),
        rootLocation,
      );
    }
    const receipt = await store.objects.withSnapshot(head, async () =>
      store.objects.readValue(await store.index.get(head.operations, request.operationId)),
    );
    assert.deepEqual(receipt.result.messages, ["one", "two", "one"]);
    assert.deepEqual(receipt.result.extra, { retained: true });
    const replay = await commitSessionChanges(request);
    assert.equal(replay.replayed, true);
    assert.equal(replay.generation, 2);
    assert.deepEqual(
      replay.result.messageReceipts.map((item) => item.messageUid),
      ["one", "two", "one"],
    );
    assert.ok(
      replay.result.messageReceipts.every(
        (item) => item.generation === 2 && !Object.hasOwn(item, "content"),
      ),
    );
    const published = await readFile(store.headPath);
    await migrateImmutableSessionSegments({ sessionDir, migrateMessageReceipts: true });
    assert.deepEqual(await readFile(store.headPath), published);
  });
}

test("same-format receipt conversion leaves original head readable after publication failure and retries", async (t) => {
  const { source, sessionDir, request } = await fixture(t, CurrentImmutableRecordStore);
  const before = await readFile(source.headPath);
  const failure = new Error("receipt migration publication failure");
  setFsAdapter({
    rename: async (from, to) => {
      if (to === source.headPath) throw failure;
      return rename(from, to);
    },
  });
  try {
    await assert.rejects(
      migrateImmutableSessionSegments({ sessionDir, migrateMessageReceipts: true }),
      failure,
    );
    assert.deepEqual(await readFile(source.headPath), before);
    const head = await source.snapshot();
    assert.equal((await source.get(head, "messages", "two")).message.content, "second");
  } finally {
    resetFsAdapter();
  }
  await migrateImmutableSessionSegments({ sessionDir, migrateMessageReceipts: true });
  assert.equal((await commitSessionChanges(request)).replayed, true);
});

for (const [name, corrupt] of [
  [
    "foreign session",
    (result) => {
      result.messages[0].sessionId = "foreign";
    },
  ],
  [
    "uncommitted identity",
    (result) => {
      result.messages[0].messageUid = "missing";
    },
  ],
  [
    "mixed result shapes",
    (result) => {
      result.messages[1] = "two";
    },
  ],
  [
    "foreign committed entity",
    (_result, messages) => {
      messages[2].sessionId = "foreign";
    },
  ],
]) {
  test(`invalid legacy receipt aborts before head publication: ${name}`, async (t) => {
    const { source, sessionDir } = await fixture(t, CurrentImmutableRecordStore, corrupt);
    const before = await readFile(source.headPath);
    await assert.rejects(
      migrateImmutableSessionSegments({ sessionDir, migrateMessageReceipts: true }),
      invalid,
    );
    assert.deepEqual(await readFile(source.headPath), before);
    assert.equal((await source.snapshot()).generation, 3);
  });
}
