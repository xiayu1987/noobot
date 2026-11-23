/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { ImmutableRadixIndex } from "../../src/session/session-artifact-session/immutable-radix-index.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { corruptRecord } from "./helpers/immutable-record-reads.js";
import { IMMUTABLE_TRANSACTION_READ_CACHE } from "@noobot/session-protocol/immutable-storage-graph";
import { IMMUTABLE_SEGMENT } from "@noobot/session-protocol/immutable-segment";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-record-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, records: new ImmutableRecordStore(directory) };
}

test("record transactions publish a complete radix and value graph in one segment", async (t) => {
  const { records, directory } = await fixture(t);
  const index = new ImmutableRadixIndex(records);
  let root;
  const { work } = await observeSessionStorageWork(() =>
    records.withDurabilityBatch(async () => {
      const entries = [];
      for (let i = 0; i < 1000; i += 1)
        entries.push([`key-${i}`, await records.putValue({ i, text: `value-${i}` })]);
      root = await index.setMany(null, entries);
      await records.publishReachable([root]);
    }),
  );
  assert.equal(work.immutableSegmentWrites, 1);
  assert.equal(work.immutableSegmentSyncs, 1);
  assert.deepEqual(await readdir(directory), ["segments"]);
  const cold = new ImmutableRecordStore(directory);
  const coldIndex = new ImmutableRadixIndex(cold);
  for (const i of [0, 301, 999])
    assert.deepEqual(await cold.readValue(await coldIndex.get(root, `key-${i}`)), {
      i,
      text: `value-${i}`,
    });
});

test("metadata updates reuse committed body records without reading or writing them", async (t) => {
  const { records, directory } = await fixture(t);
  const contentPaths = [["message", "content"]];
  const original = { message: { content: "中🙂".repeat(80000), summarized: false } };
  let reference;
  await records.withDurabilityBatch(async () => {
    reference = await records.putValue(original, { contentPaths });
    await records.publishReachable([reference]);
  });
  const cold = new ImmutableRecordStore(directory);
  const read = cold.read.bind(cold);
  let updated;
  const { work } = await observeSessionStorageWork(() =>
    cold.withDurabilityBatch(async () => {
      const { value, parts } = await cold.readValueMetadata(reference);
      t.mock.method(cold, "read", (candidate) => {
        assert.notEqual(candidate, parts[0].reference, "metadata update must not open body");
        return read(candidate);
      });
      updated = await cold.putValue(
        { ...value, message: { ...value.message, summarized: true } },
        {
          contentPaths,
          parts,
        },
      );
      await cold.publishReachable([updated]);
    }),
  );
  assert.equal(work.immutableSegmentWrites, 1);
  assert.ok(work.immutableWriteBytes < 2048, "body size must not enter metadata publication");
  const reopened = new ImmutableRecordStore(directory);
  const metadata = await reopened.readValueMetadata(updated);
  assert.equal(
    metadata.parts[0].reference,
    (await reopened.readValueMetadata(reference)).parts[0].reference,
  );
  assert.deepEqual(await reopened.readValue(updated), {
    message: { content: original.message.content, summarized: true },
  });
  assert.deepEqual(await reopened.readValue(reference), original);
});

test("aborted graphs never publish files and leaked transaction work cannot mutate storage", async (t) => {
  const { records, directory } = await fixture(t);
  let late;
  const failure = new Error("reject transaction");
  await assert.rejects(
    records.withDurabilityBatch(async () => {
      const reference = await records.putValue({ uncommitted: true });
      late = () => records.putValue({ late: reference });
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(late(), /not accepting writes/);
  await assert.rejects(records.putValue("no transaction"), /not accepting writes/);
  await assert.rejects(records.read("f".repeat(64)), /record reference/);
});

test("publication prunes abandoned graphs and seals the transaction against later writes", async (t) => {
  const { records, directory } = await fixture(t);
  let reference;
  await records.withDurabilityBatch(async () => {
    await records.putValue("discarded");
    reference = await records.putValue("committed");
    await records.publishReachable([reference]);
    assert.equal(await records.readValue(reference), "committed");
    await assert.rejects(records.putValue("late"), /not accepting writes/);
    await assert.rejects(records.publishReachable([reference]), /not accepting writes/);
  });
  assert.equal((await readdir(path.join(directory, "segments"))).length, 1);
  assert.equal(await new ImmutableRecordStore(directory).readValue(reference), "committed");
});

test("transaction reads reuse verified bytes without sharing mutable buffers or hiding later corruption", async (t) => {
  const { records } = await fixture(t);
  let reference;
  await records.withDurabilityBatch(async () => {
    reference = await records.putValue({ content: "verified" });
    await records.publishReachable([reference]);
  });
  const first = await observeSessionStorageWork(() =>
    records.withDurabilityBatch(async () => {
      const bytes = await records.read(reference);
      const original = Buffer.from(bytes);
      bytes.fill(0);
      const second = await records.read(reference);
      assert.deepEqual(second, original);
      second.fill(0);
      assert.deepEqual(await records.read(reference), original);
    }),
  );
  assert.equal(first.work.immutableObjectReads, 1);
  const next = await observeSessionStorageWork(() =>
    records.withDurabilityBatch(() => records.read(reference)),
  );
  assert.equal(next.work.immutableObjectReads, 1, "each transaction verifies committed bytes anew");
  await corruptRecord({ objects: records }, reference);
  await assert.rejects(
    records.withDurabilityBatch(() => records.read(reference)),
    {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    },
  );
  await assert.rejects(records.read(reference), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});

test("read scopes reuse verified records, isolate buffers and revalidate in the next scope", async (t) => {
  const { records } = await fixture(t);
  let reference;
  await records.withDurabilityBatch(async () => {
    reference = await records.putValue({ content: "verified" });
    await records.publishReachable([reference]);
  });
  let escaped;
  const resume = Promise.withResolvers();
  const first = await observeSessionStorageWork(() =>
    records.withReadScope(async () => {
      const original = await records.read(reference);
      const copy = Buffer.from(original);
      original.fill(0);
      await records.withReadScope(async () => {
        assert.deepEqual(await records.read(reference), copy);
      });
      escaped = resume.promise.then(() => records.read(reference));
    }),
  );
  assert.equal(first.work.immutableObjectReads, 1);
  const rejected = assert.rejects(escaped, /read scope has ended/);
  resume.resolve();
  await rejected;
  const next = await observeSessionStorageWork(() =>
    records.withReadScope(() => records.read(reference)),
  );
  assert.equal(next.work.immutableObjectReads, 1);
  await corruptRecord({ objects: records }, reference);
  await assert.rejects(
    records.withReadScope(() => records.read(reference)),
    {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    },
  );
});

test("failed read scopes release descriptors and cannot contaminate a concurrent scope", async (t) => {
  const { records } = await fixture(t);
  let reference;
  await records.withDurabilityBatch(async () => {
    reference = await records.putValue("independent");
    await records.publishReachable([reference]);
  });
  const ready = Promise.withResolvers();
  const release = Promise.withResolvers();
  const failure = new Error("read callback failed");
  const failed = assert.rejects(
    records.withReadScope(async () => {
      await records.read(reference);
      ready.resolve();
      await release.promise;
      throw failure;
    }),
    (error) => error === failure,
  );
  await ready.promise;
  const { work } = await observeSessionStorageWork(() =>
    records.withReadScope(async () => {
      assert.equal(await records.readValue(reference), "independent");
      release.resolve();
      await failed;
      assert.equal(await records.readValue(reference), "independent");
    }),
  );
  assert.equal(
    work.immutableObjectReads,
    1,
    "one inline record shared only within the successful scope",
  );
});

for (const limit of ["bytes", "records"]) {
  test(`transaction read reuse evicts at the protocol ${limit} limit`, async (t) => {
    const { records } = await fixture(t);
    const size = limit === "bytes" ? IMMUTABLE_SEGMENT.recordBytes : 4;
    const count =
      limit === "bytes"
        ? Math.floor(IMMUTABLE_TRANSACTION_READ_CACHE.bytes / size) + 1
        : IMMUTABLE_TRANSACTION_READ_CACHE.records + 1;
    const references = [];
    await records.withDurabilityBatch(async () => {
      for (let index = 0; index < count; index++) {
        const bytes = Buffer.alloc(size);
        bytes.writeUInt32LE(index);
        references.push(await records.put(bytes));
      }
      await records.publishReachable(references);
    });
    const { work } = await observeSessionStorageWork(() =>
      records.withDurabilityBatch(async () => {
        for (const reference of references) await records.read(reference);
        assert.equal((await records.read(references.at(-1))).readUInt32LE(), count - 1);
        assert.equal((await records.read(references[0])).readUInt32LE(), 0);
      }),
    );
    assert.equal(work.immutableObjectReads, count + 1, "latest is reused; oldest is reverified");
  });
}
