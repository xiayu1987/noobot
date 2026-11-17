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
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { registerDialogOrderMessage } from "../../src/session/entities/dialog-order-entity.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { forbidRecordReads } from "./helpers/immutable-record-reads.js";

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

test("message tail pages use global positions across turns and a pinned generation", async (t) => {
  const { store, open } = await fixture(t, [
    message("keep"),
    message("anchor", "target"),
    message("second", "target"),
    message("tail"),
  ]);
  const reader = await open();
  const first = await reader.readMessageTailPage({ turnScopeId: "target", limit: 1 });
  assert.equal(first.anchorIndex, 1);
  assert.equal(first.deletedCount, 3);
  assert.equal(first.cursor, 2);
  assert.equal(first.hasMore, true);
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
  const next = await reader.readMessageTailPage({ turnScopeId: "target", after: first.cursor });
  assert.deepEqual(
    next.records.map((record) => record.message.messageUid),
    ["second", "tail"],
  );
  assert.equal(next.hasMore, false);
  assert.equal(next.generation, reader.generation);
  const current = await (await open()).readMessageTailPage({ turnScopeId: "target" });
  assert.equal(current.deletedCount, 4);
  assert.equal(current.records.at(-1).message.messageUid, "new");
  assert.equal(
    (await reader.readMessageTailPage({ turnScopeId: "target", after: 4 })).records.length,
    0,
  );
  assert.equal(await reader.readMessageTailPage({ turnScopeId: "missing" }), null);
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
  assert.equal(page.anchorIndex, 128);
  assert.equal(page.deletedCount, 2);
  assert.deepEqual(
    page.records.map((record) => record.message.messageUid),
    ["anchor", "tail"],
  );
});

test("tail selection rejects invalid cursors and page sizes", async (t) => {
  const { open } = await fixture(t, [message("k1"), message("k2"), message("anchor")]);
  const reader = await open();
  for (const options of [
    { after: -1 },
    { after: 1 },
    { after: 4 },
    { after: 0.5 },
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
