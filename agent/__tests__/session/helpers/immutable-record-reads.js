/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { open } from "node:fs/promises";
import { isFunction } from "@noobot/shared/value";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { IMMUTABLE_LOCATED_SESSION_FORMAT } from "@noobot/session-protocol/immutable-record-location";
import { isImmutableValuePartsPage } from "@noobot/session-protocol/immutable-storage-graph";

export async function readCommittedIndex(store, root, key) {
  return store.objects.withSnapshot(await store.snapshot(), () => store.index.get(root, key));
}

export async function readCommittedRecord(store, reference) {
  return store.objects.withSnapshot(await store.snapshot(), () => store.objects.read(reference));
}

export async function readCommittedPage(store, reference) {
  return store.objects.withSnapshot(await store.snapshot(), () =>
    store.objects.readPage(reference),
  );
}

export async function readCommittedValue(store, reference) {
  return store.objects.withSnapshot(await store.snapshot(), () =>
    store.objects.readValue(reference),
  );
}

export async function readCommittedValueMetadata(store, reference) {
  return store.objects.withSnapshot(await store.snapshot(), () =>
    store.objects.readValueMetadata(reference),
  );
}

export async function* committedIndexEntries(store, root) {
  const entries = await store.objects.withSnapshot(await store.snapshot(), () =>
    Array.fromAsync(store.index.entries(root)),
  );
  yield* entries;
}

export async function committedPhysicalRecord(store, reference) {
  const location =
    store.format === IMMUTABLE_LOCATED_SESSION_FORMAT
      ? await store.objects.locations.get((await store.snapshot()).locationRoot, reference)
      : reference;
  assert.notEqual(location, null, "fault fixture requires a committed record location");
  return decodeImmutableRecordReference(location);
}

export async function collectValueRecords(store, reference, records = new Set()) {
  if (records.has(reference)) return records;
  records.add(reference);
  const page = await readCommittedPage(store, reference);
  if (isImmutableValuePartsPage(page)) {
    if (page.kind === "value-parts") await collectValueRecords(store, page.template, records);
    for (const part of page.parts) await collectValueRecords(store, part.reference, records);
  } else if (page.kind === "value") records.add(page.data);
  else if (page.kind === "value-inline") return records;
  else {
    assert.equal(page.kind, "value-branch");
    await collectValueRecords(store, page.left, records);
    await collectValueRecords(store, page.right, records);
  }
  return records;
}

export async function corruptRecord(store, reference) {
  const record = await committedPhysicalRecord(store, reference);
  const handle = await open(store.objects.segments.segmentPath(record.segmentId), "r+");
  try {
    const bytes = Buffer.alloc(1);
    assert.equal((await handle.read(bytes, 0, 1, record.offset)).bytesRead, 1);
    bytes[0] ^= 1;
    assert.equal((await handle.write(bytes, 0, 1, record.offset)).bytesWritten, 1);
  } finally {
    await handle.close();
  }
}

export async function publishOrphanRecord(store, bytes) {
  const batch = store.objects.segments.createBatch();
  try {
    const reference = batch.stage(bytes);
    await batch.publish([reference]);
    return reference;
  } finally {
    batch.release();
  }
}

export async function forbidRecordReads(store, references) {
  const ranges = new Map();
  for (const reference of references) {
    const record = await committedPhysicalRecord(store, reference);
    const file = store.objects.segments.segmentPath(record.segmentId);
    if (!ranges.has(file)) ranges.set(file, []);
    ranges.get(file).push(record);
  }
  return {
    open: async (file, flags) => {
      const handle = await open(file, flags);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "read" && flags === "r" && ranges.has(String(file)))
            return async (buffer, offset, length, position) => {
              assert.equal(
                ranges
                  .get(String(file))
                  .some(
                    (record) =>
                      position < record.offset + record.length && position + length > record.offset,
                  ),
                false,
                `Unexpected record read: ${file} at ${position} (${length} bytes)`,
              );
              return target.read(buffer, offset, length, position);
            };
          const value = Reflect.get(target, key, target);
          return isFunction(value) ? value.bind(target) : value;
        },
      });
    },
  };
}
