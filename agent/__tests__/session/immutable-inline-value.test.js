/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  IMMUTABLE_VALUE_INLINE_BYTES,
  IMMUTABLE_VALUE_BLOCK_BYTES,
  decodeImmutableInlineValue,
  requireImmutableValueBytePage,
} from "@noobot/session-protocol/immutable-storage-graph";
import { ImmutableValueStore } from "../../src/session/session-artifact-session/immutable-value-store.js";

class Values extends ImmutableValueStore {
  records = new Map();
  reads = [];
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
    this.reads.push(reference);
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
  IMMUTABLE_VALUE_INLINE_BYTES - 1,
  IMMUTABLE_VALUE_INLINE_BYTES,
  IMMUTABLE_VALUE_INLINE_BYTES + 1,
]) {
  test(`inline boundary ${size} preserves canonical streaming, replacement and old values`, async () => {
    const store = new Values();
    const bytes = Buffer.alloc(size, 173);
    const original = await store.putValueBytes(bytes);
    const page = await store.readPage(original);
    assert.equal(page.kind, size <= IMMUTABLE_VALUE_INLINE_BYTES ? "value-inline" : "value");
    async function* chunks() {
      for (let offset = 0; offset < bytes.length; offset += 127)
        yield bytes.subarray(offset, offset + 127);
    }
    assert.equal(await store.putValueChunks(chunks()), original);
    const replacement = Buffer.alloc(IMMUTABLE_VALUE_INLINE_BYTES + 1, 174);
    const changed = await store.putValueBytes(replacement, { previousReference: original });
    assert.deepEqual(await store.readValueBytes(changed), replacement);
    assert.deepEqual(await store.readValueBytes(original), bytes);
  });
}

test("large-value short tails remain descriptors so append does not read old payload", async () => {
  const store = new Values();
  const bytes = Buffer.alloc(IMMUTABLE_VALUE_BLOCK_BYTES + 10, 123);
  const original = await store.putValueBytes(bytes);
  const root = await store.readPage(original);
  const leaf = await store.readPage(root.right);
  assert.equal(leaf.kind, "value");
  store.reads = [];
  await store.putValueBytes(Buffer.concat([bytes, Buffer.from("x")]), {
    previousReference: original,
  });
  assert.equal(store.reads.includes(leaf.data), false);
});

test("inline protocol rejects malformed, oversized and noncanonical payloads", () => {
  const valid = { kind: "value-inline", data: "YQ==", bytes: 1 };
  assert.deepEqual(decodeImmutableInlineValue(valid), Buffer.from("a"));
  for (const page of [
    { ...valid, data: "YQ" },
    { ...valid, data: "YR==" },
    { ...valid, data: "YQ==\n" },
    { ...valid, bytes: 2 },
    { ...valid, bytes: -1 },
    { ...valid, bytes: IMMUTABLE_VALUE_INLINE_BYTES + 1 },
    { ...valid, extra: true },
    { ...valid, data: null },
  ]) {
    assert.throws(() => requireImmutableValueBytePage(page), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  }
});
