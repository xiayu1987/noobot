/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  ImmutableObjectStore,
  writeDurableReplacement,
} from "../../src/session/session-artifact-session/immutable-object-store.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";

const BLOCK_BYTES = LENGTH_THRESHOLDS.immutableStorage.blockBytes;
const INVALID = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-values-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new ImmutableObjectStore(directory);
}

test("durable replacement captures caller bytes before opening the temporary file", async (t) => {
  const objects = await fixture(t);
  const file = path.join(path.dirname(objects.directory), "head.json");
  const bytes = Buffer.from("original head bytes");
  const expected = Buffer.from(bytes);
  const publication = writeDurableReplacement(file, bytes);
  bytes.fill(120);
  await publication;
  assert.deepEqual(await readFile(file), expected);
});

test("object publication captures caller bytes before its first asynchronous read", async (t) => {
  const objects = await fixture(t);
  const bytes = Buffer.from("original bytes");
  const expected = Buffer.from(bytes);
  const publication = objects.put(bytes);
  bytes.fill(120);
  const reference = await publication;
  const cold = new ImmutableObjectStore(path.dirname(objects.directory));
  assert.deepEqual(await cold.read(reference), expected);
});

test("value publication captures all blocks before the caller can mutate their shared buffer", async (t) => {
  const objects = await fixture(t);
  await objects.withDurabilityBatch(async () => {
    for (const length of [BLOCK_BYTES, BLOCK_BYTES * 3 + 1]) {
      const bytes = Buffer.alloc(length, 97);
      const expected = Buffer.from(bytes);
      const publication = objects.putValueBytes(bytes);
      bytes.fill(98);
      const reference = await publication;
      await objects.publishReachable([reference]);
      const cold = new ImmutableObjectStore(path.dirname(objects.directory));
      assert.deepEqual(await cold.readValueBytes(reference), expected);
    }
  });
});

test("cold value reads preserve exact bytes across block and uneven split boundaries", async (t) => {
  const objects = await fixture(t);
  await objects.withDurabilityBatch(async () => {
    for (const length of [0, BLOCK_BYTES - 1, BLOCK_BYTES, BLOCK_BYTES + 1, BLOCK_BYTES * 3 + 1]) {
      const bytes = Buffer.alloc(length, 97);
      const reference = await objects.putValueBytes(bytes);
      await objects.publishReachable([reference]);
      const cold = new ImmutableObjectStore(path.dirname(objects.directory));
      assert.deepEqual(await cold.readValueBytes(reference), bytes);
    }
    const value = { text: "中文🙂".repeat(BLOCK_BYTES) };
    const reference = await objects.putValue(value);
    assert.deepEqual(await objects.readValue(reference), value);
    await objects.publishReachable([reference]);
    const cold = new ImmutableObjectStore(path.dirname(objects.directory));
    assert.deepEqual(await cold.readValue(reference), value);
  });
});

test("invalid value page shapes stop at the descriptor before reading referenced data", async (t) => {
  const objects = await fixture(t);
  const missing = "a".repeat(64);
  for (const page of [
    null,
    { kind: "value", bytes: -1, data: missing },
    { kind: "value", bytes: BLOCK_BYTES + 1, data: missing },
    { kind: "value-branch", bytes: BLOCK_BYTES, left: missing, right: missing },
    { kind: "value-branch", bytes: BLOCK_BYTES + 1, left: missing, right: "invalid" },
    { kind: "value-branch", bytes: Number.MAX_SAFE_INTEGER + 1, left: missing, right: missing },
  ]) {
    const reference = await objects.putPage(page);
    await assert.rejects(objects.readValueBytes(reference), INVALID);
    const { result, work } = await observeSessionStorageWork(async () => {
      try {
        await objects.readValueBytes(reference);
      } catch (error) {
        return error;
      }
      assert.fail("invalid value descriptor was accepted");
    });
    assert.equal(
      result.cause,
      undefined,
      "descriptor validation must precede any missing child read",
    );
    assert.equal(work.immutableObjectReads, 1);
  }
});

test("child sizes are checked against the split before child data or sibling traversal", async (t) => {
  const objects = await fixture(t);
  const bytes = BLOCK_BYTES * 4 + 1;
  const missing = "b".repeat(64);
  const child = await objects.putPage({
    kind: "value-branch",
    bytes,
    left: missing,
    right: missing,
  });
  const root = await objects.putPage({ kind: "value-branch", bytes, left: child, right: missing });
  const { result, work } = await observeSessionStorageWork(async () => {
    try {
      await objects.readValueBytes(root);
    } catch (error) {
      return error;
    }
    assert.fail("non-decreasing child size was accepted");
  });
  assert.equal(result.code, INVALID.code);
  assert.equal(result.cause, undefined);
  assert.equal(work.immutableObjectReads, 2);
});

test("cold multi-block reads copy each payload byte at most once during assembly", async (t) => {
  const objects = await fixture(t);
  const bytes = Buffer.alloc(BLOCK_BYTES * 8 + 1);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
  const reference = await objects.withDurabilityBatch(async () => {
    const root = await objects.putValueBytes(bytes);
    await objects.publishReachable([root]);
    return root;
  });
  const cold = new ImmutableObjectStore(path.dirname(objects.directory));
  const concat = Buffer.concat;
  let copiedBytes = 0;
  const assembly = t.mock.method(Buffer, "concat", (chunks, length) => {
    copiedBytes += chunks.reduce((total, chunk) => total + chunk.length, 0);
    return concat(chunks, length);
  });
  let actual;
  try {
    actual = await cold.readValueBytes(reference);
  } finally {
    assembly.mock.restore();
  }
  assert.deepEqual(actual, bytes);
  assert.ok(copiedBytes <= bytes.length, `${copiedBytes} bytes copied for ${bytes.length} bytes`);
});

test("leaf size mismatch remains corruption even when the data checksum is valid", async (t) => {
  const objects = await fixture(t);
  const data = await objects.put(Buffer.from("123"));
  const root = await objects.putPage({ kind: "value", bytes: 2, data });
  await assert.rejects(objects.readValueBytes(root), INVALID);
});

test("publication includes declared child values and excludes abandoned intermediate versions", async (t) => {
  const objects = await fixture(t);
  const cold = new ImmutableObjectStore(path.dirname(objects.directory));
  let abandoned;
  let child;
  const root = await objects.withDurabilityBatch(async () => {
    abandoned = await objects.putValue({ version: "abandoned" });
    child = await objects.putValue({ version: "retained child" });
    const final = await objects.putValue({ opaque: abandoned }, { references: [child] });
    await assert.rejects(cold.read(final), (error) => error.cause?.code === "ENOENT");
    assert.deepEqual(await objects.readValue(final), { opaque: abandoned });
    await objects.publishReachable([final]);
    return final;
  });
  assert.deepEqual(await cold.readValue(root), { opaque: abandoned });
  assert.deepEqual(await cold.readValue(child), { version: "retained child" });
  await assert.rejects(cold.read(abandoned), (error) => error.cause?.code === "ENOENT");
});

test("failed preparation discards staged bytes and cannot leak them into the next transaction", async (t) => {
  const objects = await fixture(t);
  const failure = new Error("preparation failed");
  let abandoned;
  await assert.rejects(
    objects.withDurabilityBatch(async () => {
      abandoned = await objects.putValue({ aborted: true });
      throw failure;
    }),
    (error) => error === failure,
  );
  await objects.withDurabilityBatch(async () => {
    const root = await objects.putValue({ committed: true });
    await objects.publishReachable([root]);
  });
  const cold = new ImmutableObjectStore(path.dirname(objects.directory));
  await assert.rejects(cold.read(abandoned), (error) => error.cause?.code === "ENOENT");
});
