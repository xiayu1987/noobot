/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  replaceSyncedFile,
  syncStorageDirectory,
} from "../../src/session/session-artifact-session/immutable-storage-io.js";
import { ImmutableSegmentStore } from "../../src/session/session-artifact-session/immutable-segment-store.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { IMMUTABLE_SEGMENT } from "@noobot/session-protocol/immutable-segment";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-publication-failures-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function leaves(error) {
  return error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
}

for (const backend of ["object", "segment"]) {
  for (const cleanup of ["close", "temporary", "both"]) {
    test(`${backend} publication preserves sync and ${cleanup} failures before publishing`, async (t) => {
      const directory = await fixture(t);
      const syncFailure = new Error("original sync failure");
      const closeFailure = new Error("descriptor close failure");
      const removeFailure = new Error("temporary cleanup failure");
      let closes = 0;
      let removals = 0;
      setFsAdapter({
        open: async (file, flags) => {
          const handle = await open(file, flags);
          if (flags !== "wx") return handle;
          return new Proxy(handle, {
            get(target, key) {
              if (key === "sync")
                return async () => {
                  throw syncFailure;
                };
              if (key === "close")
                return async () => {
                  closes += 1;
                  await target.close();
                  if (cleanup !== "temporary") throw closeFailure;
                };
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
        rm: async (...args) => {
          removals += 1;
          if (cleanup !== "close") throw removeFailure;
          return rm(...args);
        },
      });
      let operation;
      let target;
      if (backend === "object") {
        target = path.join(directory, "object");
        operation = () => replaceSyncedFile(target, Buffer.from("new bytes"));
      } else {
        const store = new ImmutableSegmentStore(directory);
        const batch = store.createBatch();
        const reference = batch.stage(Buffer.from("new bytes"));
        target = store.segmentPath(reference.split(":")[0]);
        operation = () => batch.publish([reference]);
      }
      const expected = [syncFailure];
      if (cleanup !== "temporary") expected.push(closeFailure);
      if (cleanup !== "close") expected.push(removeFailure);
      await assert.rejects(operation(), (error) => {
        assert.deepEqual(leaves(error), expected);
        return true;
      });
      assert.equal(closes, 1);
      assert.equal(removals, 1);
      await assert.rejects(readFile(target), { code: "ENOENT" });
    });
  }
}

test("successful publication consumes its temporary file through rename without a removal", async (t) => {
  const directory = await fixture(t);
  const file = path.join(directory, "object");
  setFsAdapter({ rm: () => assert.fail("published temporary file no longer exists") });
  await replaceSyncedFile(file, Buffer.from("first"));
  await replaceSyncedFile(file, Buffer.from("replacement"));
  assert.equal(await readFile(file, "utf8"), "replacement");
});

test("directory sync preserves its failure when closing also fails", async (t) => {
  const directory = await fixture(t);
  const syncFailure = new Error("directory sync failure");
  const closeFailure = new Error("directory close failure");
  setFsAdapter({
    open: async (...args) => {
      const handle = await open(...args);
      return {
        sync: async () => {
          throw syncFailure;
        },
        close: async () => {
          await handle.close();
          throw closeFailure;
        },
      };
    },
  });
  await assert.rejects(syncStorageDirectory(directory), (error) => {
    assert.deepEqual(leaves(error), [syncFailure, closeFailure]);
    return true;
  });
});

for (const stage of ["header", "record"]) {
  test(`segment ${stage} read preserves storage error identity and a simultaneous close failure`, async (t) => {
    const directory = await fixture(t);
    const store = new ImmutableSegmentStore(directory);
    const batch = store.createBatch();
    const reference = batch.stage(Buffer.from("committed bytes"));
    await batch.publish([reference]);
    const readFailure = new Error("physical read failed");
    const closeFailure = new Error("descriptor close failed");
    let closes = 0;
    setFsAdapter({
      open: async (...args) => {
        const handle = await open(...args);
        return new Proxy(handle, {
          get(target, key) {
            if (key === "read")
              return async (...readArgs) => {
                const header = readArgs[3] < IMMUTABLE_SEGMENT.magic.length;
                if (header === (stage === "header")) throw readFailure;
                return target.read(...readArgs);
              };
            if (key === "close")
              return async () => {
                closes += 1;
                await target.close();
                throw closeFailure;
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    await assert.rejects(store.read(reference), (error) => {
      assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
      assert.deepEqual(leaves(error.cause), [readFailure, closeFailure]);
      return true;
    });
    assert.equal(closes, 1);
  });
}

test("head rename acknowledgement failure reports an uncertain commit and retries without duplication", async (t) => {
  const directory = await fixture(t);
  const store = new ImmutableSessionStore({
    sessionDir: directory,
    sessionId: "publication",
    allowCreate: true,
  });
  const request = {
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "session", value: { sessionId: "publication" } }],
  };
  const failure = new Error("head rename acknowledgement failed");
  setFsAdapter({
    rename: async (source, target) => {
      await rename(source, target);
      if (target === store.headPath) throw failure;
    },
  });
  await assert.rejects(store.commit(request), (error) => {
    assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN");
    assert.equal(error.cause, failure);
    return true;
  });
  const published = await readFile(store.headPath);
  const retried = await store.commit(request);
  assert.equal(retried.replayed, true);
  assert.equal(retried.generation, 1);
  assert.deepEqual(await readFile(store.headPath), published);
  assert.deepEqual(await store.get(await store.snapshot(), "metadata", "session"), {
    sessionId: "publication",
  });
});
