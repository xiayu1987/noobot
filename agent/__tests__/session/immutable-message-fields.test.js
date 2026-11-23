/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { upgradeImmutableMessageFields } from "../../src/session/session-artifact-session/immutable-message-fields-upgrade.js";
import { readImmutableDisplayProjection } from "../../src/session/session-artifact-session/immutable-display-projection.js";
import {
  readCommittedValueMetadata,
  readCommittedIndex,
} from "./helpers/immutable-record-reads.js";
import {
  ImmutableSessionChanges,
  publishMessageIndexes,
} from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { IMMUTABLE_MESSAGE_FIELDS_UPGRADE_BATCH } from "@noobot/session-protocol/immutable-storage-graph";

const ts = "2026-01-01T00:00:00.000Z";
const fields = {
  rawModelContent: [{ type: "text", text: "raw" }],
  modelAdditionalKwargs: {
    reasoning: { type: "reasoning", encrypted_content: "private".repeat(1000) },
  },
  modelResponseMetadata: {
    output: [{ type: "reasoning", encrypted_content: "metadata".repeat(1000) }],
  },
};

async function fixture(t, count = 1) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "message-fields-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const message = {
    messageUid: "m1",
    modelMessageId: "model1",
    presentationMessageId: "p1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    role: "assistant",
    chatPresentation: false,
    type: "message",
    content: "visible",
    attachments: [],
    transferEnvelopes: [],
    ts,
    ...fields,
  };
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages: Array.from({ length: count }, (_, index) => ({
        ...message,
        messageUid: `m${index + 1}`,
        modelMessageId: `model${index + 1}`,
      })),
      dialogOrder: [
        { dialogProcessId: "d1", turnScopeId: "t1", userMessageUid: "", dialogOrdinal: 1 },
      ],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return ImmutableSessionStore.open({ sessionDir });
}

async function metadata(store, snapshot) {
  const root = await readCommittedIndex(store, snapshot.root, "messages");
  return readCommittedValueMetadata(store, await readCommittedIndex(store, root, "m1"));
}

async function commit(store, changes) {
  const snapshot = await store.snapshot();
  return commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: snapshot.generation,
    operationId: `change:${snapshot.generation}`,
    committedAt: ts,
    changes,
  });
}

test("message updates retain untouched model references and replace or delete explicitly changed fields", async (t) => {
  const store = await fixture(t);
  const pinned = await store.snapshot();
  const original = await store.get(pinned, "messages", "m1");
  const before = await metadata(store, pinned);
  assert.equal(before.parts.length, 4);
  const message = { ...original.message };
  for (const field of Object.keys(fields)) delete message[field];
  await commit(store, { messages: [{ ...message, content: "changed" }] });
  const next = await metadata(store, await store.snapshot());
  assert.deepEqual(next.parts.slice(1), before.parts.slice(1));
  assert.deepEqual((await store.get(await store.snapshot(), "messages", "m1")).message, {
    ...original.message,
    content: "changed",
  });
  const replacement = { output: [{ type: "reasoning", encrypted_content: "new" }] };
  const receipt = (
    await commit(store, {
      messages: [{ ...message, content: "again", modelResponseMetadata: replacement }],
    })
  ).result.messageReceipts[0];
  await commit(store, {
    messageMetadataUpdates: [
      {
        messageUid: "m1",
        dialogProcessId: "d1",
        turnScopeId: "t1",
        expectedContentReference: receipt.contentReference,
        owner: receipt.owner,
        metadata: {
          modelAdditionalKwargs: {
            reasoning: { type: "reasoning", encrypted_content: "replaced" },
          },
        },
        metadataRemovals: ["modelResponseMetadata"],
      },
    ],
  });
  const current = (await store.get(await store.snapshot(), "messages", "m1")).message;
  assert.deepEqual(current.rawModelContent, fields.rawModelContent);
  assert.deepEqual(current.modelAdditionalKwargs, {
    reasoning: { type: "reasoning", encrypted_content: "replaced" },
  });
  assert.equal(Object.hasOwn(current, "modelResponseMetadata"), false);
  assert.deepEqual(await store.get(pinned, "messages", "m1"), original);
});

async function writeLegacyMessages(t, store) {
  const first = await store.snapshot();
  const putValue = store.objects.putValue.bind(store.objects);
  const legacyWriter = t.mock.method(store.objects, "putValue", (value, options) =>
    putValue(
      value,
      value.message ? { ...options, contentPaths: [["message", "content"]] } : options,
    ),
  );
  await store.transact({
    expectedGeneration: first.generation,
    operationId: "legacy",
    input: {},
    prepare: async ({ get, getMetadata }) => {
      const plan = new ImmutableSessionChanges(get, { getMetadata });
      for await (const [uid, { value, parts }] of store.entries(first, "messages", {
        metadata: true,
      }))
        plan.set("messages", uid, { ...value, message: { ...value.message, ...fields } }, [
          parts[0],
        ]);
      await publishMessageIndexes(store, plan);
      return { changes: plan.changes(), result: {} };
    },
  });
  legacyWriter.mock.restore();
}

test("field migration preserves content and historical snapshots and is idempotent", async (t) => {
  const store = await fixture(t);
  const first = await store.snapshot();
  const original = await store.get(first, "messages", "m1");
  const before = await metadata(store, first);
  await writeLegacyMessages(t, store);
  const pinned = await store.snapshot();
  const display = await readImmutableDisplayProjection({ store, snapshot: pinned });
  const upgrade = () => upgradeImmutableMessageFields({ sessionDir: store.sessionDir });
  assert.equal((await upgrade()).result.count, 1);
  const after = await store.snapshot();
  const migrated = await metadata(store, after);
  assert.equal(migrated.parts.length, 4);
  assert.deepEqual(migrated.parts[0], before.parts[0]);
  assert.deepEqual(await store.get(after, "messages", "m1"), original);
  assert.deepEqual(await readImmutableDisplayProjection({ store, snapshot: after }), display);
  assert.deepEqual(await store.get(pinned, "messages", "m1"), original);
  assert.equal((await upgrade()).result.upgraded, false);
  assert.equal((await store.snapshot()).generation, after.generation);
});

test("interrupted field migration resumes from committed parts without repeating completed batches", async (t) => {
  const total = IMMUTABLE_MESSAGE_FIELDS_UPGRADE_BATCH.records + 1;
  const store = await fixture(t, total);
  await writeLegacyMessages(t, store);
  const pinned = await store.snapshot();
  const transact = ImmutableSessionStore.prototype.transact;
  let batches = 0;
  const failure = new Error("migration interrupted");
  const writer = t.mock.method(ImmutableSessionStore.prototype, "transact", function (options) {
    if (++batches === 2) throw failure;
    return transact.call(this, options);
  });
  await assert.rejects(upgradeImmutableMessageFields({ sessionDir: store.sessionDir }), failure);
  writer.mock.restore();
  assert.equal((await store.snapshot()).generation, pinned.generation + 1);
  assert.equal(
    (await upgradeImmutableMessageFields({ sessionDir: store.sessionDir })).result.count,
    1,
  );
  for await (const [uid, value] of store.entries(await store.snapshot(), "messages"))
    assert.deepEqual(value, await store.get(pinned, "messages", uid));
  assert.equal(
    (await upgradeImmutableMessageFields({ sessionDir: store.sessionDir })).result.upgraded,
    false,
  );
});

test("v42 external metadata upgrades to inline layout, preserves both message indexes and resumes", async (t) => {
  const total = IMMUTABLE_MESSAGE_FIELDS_UPGRADE_BATCH.records + 1;
  const store = await fixture(t, total);
  const initial = await store.snapshot();
  const putPage = store.objects.putPage.bind(store.objects);
  const externalWriter = t.mock.method(store.objects, "putPage", async (page) => {
    if (page.kind !== "value-parts-inline") return putPage(page);
    const template = await store.objects.putValueBytes(Buffer.from(JSON.stringify(page.value)));
    return putPage({ kind: "value-parts", template, parts: page.parts });
  });
  await store.transact({
    expectedGeneration: initial.generation,
    operationId: "v42-external",
    input: {},
    prepare: async ({ get, getMetadata }) => {
      const plan = new ImmutableSessionChanges(get, { getMetadata });
      for await (const [uid, { value, parts }] of store.entries(initial, "messages", {
        metadata: true,
      }))
        plan.set("messages", uid, value, parts);
      await publishMessageIndexes(store, plan);
      return { changes: plan.changes(), result: {} };
    },
  });
  externalWriter.mock.restore();
  const pinned = await store.snapshot();
  const root = await readCommittedIndex(store, pinned.root, "messages");
  const reference = await readCommittedIndex(store, root, "m1");
  assert.equal(
    (await store.objects.withSnapshot(pinned, () => store.objects.readPage(reference))).kind,
    "value-parts",
  );
  const display = await readImmutableDisplayProjection({ store, snapshot: pinned });
  const transact = ImmutableSessionStore.prototype.transact;
  let batches = 0;
  const writer = t.mock.method(ImmutableSessionStore.prototype, "transact", function (options) {
    if (++batches === 2) throw new Error("inline migration interrupted");
    return transact.call(this, options);
  });
  const upgrade = () => upgradeImmutableMessageFields({ sessionDir: store.sessionDir });
  await assert.rejects(upgrade(), /inline migration interrupted/);
  writer.mock.restore();
  assert.equal((await upgrade()).result.count, 1);
  const current = await store.snapshot();
  assert.deepEqual(await readImmutableDisplayProjection({ store, snapshot: current }), display);
  assert.deepEqual(await readImmutableDisplayProjection({ store, snapshot: pinned }), display);
  const currentRoot = await readCommittedIndex(store, current.root, "messages");
  const turn = await store.get(current, "turns", "t1");
  for await (const [uid, value] of store.entries(current, "messages")) {
    const next = await readCommittedIndex(store, currentRoot, uid);
    assert.equal(
      (await store.objects.withSnapshot(current, () => store.objects.readPage(next))).kind,
      "value-parts-inline",
    );
    assert.equal(await readCommittedIndex(store, turn.messagesRoot, uid), next);
    assert.deepEqual(value, await store.get(pinned, "messages", uid));
  }
  assert.equal((await upgrade()).result.upgraded, false);
  assert.equal((await store.snapshot()).generation, current.generation);
});
