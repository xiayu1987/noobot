/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ImmutableValueStore } from "../../src/session/session-artifact-session/immutable-value-store.js";
import { IMMUTABLE_VALUE_BLOCK_BYTES as BLOCK_BYTES } from "@noobot/session-protocol/immutable-storage-graph";

class MemoryValues extends ImmutableValueStore {
  records = new Map();
  requireReference(reference) {
    assert.match(reference, /^[a-f0-9]{64}$/);
    return reference;
  }
  referenceDigest(reference) {
    return this.requireReference(reference);
  }
  async put(bytes) {
    const reference = createHash("sha256").update(bytes).digest("hex");
    this.records.set(reference, Buffer.from(bytes));
    return reference;
  }
  putPage(page) {
    return this.put(Buffer.from(JSON.stringify(page)));
  }
  async read(reference) {
    return Buffer.from(this.records.get(this.requireReference(reference)));
  }
  async readPage(reference) {
    return JSON.parse((await this.read(reference)).toString());
  }
  linkReferences() {}
}

for (const size of [
  0,
  1,
  BLOCK_BYTES - 1,
  BLOCK_BYTES,
  BLOCK_BYTES + 1,
  3 * BLOCK_BYTES,
  7 * BLOCK_BYTES + 17,
]) {
  test(`streamed value uses canonical byte-tree layout for ${size} bytes`, async () => {
    const store = new MemoryValues();
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251;
    const canonical = await store.putValueBytes(bytes);
    async function* chunks() {
      yield Buffer.alloc(0);
      for (let i = 0; i < bytes.length; i += 997) yield bytes.subarray(i, i + 997);
    }
    const streamed = await store.putValueChunks(chunks());
    assert.equal(streamed, canonical);
    assert.deepEqual(await store.readValueBytes(streamed), bytes);
    for await (const chunk of store.readValueChunks(streamed))
      assert.ok(chunk.length <= BLOCK_BYTES);
  });
}

test("incremental byte trees preserve canonical layout across replacement, truncation and append boundaries", async () => {
  const store = new MemoryValues();
  const bytes = Buffer.alloc(8 * BLOCK_BYTES + 17);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  let previousReference = await store.putValueBytes(bytes);
  for (const size of [
    bytes.length,
    0,
    BLOCK_BYTES - 1,
    BLOCK_BYTES,
    BLOCK_BYTES + 1,
    4 * BLOCK_BYTES,
    4 * BLOCK_BYTES + 1,
    bytes.length,
  ]) {
    const next = bytes.subarray(0, size);
    const reused = await store.putValueBytes(next, { previousReference });
    assert.equal(reused, await store.putValueBytes(next));
    assert.deepEqual(await store.readValueBytes(reused), next);
    previousReference = reused;
  }
  const changed = Buffer.from(bytes);
  changed[BLOCK_BYTES + 7] ^= 255;
  const reused = await store.putValueBytes(changed, { previousReference });
  assert.equal(reused, await store.putValueBytes(changed));
});

test("short replacement reads only its old descriptor path and no old payload", async (t) => {
  const store = new MemoryValues();
  const previousReference = await store.putValueBytes(Buffer.alloc(256 * BLOCK_BYTES));
  const readPage = store.readPage.bind(store);
  let descriptors = 0;
  t.mock.method(store, "readPage", async (reference) => {
    descriptors += 1;
    return readPage(reference);
  });
  await store.putValueBytes(Buffer.from("short"), { previousReference });
  assert.equal(descriptors, 9);
  descriptors = 0;
  await store.putValueBytes(Buffer.alloc(0), { previousReference });
  assert.equal(descriptors, 0);
});

test("suffix replacement retains canonical prefixes across block and root boundaries", async () => {
  const store = new MemoryValues();
  for (const size of [
    0,
    1,
    BLOCK_BYTES - 1,
    BLOCK_BYTES,
    BLOCK_BYTES + 1,
    3 * BLOCK_BYTES,
    8 * BLOCK_BYTES + 17,
  ]) {
    const bytes = Buffer.alloc(size, 120);
    const reference = await store.putValueBytes(bytes);
    for (const removed of [0, Math.min(1, size), Math.min(BLOCK_BYTES + 1, size), size]) {
      for (const suffix of [
        Buffer.alloc(0),
        Buffer.from('🙂"\\\n'),
        Buffer.alloc(2 * BLOCK_BYTES + 1, 121),
      ]) {
        const expected = Buffer.concat([bytes.subarray(0, size - removed), suffix]);
        const result = await store.replaceValueSuffix(
          reference,
          bytes.subarray(size - removed),
          suffix,
        );
        assert.deepEqual(await store.readValueBytes(result), expected);
        assert.equal(result, await store.putValueBytes(expected));
      }
    }
  }
});

test("suffix append reads logarithmic descriptors and only the boundary payload", async (t) => {
  const store = new MemoryValues();
  const bytes = Buffer.alloc(256 * BLOCK_BYTES + 19, 120);
  const reference = await store.putValueBytes(bytes);
  const readPage = store.readPage.bind(store);
  const read = store.read.bind(store);
  const descriptors = new Set();
  t.mock.method(store, "readPage", async (ref) => {
    descriptors.add(ref);
    return readPage(ref);
  });
  let payloadReads = 0;
  t.mock.method(store, "read", async (ref) => {
    if (!descriptors.has(ref)) payloadReads += 1;
    return read(ref);
  });
  const result = await store.replaceValueSuffix(
    reference,
    Buffer.from("x"),
    Buffer.from("appended"),
  );
  assert.ok(descriptors.size <= 20, `read ${descriptors.size} descriptors`);
  assert.equal(payloadReads, 1);
  t.mock.restoreAll();
  assert.deepEqual(
    await store.readValueBytes(result),
    Buffer.concat([bytes.subarray(0, -1), Buffer.from("appended")]),
  );
});

test("suffix replacement rejects mismatches and corrupt branch totals", async () => {
  const store = new MemoryValues();
  const reference = await store.putValueBytes(Buffer.from("body"));
  await assert.rejects(store.replaceValueSuffix(reference, Buffer.from("wrong"), Buffer.alloc(0)), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(store.replaceValueSuffix(reference, Buffer.from("x"), Buffer.alloc(0)), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  const malformed = await store.putPage({
    kind: "value-branch",
    left: await store.putValueBytes(Buffer.alloc(BLOCK_BYTES)),
    right: reference,
    bytes: BLOCK_BYTES + 5,
  });
  await assert.rejects(store.replaceValueSuffix(malformed, Buffer.from("y"), Buffer.from("z")), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("incremental encoding rejects malformed old byte-tree totals", async () => {
  const store = new MemoryValues();
  const left = await store.putValueBytes(Buffer.alloc(BLOCK_BYTES));
  const right = await store.putValueBytes(Buffer.from("x"));
  const previousReference = await store.putPage({
    kind: "value-branch",
    left,
    right,
    bytes: BLOCK_BYTES + 2,
  });
  await assert.rejects(store.putValueBytes(Buffer.alloc(BLOCK_BYTES + 2), { previousReference }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("stream reblocks balanced legacy trees without changing opaque JSON bytes", async () => {
  const store = new MemoryValues();
  const bytes = Buffer.from(
    '  { "text": "\\u4e2d🙂", "number": 1e+02, "pad": "' + "x".repeat(BLOCK_BYTES * 3) + '" }  ',
  );
  async function balanced(chunk) {
    if (chunk.length <= BLOCK_BYTES)
      return store.putPage({ kind: "value", data: await store.put(chunk), bytes: chunk.length });
    const middle = Math.floor(chunk.length / 2);
    return store.putPage({
      kind: "value-branch",
      left: await balanced(chunk.subarray(0, middle)),
      right: await balanced(chunk.subarray(middle)),
      bytes: chunk.length,
    });
  }
  const legacy = await balanced(bytes);
  const streamed = await store.putValueChunks(store.readValueChunks(legacy));
  assert.equal(streamed, await store.putValueBytes(bytes));
  assert.deepEqual(await store.readValueBytes(streamed), bytes);
  assert.deepEqual(await store.readValue(streamed), JSON.parse(bytes));
});

test("stream reader validates branch totals before successful completion", async () => {
  const store = new MemoryValues();
  const left = await store.putValueBytes(Buffer.alloc(BLOCK_BYTES));
  const right = await store.putValueBytes(Buffer.from("x"));
  const reference = await store.putPage({
    kind: "value-branch",
    left,
    right,
    bytes: BLOCK_BYTES + 2,
  });
  await assert.rejects(Array.fromAsync(store.readValueChunks(reference)), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(store.putValueChunks(store.readValueChunks(reference)), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("stream reader observes cancellation between chunks without starting another read", async (t) => {
  const store = new MemoryValues();
  const reference = await store.putValueBytes(Buffer.alloc(BLOCK_BYTES + 1));
  const controller = new AbortController();
  const iterator = store.readValueChunks(reference, { signal: controller.signal });
  assert.equal((await iterator.next()).value.length, BLOCK_BYTES);
  const failure = new Error("cancel stream");
  controller.abort(failure);
  t.mock.method(store, "read", () => assert.fail("read after cancellation"));
  await assert.rejects(iterator.next(), (error) => error === failure);
});

test("stream writer propagates source failures, cancellation and invalid chunks", async () => {
  const store = new MemoryValues();
  const failure = new Error("source failed");
  async function* failed() {
    yield Buffer.alloc(BLOCK_BYTES);
    throw failure;
  }
  await assert.rejects(store.putValueChunks(failed()), (error) => error === failure);
  const controller = new AbortController();
  async function* cancelled() {
    yield Buffer.from("partial");
    controller.abort(failure);
  }
  await assert.rejects(
    store.putValueChunks(cancelled(), { signal: controller.signal }),
    (error) => error === failure,
  );
  await assert.rejects(store.putValueChunks(["not bytes"]), TypeError);
});
