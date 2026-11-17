/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import {
  IMMUTABLE_VALUE_BLOCK_BYTES as BLOCK_BYTES,
  IMMUTABLE_VALUE_MAX_DEPTH,
} from "@noobot/session-protocol/immutable-storage-graph";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-value-batch-integrity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new ImmutableObjectStore(directory);
}

test("batch decoding preserves scalar, composite, multiblock and duplicate values", async (t) => {
  const objects = await fixture(t);
  const values = [
    null,
    42,
    "中🙂".repeat(BLOCK_BYTES),
    { message: { content: "body".repeat(BLOCK_BYTES) } },
  ];
  const references = [];
  for (const value of values)
    references.push(await objects.putValue(value, { contentPaths: [["message", "content"]] }));
  references.push(references[3]);
  assert.deepEqual(await objects.readValues(references), [...values, values[3]]);
  for (let index = 0; index < references.length; index += 1)
    assert.deepEqual(
      (await objects.readValuesMetadata([references[index]]))[0],
      await objects.readValueMetadata(references[index]),
    );
});

test("batch and streamed byte trees reject the same corrupt descendants and totals", async (t) => {
  const objects = await fixture(t);
  const left = await objects.putValueBytes(Buffer.alloc(BLOCK_BYTES, 97));
  const short = await objects.putValueBytes(Buffer.from([98]));
  const empty = await objects.putValueBytes(Buffer.alloc(0));
  const references = [];
  for (const [right, bytes] of [
    [short, BLOCK_BYTES + 2],
    [left, BLOCK_BYTES + 1],
    [empty, BLOCK_BYTES + 1],
  ])
    references.push(await objects.putPage({ kind: "value-branch", left, right, bytes }));
  let deep = left;
  for (let depth = 0; depth <= IMMUTABLE_VALUE_MAX_DEPTH; depth += 1)
    deep = await objects.putPage({
      kind: "value-branch",
      left: deep,
      right: short,
      bytes: BLOCK_BYTES + depth + 1,
    });
  references.push(deep);
  for (const reference of references) {
    const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };
    await assert.rejects(objects.readValueBytes(reference), invalid);
    await assert.rejects(objects.readValues([reference]), invalid);
    await assert.rejects(objects.readValuesMetadata([reference]), invalid);
  }
});

test("batch decoding rejects malformed templates before reading deferred content", async (t) => {
  const objects = await fixture(t);
  const content = await objects.putValue("deferred body");
  const template = await objects.putValueBytes(Buffer.from('{"message":'));
  const reference = await objects.putPage({
    kind: "value-parts",
    template,
    parts: [{ path: ["message", "content"], reference: content }],
  });
  const read = objects.read.bind(objects);
  t.mock.method(objects, "read", (candidate) => {
    assert.notEqual(candidate, content);
    return read(candidate);
  });
  for (const method of ["readValues", "readValuesMetadata"])
    await assert.rejects(objects[method]([reference]), (error) => {
      assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    });
});

test("materialization batches shared content references without aliasing mutable values", async (t) => {
  const objects = await fixture(t);
  const references = [];
  const expected = [
    { message: { content: { text: "中🙂".repeat(BLOCK_BYTES) } } },
    { message: { content: { text: "中🙂".repeat(BLOCK_BYTES) } } },
    { scalar: true },
  ];
  for (const value of expected)
    references.push(
      await objects.putValue(value, {
        contentPaths: [["message", "content"]],
      }),
    );
  const metadata = await objects.readValuesMetadata(references);
  const readValues = objects.readValues.bind(objects);
  const batches = [];
  t.mock.method(objects, "readValues", async (selected) => {
    batches.push(selected.length);
    return readValues(selected);
  });
  const actual = await objects.materializeValues(metadata);
  assert.deepEqual(actual, expected);
  assert.equal(batches[0], 2);
  actual[0].message.content.text = "changed";
  assert.equal(actual[1].message.content.text, "中🙂".repeat(BLOCK_BYTES));
});

test("failed content batches preserve unmaterialized metadata and expose the read error", async (t) => {
  const objects = await fixture(t);
  const first = await objects.putValue(
    { message: { content: "first" } },
    {
      contentPaths: [["message", "content"]],
    },
  );
  const second = await objects.putValue(
    { message: { content: "second" } },
    {
      contentPaths: [["message", "content"]],
    },
  );
  const metadata = await objects.readValuesMetadata([first, second]);
  const failure = new Error("content I/O failure");
  t.mock.method(objects, "readValues", async () => {
    throw failure;
  });
  await assert.rejects(objects.materializeValues(metadata), (error) => error === failure);
  assert.deepEqual(
    metadata.map(({ value }) => value.message.content),
    [null, null],
  );
});
