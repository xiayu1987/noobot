/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir, open, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMMUTABLE_CLEANUP_PLAN as PLAN } from "@noobot/session-protocol/immutable-storage";
import { ImmutableCleanupRetention } from "../../src/session/session-artifact-session/immutable-cleanup-retention.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { immutableSegmentFileName } from "@noobot/session-protocol/immutable-segment";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "cleanup-retention-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, retained: new ImmutableCleanupRetention(directory, { create: true }) };
}

function identity(index) {
  return index.toString(16).padStart(32, "0");
}

test("retained segments deduplicate across bounded batches and append to shared scratch segments", async (t) => {
  const { directory, retained } = await fixture(t);
  const count = PLAN.chunkEntries * 5 + 3;
  for (let pass = 0; pass < 2; pass++) {
    for (let index = 0; index < count; index++) {
      await retained.add(identity(index));
      assert.ok(retained.pending.size < PLAN.chunkEntries);
    }
    await retained.flush();
    assert.equal(retained.size, count);
  }
  for (let index = 0; index < count; index++)
    assert.equal(await retained.has(identity(index)), true);
  assert.equal(await retained.has(identity(count)), false);
  assert.equal((await readdir(retained.pages.segments.directory)).length, 1);
  assert.equal(retained.pages.segments.directory, path.join(directory, "segments"));
});

test("failed retention publication preserves the last published index and retries the pending batch", async (t) => {
  const { retained } = await fixture(t);
  await retained.add(identity(0));
  await retained.flush();
  const root = retained.root;
  const tail = retained.segmentTail;
  await retained.add(identity(1));
  const failure = new Error("retention data sync failed");
  setFsAdapter({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (String(file).startsWith(retained.pages.segments.directory + path.sep) && flags !== "r")
        handle.sync = async () => {
          throw failure;
        };
      return handle;
    },
  });
  await assert.rejects(retained.flush(), (error) => error === failure);
  assert.equal(retained.root, root);
  assert.equal(retained.segmentTail, tail);
  assert.equal(retained.size, 1);
  assert.equal(retained.pending.size, 1);
  resetFsAdapter();
  await retained.flush();
  assert.equal(retained.size, 2);
  assert.equal(await retained.has(identity(0)), true);
  assert.equal(await retained.has(identity(1)), true);
});

test("failed automatic flush applies backpressure before admitting another identity", async (t) => {
  const { directory, retained } = await fixture(t);
  for (let index = 0; index < PLAN.chunkEntries - 1; index++) await retained.add(identity(index));
  const failure = new Error("retention checkpoint unavailable");
  setFsAdapter({
    rename: async (source, target) => {
      if (target === retained.file) throw failure;
      return rename(source, target);
    },
  });
  await assert.rejects(retained.add(identity(PLAN.chunkEntries - 1)), (error) => error === failure);
  for (let index = PLAN.chunkEntries; index < PLAN.chunkEntries + 3; index++) {
    await assert.rejects(retained.add(identity(index)), (error) => error === failure);
    assert.equal(retained.pending.size, PLAN.chunkEntries);
    assert.equal(retained.pending.has(identity(index)), false);
  }
  resetFsAdapter();
  await retained.add(identity(PLAN.chunkEntries));
  assert.equal(retained.size, PLAN.chunkEntries);
  assert.equal(retained.pending.size, 1);
  await retained.flush();
  const reopened = new ImmutableCleanupRetention(directory);
  for (let index = 0; index <= PLAN.chunkEntries; index++)
    assert.equal(await reopened.has(identity(index)), true);
  assert.equal(reopened.size, PLAN.chunkEntries + 1);
});

test("retention capacity refuses publication rather than forgetting protected segments", async (t) => {
  const { retained } = await fixture(t);
  for (let index = 0; index <= PLAN.retentionSegments; index++)
    retained.segments.add(identity(index));
  await retained.add(identity(0));
  await assert.rejects(retained.flush(), { code: "SESSION_MAINTENANCE_CAPACITY_EXCEEDED" });
  assert.equal(retained.root, null);
  assert.equal(retained.size, 0);
  assert.equal(retained.pending.size, 1);
});

test("retention checkpoint survives reopening and duplicate marks perform no storage writes", async (t) => {
  const { directory, retained } = await fixture(t);
  for (let index = 0; index < PLAN.chunkEntries + 3; index++) await retained.add(identity(index));
  await retained.flush();
  const checkpoint = await readFile(retained.file);
  const reopened = new ImmutableCleanupRetention(directory);
  assert.equal(await reopened.has(identity(0)), true);
  assert.equal(await reopened.has(identity(PLAN.chunkEntries + 2)), true);
  assert.equal(reopened.size, PLAN.chunkEntries + 3);
  const { work } = await observeSessionStorageWork(async () => {
    for (let index = 0; index < PLAN.chunkEntries + 3; index++) await reopened.add(identity(index));
    await reopened.flush();
  });
  assert.equal(work.immutableWriteBytes ?? 0, 0);
  assert.deepEqual(await readFile(retained.file), checkpoint);
  await reopened.add(identity(PLAN.chunkEntries + 3));
  await reopened.flush();
  const next = new ImmutableCleanupRetention(directory);
  assert.equal(await next.has(identity(PLAN.chunkEntries + 3)), true);
  assert.equal(await next.has(identity(0)), true);
  assert.equal(next.size, PLAN.chunkEntries + 4);
});

for (const published of [false, true]) {
  test(`retention checkpoint failure ${published ? "after" : "before"} rename reloads durable state before retry`, async (t) => {
    const { directory, retained } = await fixture(t);
    await retained.add(identity(0));
    await retained.flush();
    await retained.add(identity(1));
    const failure = new Error("retention checkpoint acknowledgement failed");
    setFsAdapter({
      rename: async (source, target) => {
        if (target !== retained.file) return rename(source, target);
        if (published) await rename(source, target);
        throw failure;
      },
    });
    await assert.rejects(retained.flush(), (error) => error === failure);
    assert.equal(retained.size, 1);
    assert.equal(retained.pending.size, 1);
    resetFsAdapter();
    const reopened = new ImmutableCleanupRetention(directory);
    assert.equal(await reopened.has(identity(0)), true);
    assert.equal(await reopened.has(identity(1)), published);
    await retained.flush();
    assert.equal(retained.size, 2);
    assert.equal(await retained.has(identity(1)), true);
    const completed = new ImmutableCleanupRetention(directory);
    assert.equal(await completed.has(identity(1)), true);
    assert.equal(completed.size, 2);
  });
}

test("retention checkpoint corruption rejects instead of recreating an empty protection set", async (t) => {
  const { directory, retained } = await fixture(t);
  await retained.add(identity(0));
  await retained.flush();
  const checkpoint = await readFile(retained.file, "utf8");
  await writeFile(retained.file, checkpoint.replace("checksum", "damaged"));
  const reopened = new ImmutableCleanupRetention(directory);
  await assert.rejects(reopened.has(identity(0)), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  await assert.rejects(reopened.add(identity(1)), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  assert.equal(reopened.pending.size, 0);
});

test("reopening counts orphan scratch segments against capacity", async (t) => {
  const { directory, retained } = await fixture(t);
  await mkdir(retained.pages.segments.directory, { recursive: true });
  for (let index = 0; index <= PLAN.retentionSegments; index++)
    await writeFile(
      path.join(retained.pages.segments.directory, immutableSegmentFileName(identity(index))),
      "orphan",
    );
  const reopened = new ImmutableCleanupRetention(directory, { create: true });
  await assert.rejects(reopened.add(identity(0)), {
    code: "SESSION_MAINTENANCE_CAPACITY_EXCEEDED",
  });
  assert.equal(reopened.pending.size, 0);
});

test("an empty retention set publishes a checkpoint and reopens without inferred state", async (t) => {
  const { directory, retained } = await fixture(t);
  await retained.flush();
  const checkpoint = await readFile(retained.file);
  const reopened = new ImmutableCleanupRetention(directory);
  assert.equal(await reopened.has(identity(0)), false);
  assert.equal(reopened.size, 0);
  assert.equal(reopened.root, null);
  await reopened.flush();
  assert.deepEqual(await readFile(retained.file), checkpoint);
  await reopened.add(identity(0));
  await reopened.flush();
  assert.equal(await new ImmutableCleanupRetention(directory).has(identity(0)), true);
});

test("reopening a missing checkpoint rejects rather than assuming an empty set", async (t) => {
  const { directory, retained } = await fixture(t);
  await retained.add(identity(0));
  await retained.flush();
  await rm(retained.file);
  const reopened = new ImmutableCleanupRetention(directory);
  await assert.rejects(reopened.has(identity(0)), { code: "ENOENT" });
});

test("a separate process resumes the published retention checkpoint and extends the same index", async (t) => {
  const { directory, retained } = await fixture(t);
  for (let index = 0; index < PLAN.chunkEntries + 1; index++) await retained.add(identity(index));
  await retained.flush();
  const moduleUrl = new URL(
    "../../src/session/session-artifact-session/immutable-cleanup-retention.js",
    import.meta.url,
  ).href;
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
      "-e",
      `import assert from "node:assert/strict";
     import { ImmutableCleanupRetention } from ${JSON.stringify(moduleUrl)};
     const retained = new ImmutableCleanupRetention(process.argv[1]);
     const identity = (index) => index.toString(16).padStart(32, "0");
     assert.equal(await retained.has(identity(0)), true);
     assert.equal(retained.size, ${PLAN.chunkEntries + 1});
     await retained.add(identity(${PLAN.chunkEntries + 1}));
     await retained.flush();`,
      directory,
    ],
    { timeout: 10000 },
  );
  const reopened = new ImmutableCleanupRetention(directory);
  assert.equal(await reopened.has(identity(PLAN.chunkEntries + 1)), true);
  assert.equal(await reopened.has(identity(0)), true);
  assert.equal(reopened.size, PLAN.chunkEntries + 2);
});

test("bounded retention queries share physical index reads without changing membership", async (t) => {
  const { retained } = await fixture(t);
  for (let index = 0; index < PLAN.chunkEntries * 4; index++) await retained.add(identity(index));
  await retained.flush();
  const keys = Array.from({ length: PLAN.chunkEntries }, (_, index) => identity(index * 5));
  const scalar = await observeSessionStorageWork(async () => {
    const result = new Map();
    for (const key of keys) result.set(key, await retained.has(key));
    return result;
  });
  const batched = await observeSessionStorageWork(() => retained.hasMany(keys));
  assert.deepEqual(batched.result, scalar.result);
  assert.ok(batched.work.immutableObjectReads < scalar.work.immutableObjectReads);
  assert.ok(batched.work.immutableReadBytes < scalar.work.immutableReadBytes);
  await assert.rejects(retained.hasMany([...keys, identity(999)]), /batch budget/);
});
