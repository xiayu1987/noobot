/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readdir, readFile, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSegmentStore } from "../../src/session/session-artifact-session/immutable-segment-store.js";
import {
  decodeImmutableRecordReference,
  IMMUTABLE_SEGMENT,
} from "@noobot/session-protocol/immutable-segment";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-segment-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.after(resetFsAdapter);
  return new ImmutableSegmentStore(directory);
}

test("one thousand small objects share one durable file and remain directly readable cold", async (t) => {
  const store = await fixture(t);
  const batch = store.createBatch();
  const records = Array.from({ length: 1000 }, (_, i) => Buffer.from(`record:${i}`));
  const references = records.map((bytes) => batch.stage(bytes));
  let writes = 0;
  setFsAdapter({
    open: async (...args) => {
      const handle = await open(...args);
      const write = handle.write.bind(handle);
      handle.write = (...writeArgs) => {
        writes += 1;
        return write(...writeArgs);
      };
      return handle;
    },
  });
  const { work } = await observeSessionStorageWork(() => batch.publish(references));
  assert.equal(writes, 2, "one header write and one contiguous payload write");
  assert.equal(work.immutableSegmentWrites, 1);
  assert.equal(work.immutableSegmentSyncs, 1);
  assert.equal((await readdir(store.directory)).length, 1);
  const cold = new ImmutableSegmentStore(path.dirname(store.directory));
  assert.deepEqual(await cold.read(references[0]), records[0]);
  assert.deepEqual(await cold.read(references[999]), records[999]);
  const appended = store.createBatch(batch.tail);
  const extra = Array.from({ length: 1000 }, (_, i) => Buffer.from(`append:${i}`));
  const extraReferences = extra.map((bytes) => appended.stage(bytes));
  writes = 0;
  await appended.publish(extraReferences.toReversed());
  assert.equal(writes, 1, "an append writes the contiguous payload once");
  assert.deepEqual(await cold.read(extraReferences[999]), extra[999]);
  assert.equal((await readdir(store.directory)).length, 1);
  assert.equal(batch.records.size, 0);
  assert.equal(batch.digests.size, 0);
  assert.throws(() => batch.stage(Buffer.from("late")), /sealed/);
});

test("discarded intermediate bytes are not published and buffer ownership is isolated", async (t) => {
  const store = await fixture(t);
  const batch = store.createBatch();
  const abandoned = Buffer.alloc(10000, 97);
  batch.stage(abandoned);
  const bytes = Buffer.from("final");
  const reference = batch.stage(bytes);
  assert.equal(batch.stage(Buffer.from("final")), reference);
  bytes.fill(0);
  await batch.publish([reference]);
  const { segmentId, offset } = decodeImmutableRecordReference(reference);
  const file = await readFile(store.segmentPath(segmentId));
  assert.deepEqual(
    file.subarray(IMMUTABLE_SEGMENT.magic.length, offset),
    Buffer.alloc(abandoned.length),
  );
  assert.deepEqual(await store.read(reference), Buffer.from("final"));
});

test("empty publication creates no directories or files", async (t) => {
  const store = await fixture(t);
  const batch = store.createBatch();
  batch.stage(Buffer.from("unreachable"));
  await batch.publish([]);
  await assert.rejects(readdir(store.directory), { code: "ENOENT" });
});

test("segments stay bounded and publication omits wholly unreachable segments", async (t) => {
  const store = await fixture(t);
  const batch = store.createBatch();
  const references = [];
  for (
    let i = 0;
    i < Math.ceil(IMMUTABLE_SEGMENT.bytes / IMMUTABLE_SEGMENT.recordBytes) + 2;
    i += 1
  ) {
    const bytes = Buffer.alloc(IMMUTABLE_SEGMENT.recordBytes, i);
    references.push(batch.stage(bytes));
  }
  const first = decodeImmutableRecordReference(references[0]);
  const last = decodeImmutableRecordReference(references.at(-1));
  assert.notEqual(first.segmentId, last.segmentId);
  await batch.publish([references.at(-1)]);
  assert.deepEqual(await readdir(store.directory), [`${last.segmentId}.seg`]);
  assert.equal((await store.read(references.at(-1))).length, IMMUTABLE_SEGMENT.recordBytes);
});

test("record reads bound IO and drain short reads and writes", async (t) => {
  const store = await fixture(t);
  let readBytes = 0;
  let closes = 0;
  setFsAdapter({
    open: async (file, flags) => {
      const handle = await open(file, flags);
      return {
        write: (buffer, offset, length, position) =>
          handle.write(buffer, offset, Math.min(7, length), position),
        read: async (buffer, offset, length, position) => {
          const result = await handle.read(buffer, offset, Math.min(3, length), position);
          readBytes += result.bytesRead;
          return result;
        },
        stat: () => handle.stat(),
        truncate: (length) => handle.truncate(length),
        sync: () => handle.sync(),
        close: async () => {
          closes += 1;
          await handle.close();
        },
      };
    },
  });
  const batch = store.createBatch();
  const reference = batch.stage(Buffer.from("payload"));
  await batch.publish([reference]);
  const before = closes;
  assert.deepEqual(await store.read(reference), Buffer.from("payload"));
  assert.equal(readBytes, IMMUTABLE_SEGMENT.magic.length + 7);
  assert.equal(closes, before + 1);
});

test("record corruption, truncation and oversized segments fail closed", async (t) => {
  const store = await fixture(t);
  const batch = store.createBatch();
  const reference = batch.stage(Buffer.from("original"));
  await batch.publish([reference]);
  const { segmentId, offset } = decodeImmutableRecordReference(reference);
  const file = store.segmentPath(segmentId);
  const handle = await open(file, "r+");
  try {
    await handle.write(Buffer.from("changed!"), 0, 8, offset);
  } finally {
    await handle.close();
  }
  await assert.rejects(store.read(reference), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  await truncate(file, offset);
  await assert.rejects(store.read(reference), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  await truncate(file, IMMUTABLE_SEGMENT.bytes + 1);
  await assert.rejects(store.read(reference), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});

test("failed segment sync seals the transaction and leaves no temporary publication", async (t) => {
  const store = await fixture(t);
  const batch = store.createBatch();
  const reference = batch.stage(Buffer.from("payload"));
  const failure = Object.assign(new Error("injected segment sync failure"), { code: "EIO" });
  let closed = false;
  setFsAdapter({
    open: async (file, flags) => {
      const handle = await open(file, flags);
      return {
        write: (...args) => handle.write(...args),
        truncate: (length) => handle.truncate(length),
        sync: async () => {
          throw failure;
        },
        close: async () => {
          closed = true;
          await handle.close();
        },
      };
    },
  });
  await assert.rejects(batch.publish([reference]), (error) => error === failure);
  assert.equal(closed, true);
  assert.equal(batch.state, "failed");
  assert.equal(batch.records.size, 0);
  assert.deepEqual(await readdir(store.directory), []);
  await assert.rejects(batch.publish([reference]), /sealed/);
  await assert.rejects(store.read(reference), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});

test("a reachable empty record after discarded data still has a valid physical range", async (t) => {
  const store = await fixture(t);
  const batch = store.createBatch();
  batch.stage(Buffer.alloc(10000, 97));
  const empty = batch.stage(Buffer.alloc(0));
  await batch.publish([empty]);
  assert.deepEqual(await store.read(empty), Buffer.alloc(0));
});

test("failed directory synchronization cannot report durable publication", async (t) => {
  const store = await fixture(t);
  const batch = store.createBatch();
  const reference = batch.stage(Buffer.from("payload"));
  const failure = Object.assign(new Error("injected directory sync failure"), { code: "EIO" });
  setFsAdapter({
    open: async (file, flags) => {
      if (file !== store.directory) return open(file, flags);
      const handle = await open(file, flags);
      return {
        sync: async () => {
          throw failure;
        },
        close: () => handle.close(),
      };
    },
  });
  await assert.rejects(batch.publish([reference]), (error) => error === failure);
  assert.equal(batch.state, "failed");
  assert.equal(batch.records.size, 0);
  resetFsAdapter();
  assert.deepEqual(await store.read(reference), Buffer.from("payload"));
});
