/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableValueStore } from "../../src/session/session-artifact-session/immutable-value-store.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { IMMUTABLE_VALUE_BLOCK_BYTES as BLOCK_BYTES } from "@noobot/session-protocol/immutable-storage-graph";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "stream-migration-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "stream",
    allowCreate: true,
    objectStore: ImmutableObjectStore,
  });

  const bytes = Buffer.from(
    ' { "text": "\\u4e2d🙂", "number": 1e+02, "pad": "' + "x".repeat(BLOCK_BYTES * 5) + '" } ',
  );
  let body;
  await store.transact({
    expectedGeneration: 0,
    operationId: "seed",
    input: null,
    prepare: async () => {
      body = await store.objects.putValueBytes(bytes);
      return {
        changes: ["a", "b"].map((key) => ({
          collection: "messages",
          key,
          value: { message: { content: null } },
          parts: [{ path: ["message", "content"], reference: body }],
        })),
      };
    },
  });
  return { sessionDir, store, bytes };
}

test("migration streams shared opaque bodies once and preserves exact encoded bytes", async (t) => {
  const { sessionDir, bytes } = await fixture(t);
  const putValueChunks = ImmutableValueStore.prototype.putValueChunks;
  let streams = 0;
  t.mock.method(ImmutableValueStore.prototype, "putValueChunks", function (...args) {
    streams++;
    return putValueChunks.apply(this, args);
  });
  await migrateImmutableSessionSegments({ sessionDir });
  assert.equal(streams, 1, "shared body must be translated only once across messages and history");
  const target = await ImmutableSessionStore.open({ sessionDir });
  const snapshot = await target.snapshot();
  const references = await target.objects.withSnapshot(snapshot, async () => {
    const root = await target.index.get(snapshot.root, "messages");
    const bodies = [];
    for (const key of ["a", "b"]) {
      const metadata = await target.objects.readValueMetadata(await target.index.get(root, key));
      bodies.push(metadata.parts[0].reference);
      assert.deepEqual(await target.objects.readValueBytes(metadata.parts[0].reference), bytes);
      assert.deepEqual(await target.get(snapshot, "messages", key), {
        message: { content: JSON.parse(bytes) },
      });
    }
    return bodies;
  });
  assert.equal(references[0], references[1]);
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
});

test("cancellation during body translation keeps the old head and supports migration retry", async (t) => {
  const { sessionDir, store, bytes } = await fixture(t);
  const committed = await readFile(store.headPath);
  const controller = new AbortController();
  const failure = new Error("cancel body migration");
  const putValueChunks = ImmutableValueStore.prototype.putValueChunks;
  const mock = t.mock.method(
    ImmutableValueStore.prototype,
    "putValueChunks",
    function (chunks, options) {
      async function* cancelled() {
        for await (const chunk of chunks) {
          yield chunk;
          controller.abort(failure);
        }
      }
      return putValueChunks.call(this, cancelled(), options);
    },
  );
  await assert.rejects(
    migrateImmutableSessionSegments({ sessionDir, signal: controller.signal }),
    (error) => error === failure,
  );
  assert.deepEqual(await readFile(store.headPath), committed);
  await access(path.join(sessionDir, "objects"));
  assert.deepEqual(
    (await store.get(await store.snapshot(), "messages", "a")).message.content,
    JSON.parse(bytes),
  );
  mock.mock.restore();
  await migrateImmutableSessionSegments({ sessionDir });
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
});
