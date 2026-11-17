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
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { CurrentImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-storage-backends.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { immutableCheckpointKey } from "../../src/session/session-artifact-session/immutable-checkpoint-index.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

const committedAt = "2026-01-01T00:00:00.000Z";
const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };
const message = (uid) => ({
  messageUid: uid,
  userMessageId: uid,
  sessionId: "checkpoints",
  parentSessionId: "",
  dialogProcessId: "dialog",
  turnScopeId: "turn",
  parentDialogProcessId: "",
  role: "user",
  messageOrigin: "natural",
  type: "message",
  content: uid,
  attachments: [],
  transferEnvelopes: [],
  ts: committedAt,
});

async function fixture(t, objectStore = CurrentImmutableRecordStore, corrupt = () => {}) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "checkpoint-receipt-migration-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const source = new ImmutableSessionStore({
    sessionDir,
    sessionId: "checkpoints",
    allowCreate: true,
    objectStore,
  });
  await source.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      { collection: "metadata", key: "session", value: { sessionId: source.sessionId } },
      { collection: "messages", key: "existing", value: { message: message("existing") } },
    ],
  });
  const checkpoint = {
    userId: "admin",
    sessionId: source.sessionId,
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    checkpointId: "cp",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["existing", "second", "first"],
    summarizedMessageUids: ["existing"],
    retainedMessageUids: [],
    messages: [message("first"), message("second")],
  };
  const parsed = parseTurnSummaryCheckpointRequest(checkpoint);
  const result = {
    summaryCheckpoints: [
      {
        committed: true,
        markedCount: 1,
        checkpointRevision: 1,
        receipt: {
          checkpointId: "cp",
          checkpointRevision: 1,
          requestHash: parsed.requestHash,
          persistedMessageUids: checkpoint.persistedMessageUids,
          summarizedMessageUids: ["existing"],
          retainedMessageUids: [],
          markedCount: 1,
          committedAt,
        },
      },
    ],
    extra: "preserved",
  };
  const request = {
    sessionDir,
    sessionId: source.sessionId,
    expectedGeneration: 1,
    operationId: "legacy-checkpoint",
    changes: { summaryCheckpoints: [checkpoint] },
    committedAt,
  };
  const evidence = { expectedGeneration: 1, input: { changes: request.changes, committedAt } };
  const changes = [
    ...checkpoint.messages.map((value) => ({
      collection: "messages",
      key: value.messageUid,
      value: { message: structuredClone(value) },
    })),
    {
      collection: "checkpoints",
      key: immutableCheckpointKey("turn", "cp"),
      value: structuredClone(result.summaryCheckpoints[0].receipt),
    },
  ];
  corrupt({ result, changes });
  await source.transact({
    expectedGeneration: 1,
    operationId: request.operationId,
    input: evidence.input,
    prepare: async () => ({ changes, result }),
  });
  await source.commit({
    expectedGeneration: 2,
    operationId: "remove-later",
    changes: [{ collection: "messages", key: "first", remove: true }],
  });
  const migrate = (
    readOperationInput = async (operationId) => {
      assert.equal(operationId, request.operationId);
      return structuredClone(evidence);
    },
  ) =>
    migrateImmutableSessionSegments({
      sessionDir,
      migrateMessageReceipts: true,
      readOperationInput,
    });
  return { source, request, evidence, sessionDir, migrate };
}

for (const objectStore of [
  ImmutableObjectStore,
  ImmutableRecordStore,
  CurrentImmutableRecordStore,
]) {
  test(`checkpoint migration preserves the changed subset and order after removal: ${objectStore.format}`, async (t) => {
    const { request, migrate, sessionDir } = await fixture(t, objectStore);
    await migrate();
    const store = await ImmutableSessionStore.open({ sessionDir });
    const head = await store.snapshot();
    assert.equal(await store.get(head, "messages", "first"), null);
    const outcome = await commitSessionChanges(request);
    assert.equal(outcome.replayed, true);
    assert.equal(outcome.generation, 2);
    assert.deepEqual(
      outcome.result.summaryCheckpoints[0].messageReceipts.map((item) => item.messageUid),
      ["first", "second"],
    );
    assert.ok(
      outcome.result.summaryCheckpoints[0].messageReceipts.every((item) => item.generation === 2),
    );
    assert.equal(outcome.result.extra, "preserved");
    const published = await readFile(store.headPath);
    await migrate(async () => {
      assert.fail("migrated receipts need no original input");
    });
    assert.deepEqual(await readFile(store.headPath), published);
  });
}

for (const objectStore of [
  ImmutableObjectStore,
  ImmutableRecordStore,
  CurrentImmutableRecordStore,
]) {
  for (const readOperationInput of [undefined, async () => null]) {
    test(`missing evidence preserves historical receipts and blocks reexecution: ${objectStore.format}, provider=${!!readOperationInput}`, async (t) => {
      const { source, sessionDir, request } = await fixture(t, objectStore);
      const original = await source.snapshot();
      const originalRef = await source.objects.withSnapshot(original, () =>
        source.index.get(original.operations, request.operationId),
      );
      const originalReceipt = await source.objects.withSnapshot(original, () =>
        source.objects.readValue(originalRef),
      );
      await migrateImmutableSessionSegments({
        sessionDir,
        migrateMessageReceipts: true,
        readOperationInput,
      });
      const store = await ImmutableSessionStore.open({ sessionDir });
      const head = await store.snapshot();
      const ref = await store.objects.withSnapshot(head, () =>
        store.index.get(head.operations, request.operationId),
      );
      const receipt = await store.objects.withSnapshot(head, () => store.objects.readValue(ref));
      assert.deepEqual(receipt.result, originalReceipt.result);
      assert.equal(receipt.digest, originalReceipt.digest);
      assert.equal(receipt.generation, originalReceipt.generation);
      assert.equal(receipt.retryUnavailable, "original-input-unavailable");
      const before = await readFile(store.headPath);
      await assert.rejects(commitSessionChanges(request), {
        code: "SESSION_OPERATION_RETRY_UNAVAILABLE",
        operationId: request.operationId,
      });
      await assert.rejects(
        store.commit({
          expectedGeneration: head.generation,
          operationId: request.operationId,
          changes: [],
        }),
        { code: "SESSION_OPERATION_RETRY_UNAVAILABLE" },
      );
      await migrateImmutableSessionSegments({
        sessionDir,
        migrateMessageReceipts: true,
        readOperationInput: async () =>
          assert.fail("unavailable receipts must not be reconstructed"),
      });
      assert.deepEqual(await readFile(store.headPath), before);
      assert.equal(await store.get(head, "messages", "first"), null);
      const next = await store.commit({
        expectedGeneration: head.generation,
        operationId: "new-operation",
        changes: [],
      });
      assert.equal(next.generation, head.generation + 1);
    });
  }
}

test("input provider failure is not converted to an unavailable receipt", async (t) => {
  const { source, migrate } = await fixture(t);
  const before = await readFile(source.headPath);
  const failure = new Error("input archive unavailable");
  await assert.rejects(
    migrate(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(await readFile(source.headPath), before);
  await migrate();
});

test("unavailable receipt publication failure preserves authority and can resume", async (t) => {
  const { source, sessionDir, request } = await fixture(t);
  const before = await readFile(source.headPath);
  const failure = new Error("unavailable receipt publication failed");
  setFsAdapter({
    rename: async (from, to) => {
      if (to === source.headPath) throw failure;
      return rename(from, to);
    },
  });
  const migrate = () =>
    migrateImmutableSessionSegments({ sessionDir, migrateMessageReceipts: true });
  await assert.rejects(migrate(), (error) => error === failure);
  assert.deepEqual(await readFile(source.headPath), before);
  resetFsAdapter();
  await migrate();
  await assert.rejects(commitSessionChanges(request), {
    code: "SESSION_OPERATION_RETRY_UNAVAILABLE",
  });
});

for (const field of ["expectedGeneration", "input"]) {
  test(`checkpoint migration rejects changed evidence ${field}`, async (t) => {
    const { source, evidence, migrate } = await fixture(t);
    const before = await readFile(source.headPath);
    if (field === "expectedGeneration") evidence.expectedGeneration = 0;
    else evidence.input.committedAt = "2026-01-02T00:00:00.000Z";
    await assert.rejects(
      migrate(async () => evidence),
      invalid,
    );
    assert.deepEqual(await readFile(source.headPath), before);
  });
}

for (const [name, corrupt] of [
  [
    "foreign turn",
    ({ changes }) => {
      changes[0].value.message.turnScopeId = "foreign";
    },
  ],
  [
    "missing committed entity",
    ({ changes }) => {
      changes.shift();
    },
  ],
  [
    "different checkpoint receipt",
    ({ changes }) => {
      changes.at(-1).value.markedCount = 2;
    },
  ],
  [
    "conflicting persisted identity",
    ({ result }) => {
      result.summaryCheckpoints[0].turnScopeId = "foreign";
    },
  ],
]) {
  test(`checkpoint migration rejects ${name}`, async (t) => {
    const { source, migrate } = await fixture(t, CurrentImmutableRecordStore, corrupt);
    const before = await readFile(source.headPath);
    await assert.rejects(migrate(), invalid);
    assert.deepEqual(await readFile(source.headPath), before);
  });
}

test("checkpoint conversion retries a failed head publication", async (t) => {
  const { source, migrate, request } = await fixture(t);
  const before = await readFile(source.headPath);
  const failure = new Error("checkpoint migration publication failed");
  setFsAdapter({
    rename: async (from, to) => {
      if (to === source.headPath) throw failure;
      return rename(from, to);
    },
  });
  await assert.rejects(migrate(), failure);
  assert.deepEqual(await readFile(source.headPath), before);
  resetFsAdapter();
  await migrate();
  assert.equal((await commitSessionChanges(request)).replayed, true);
});
