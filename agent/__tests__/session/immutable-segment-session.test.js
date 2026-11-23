/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { IMMUTABLE_COMMIT_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage-graph";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import {
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
  decodeImmutableSessionHead,
} from "@noobot/session-protocol/immutable-storage";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-segment-session-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "segment-session",
    allowCreate: true,
    objectStore: ImmutableRecordStore,
  });
  return { store, sessionDir };
}

test("session changes, commit and idempotency receipt publish together in one segment", async (t) => {
  const { store, sessionDir } = await fixture(t);
  const request = {
    expectedGeneration: 0,
    operationId: "first",
    changes: [{ collection: "metadata", key: "session", value: { sessionId: store.sessionId } }],
  };
  const { result, work } = await observeSessionStorageWork(() => store.commit(request));
  assert.equal(work.immutableSegmentSyncs, 1);
  assert.equal(work.immutableSegmentWrites, 1);
  const head = await store.snapshot();
  assert.equal(head.format, IMMUTABLE_SEGMENT_SESSION_FORMAT);
  assert.equal(result.commit, head.commit);
  assert.equal(head.generation, 1);
  const replay = await store.commit(request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.commit, result.commit);
  assert.equal((await readdir(path.join(sessionDir, "segments"))).length, 1);
  const cold = await ImmutableSessionStore.open({
    sessionDir,
    sessionId: store.sessionId,
    objectStore: ImmutableRecordStore,
  });
  assert.deepEqual(await cold.get(await cold.snapshot(), "metadata", "session"), {
    sessionId: store.sessionId,
  });
  assert.deepEqual(
    (await cold.readCommitChanges(head, { generation: 1, collections: ["metadata"] })).changes,
    [
      ...request.changes,
      {
        collection: "metadata",
        key: "commitIndex",
        value: { version: IMMUTABLE_COMMIT_INDEX_VERSION },
      },
    ],
  );
  await assert.rejects(
    ImmutableSessionStore.open({ sessionDir, objectStore: ImmutableObjectStore }),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  await assert.rejects(ImmutableSessionStore.open({ sessionDir, sessionId: "foreign" }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  const raw = await readFile(store.headPath, "utf8");
  assert.deepEqual(
    decodeImmutableSessionHead(raw, store.sessionId, IMMUTABLE_SEGMENT_SESSION_FORMAT),
    head,
  );
});

test("metadata-only transactions preserve old readers and reject stale or conflicting operations", async (t) => {
  const { store, sessionDir } = await fixture(t);
  const original = { message: { content: "large message body".repeat(20000), summarized: false } };
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "messages", key: "m1", value: original }],
  });
  const previous = await store.snapshot();
  const transaction = {
    expectedGeneration: previous.generation,
    operationId: "summarize",
    input: { messageUid: "m1" },
    prepare: async ({ getMetadata }) => {
      const { value, parts } = await getMetadata("messages", "m1");
      return {
        changes: [
          {
            collection: "messages",
            key: "m1",
            parts,
            value: { ...value, message: { ...value.message, summarized: true } },
          },
        ],
        result: { messageUid: "m1" },
      };
    },
  };
  const { result, work } = await observeSessionStorageWork(() => store.transact(transaction));
  assert.equal(work.immutableSegmentSyncs, 1);
  assert.ok(work.immutableWriteBytes < 12000);
  assert.equal((await store.transact(transaction)).replayed, true);
  const cold = await ImmutableSessionStore.open({ sessionDir, objectStore: ImmutableRecordStore });
  assert.deepEqual(await cold.get(previous, "messages", "m1"), original);
  assert.deepEqual(await cold.get(await cold.snapshot(), "messages", "m1"), {
    message: { content: original.message.content, summarized: true },
  });
  assert.equal(result.generation, 2);
  await assert.rejects(store.transact({ ...transaction, input: { messageUid: "different" } }), {
    code: "SESSION_OPERATION_CONFLICT",
  });
  await assert.rejects(store.commit({ expectedGeneration: 1, operationId: "stale", changes: [] }), {
    code: "SESSION_GENERATION_CONFLICT",
  });
});
