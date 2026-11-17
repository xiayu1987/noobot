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
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { registerDialogOrderMessage } from "../../src/session/entities/dialog-order-entity.js";
import { upgradeImmutableMessageTailIndex } from "../../src/session/session-artifact-session/immutable-message-tail-index-upgrade.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { forbidRecordReads } from "./helpers/immutable-record-reads.js";

const ts = "2026-01-01T00:00:00.000Z";

async function fixture(t, scopes) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-tail-integrity-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const messages = scopes.map(([messageUid, turnScopeId, dialogProcessId]) => ({
    messageUid,
    userMessageId: messageUid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId,
    parentDialogProcessId: "",
    turnScopeId,
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: messageUid,
    attachments: [],
    ts,
  }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages,
      dialogOrder: messages.reduce(registerDialogOrderMessage, []),
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
}

async function corrupt(store, changes) {
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "inject-corruption",
    changes,
  });
}

async function deleteFrom(store, turnScopeId) {
  return commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "delete",
    committedAt: ts,
    changes: {
      messageDeletion: {
        anchor: { turnScopeId },
        commandId: "delete",
        expectedAggregateVersion: 0,
      },
    },
  });
}

for (const sameTurn of [false, true]) {
  test(`deletion rejects an empty predecessor while the dialog retains ${sameTurn ? "messages" : "turns"}`, async (t) => {
    const store = await fixture(t, [
      ["keep", sameTurn ? "b" : "a", "d"],
      ["anchor", "b", "d"],
      ["last", sameTurn ? "b" : "c", "d"],
    ]);
    await corrupt(store, [
      {
        collection: "messagePredecessors",
        key: "last",
        value: { previousMessageUid: "", userMessageUid: "last" },
      },
    ]);
    const before = await store.snapshot();
    await assert.rejects(deleteFrom(store, sameTurn ? "b" : "c"), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      message: "Message predecessor is missing while the dialog retains messages",
    });
    assert.deepEqual(await store.snapshot(), before);
    assert.notEqual(await store.get(before, "messages", "last"), null);
  });
}

test("deletion rejects a broken reciprocal dialog link without publishing staged removals", async (t) => {
  const store = await fixture(t, [
    ["keep", "a", "a"],
    ["anchor", "b", "b"],
  ]);
  await corrupt(store, [
    {
      collection: "dialogTails",
      key: "a",
      value: { messageUid: "keep", previousDialogProcessId: "", nextDialogProcessId: "" },
    },
  ]);
  const before = await store.snapshot();
  await assert.rejects(deleteFrom(store, "b"), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  assert.deepEqual(await store.snapshot(), before);
});

for (const previousMessageUid of ["last", "missing", "other-dialog"]) {
  test(`deletion rejects invalid predecessor ${previousMessageUid} without advancing the head`, async (t) => {
    const store = await fixture(t, [
      ["keep", "a", "d"],
      ["other-dialog", "b", "other"],
      ["last", "c", "d"],
    ]);
    await corrupt(store, [
      {
        collection: "messagePredecessors",
        key: "last",
        value: { previousMessageUid, userMessageUid: "last" },
      },
    ]);
    const before = await store.snapshot();
    await assert.rejects(deleteFrom(store, "c"), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
    assert.deepEqual(await store.snapshot(), before);
  });
}

for (const sameDialog of [false, true]) {
  for (const corruption of ["session", "missing-message", "invalid-position", "wrong-position"]) {
    test(`deletion rejects ${corruption} in ${sameDialog ? "same-dialog predecessor" : "previous-dialog tail"}`, async (t) => {
      const store = await fixture(t, [
        ["title", "title", "title"],
        ["keep", "a", "a"],
        ["anchor", "b", sameDialog ? "a" : "b"],
      ]);
      const record = await store.get(await store.snapshot(), "messages", "keep");
      if (corruption === "session") record.message.sessionId = "another-session";
      if (corruption === "missing-message") delete record.message;
      if (corruption === "invalid-position") record.ordinal = 0;
      if (corruption === "wrong-position") record.ordinal = 1;
      await corrupt(store, [{ collection: "messages", key: "keep", value: record }]);
      const before = await store.snapshot();
      await assert.rejects(deleteFrom(store, "b"), {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
        message: "Message tail predecessor ownership or position mismatch",
      });
      assert.deepEqual(await store.snapshot(), before);
    });
  }
}

test("deleting the final dialog uses local memberships without reading unrelated retained bodies", async (t) => {
  const store = await fixture(t, [
    ["title", "title", "title"],
    ["unrelated", "a", "a"],
    ["keep", "b", "b"],
    ["anchor", "c", "c"],
  ]);
  const before = await store.snapshot();
  const reference = await store.objects.withSnapshot(before, async () =>
    store.index.get(await store.index.get(before.root, "messages"), "unrelated"),
  );
  setFsAdapter(await forbidRecordReads(store, [reference]));
  t.after(resetFsAdapter);
  const result = await deleteFrom(store, "c");
  assert.equal(result.result.messageDeletion.receipt.result.deletedCount, 1);
  const after = await store.snapshot();
  assert.equal(after.generation, before.generation + 1);
  assert.equal((await store.get(after, "metadata", "facts")).lastMessageUid, "keep");
  assert.equal(await store.get(after, "dialogTails", "c"), null);
  assert.deepEqual(await store.get(after, "dialogTails", "b"), {
    messageUid: "keep",
    previousDialogProcessId: "a",
    nextDialogProcessId: "",
  });
});

test("unknown tail versions reject both deletion and offline upgrade without publication", async (t) => {
  const store = await fixture(t, [["anchor", "a", "d"]]);
  await corrupt(store, [
    { collection: "metadata", key: "messageTailIndex", value: { version: 999 } },
  ]);
  const before = await store.snapshot();
  await assert.rejects(deleteFrom(store, "a"), {
    code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
  });
  await assert.rejects(
    upgradeImmutableMessageTailIndex({ sessionDir: store.sessionDir, sessionId: "s1" }),
    {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    },
  );
  assert.deepEqual(await store.snapshot(), before);
});
