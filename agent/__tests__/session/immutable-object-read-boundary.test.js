/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { restoreImmutableObjects } from "../../src/session/session-artifact-session/immutable-object-repair.js";
import { sessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";

const BLOCK_BYTES = LENGTH_THRESHOLDS.immutableStorage.blockBytes;

async function fixture(context, bytes) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-read-boundary-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  context.after(resetFsAdapter);
  const objects = new ImmutableObjectStore(directory);
  const reference = await objects.put(bytes);
  return { objects, reference, file: objects.objectPath(reference) };
}

test("oversized corrupt objects consume at most one block plus an overflow byte", async (context) => {
  const { objects, reference, file } = await fixture(context, Buffer.from("original"));
  await writeFile(file, Buffer.alloc(BLOCK_BYTES * 32, 97));
  const { work } = await observeSessionStorageWork(async () => {
    await assert.rejects(objects.read(reference), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  });
  assert.equal(work.immutableObjectReads, 1);
  assert.equal(work.immutableReadBytes, BLOCK_BYTES + 1);
});

for (const length of [0, 17, BLOCK_BYTES]) {
  test(`bounded reads preserve ${length} bytes across short reads and close the handle`, async (context) => {
    const bytes = Buffer.alloc(length, 97);
    const { objects, reference, file } = await fixture(context, bytes);
    let reads = 0;
    let closes = 0;
    setFsAdapter({
      open: async (target, flags) => {
        assert.equal(target, file);
        const handle = await open(target, flags);
        return {
          read: async (buffer, offset, requested, position) => {
            reads += 1;
            return handle.read(buffer, offset, Math.min(requested, 997), position);
          },
          close: async () => {
            closes += 1;
            await handle.close();
          },
        };
      },
    });
    assert.deepEqual(await objects.read(reference), bytes);
    assert.ok(reads >= Math.ceil(length / 997) + 1);
    assert.equal(closes, 1);
  });
}

test("read failures retain their cause and close the object handle", async (context) => {
  const { objects, reference } = await fixture(context, Buffer.from("original"));
  const failure = Object.assign(new Error("injected read failure"), { code: "EIO" });
  let closes = 0;
  setFsAdapter({
    open: async () => ({
      read: async () => {
        throw failure;
      },
      close: async () => {
        closes += 1;
      },
    }),
  });
  await assert.rejects(objects.read(reference), (error) => {
    assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(closes, 1);
});

test("repair of an oversized object uses bounded comparison and preserves committed identity", async (context) => {
  const { objects } = await fixture(context, Buffer.from("unused"));
  const sessionDir = path.dirname(objects.directory);
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "repair",
    allowCreate: true,
    objectStore: ImmutableObjectStore,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "messages", key: "message", value: "original" }],
  });
  const snapshot = await store.snapshot();
  const root = await store.index.get(snapshot.root, "messages");
  const reference = await store.index.get(root, "message");
  const file = objects.objectPath(reference);
  const bytes = await readFile(file);
  const head = await readFile(store.headPath);
  await writeFile(file, Buffer.alloc(BLOCK_BYTES * 32, 97));
  const sizes = [];
  setFsAdapter({
    readFile: async (target, ...options) => {
      assert.notEqual(target, file, "repair must not read the entire damaged object");
      return readFile(target, ...options);
    },
    open: async (target, flags) => {
      const handle = await open(target, flags);
      if (target !== file) return handle;
      let total = 0;
      return {
        read: async (...options) => {
          const result = await handle.read(...options);
          total += result.bytesRead;
          return result;
        },
        close: async () => {
          sizes.push(total);
          await handle.close();
        },
      };
    },
  });
  const result = await sessionMutationCoordinator.run(store.lockPath, () =>
    restoreImmutableObjects({
      sessionDir,
      objectStore: ImmutableObjectStore,
      replacements: new Map([[reference, bytes]]),
    }),
  );
  assert.equal(result.length, 1);
  assert.ok(sizes.includes(BLOCK_BYTES + 1));
  assert.ok(sizes.every((size) => size <= BLOCK_BYTES + 1));
  assert.deepEqual(await readFile(file), bytes);
  assert.deepEqual(await readFile(store.headPath), head);
  assert.equal(await store.get(snapshot, "messages", "message"), "original");
});
