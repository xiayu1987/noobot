/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSegmentStore } from "../../src/session/session-artifact-session/immutable-segment-store.js";
import {
  IMMUTABLE_SEGMENT,
  decodeImmutableRecordReference,
} from "@noobot/session-protocol/immutable-segment";
import { IMMUTABLE_VALUE_READ_BATCH_RECORDS } from "@noobot/session-protocol/immutable-storage-graph";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t, count) {
  const directory = await mkdtemp(path.join(tmpdir(), "segment-verification-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.after(resetFsAdapter);
  const store = new ImmutableSegmentStore(directory);
  const batch = store.createBatch();
  const references = Array.from({ length: count }, (_, index) =>
    batch.stage(Buffer.from(`record:${index}`)),
  );
  await batch.publish(references);
  return { store, references };
}

test("verification coalesces contiguous records within the protocol bound and retains record accounting", async (t) => {
  const count = IMMUTABLE_VALUE_READ_BATCH_RECORDS * 2 + 3;
  const { store, references } = await fixture(t, count);
  let reads = 0;
  setFsAdapter({
    open: async (...args) => {
      const handle = await open(...args);
      const read = handle.read.bind(handle);
      handle.read = (...values) => {
        reads += 1;
        return read(...values);
      };
      return handle;
    },
  });
  const { work } = await observeSessionStorageWork(() =>
    store.withReadScope(() => store.verifyMany([...references.toReversed(), references[0]])),
  );
  assert.equal(reads, 1 + Math.ceil(count / IMMUTABLE_VALUE_READ_BATCH_RECORDS));
  assert.equal(work.immutableObjectReads, count);
  assert.equal(
    work.immutableReadBytes,
    Buffer.byteLength(IMMUTABLE_SEGMENT.magic) +
      references.reduce(
        (sum, reference) => sum + decodeImmutableRecordReference(reference).length,
        0,
      ),
  );
});

test("verification does not read unselected gaps", async (t) => {
  const { store, references } = await fixture(t, 3);
  const middle = decodeImmutableRecordReference(references[1]);
  const ranges = [];
  setFsAdapter({
    open: async (...args) => {
      const handle = await open(...args);
      const read = handle.read.bind(handle);
      handle.read = (bytes, offset, length, position) => {
        ranges.push({ position, length });
        return read(bytes, offset, length, position);
      };
      return handle;
    },
  });
  await store.withReadScope(() => store.verifyMany([references[2], references[0]]));
  assert.ok(
    ranges.every(
      ({ position, length }) =>
        position + length <= middle.offset || position >= middle.offset + middle.length,
    ),
  );
});

test("a corrupt interior record cannot pass combined verification", async (t) => {
  const { store, references } = await fixture(t, 5);
  const record = decodeImmutableRecordReference(references[2]);
  const handle = await open(store.segmentPath(record.segmentId), "r+");
  try {
    await handle.write(Buffer.from("X"), 0, 1, record.offset);
  } finally {
    await handle.close();
  }
  await assert.rejects(
    store.withReadScope(() => store.verifyMany(references)),
    (error) => error.cause?.message.includes("checksum mismatch"),
  );
});

test("verification keeps segments separate and drains short reads", async (t) => {
  const { store, references } = await fixture(t, 3);
  const batch = store.createBatch();
  const additional = [batch.stage(Buffer.from("another segment"))];
  await batch.publish(additional);
  let closes = 0;
  setFsAdapter({
    open: async (...args) => {
      const handle = await open(...args);
      const read = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      handle.read = (bytes, offset, length, position) =>
        read(bytes, offset, Math.min(length, 3), position);
      handle.close = async () => {
        closes += 1;
        await close();
      };
      return handle;
    },
  });
  const { work } = await observeSessionStorageWork(() =>
    store.withReadScope(() => store.verifyMany([...references, ...additional].toReversed())),
  );
  assert.equal(closes, 2);
  assert.equal(work.immutableObjectReads, 4);
  assert.equal(
    work.immutableReadBytes,
    Buffer.byteLength(IMMUTABLE_SEGMENT.magic) * 2 +
      [...references, ...additional].reduce(
        (sum, reference) => sum + decodeImmutableRecordReference(reference).length,
        0,
      ),
  );
});

test("verification rejects stalled reads and closes the segment", async (t) => {
  const { store, references } = await fixture(t, 3);
  let closes = 0;
  setFsAdapter({
    open: async (...args) => {
      const handle = await open(...args);
      const read = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      handle.read = (bytes, offset, length, position) =>
        position === 0 ? read(bytes, offset, length, position) : Promise.resolve({ bytesRead: 0 });
      handle.close = async () => {
        closes += 1;
        await close();
      };
      return handle;
    },
  });
  await assert.rejects(
    store.withReadScope(() => store.verifyMany(references)),
    (error) => error.cause?.message.includes("Truncated immutable segment record"),
  );
  assert.equal(closes, 1);
});

test("empty verification opens no segment", async () => {
  setFsAdapter({
    open: () => {
      throw new Error("unexpected segment open");
    },
  });
  try {
    await new ImmutableSegmentStore("unused").verifyMany([]);
  } finally {
    resetFsAdapter();
  }
});
