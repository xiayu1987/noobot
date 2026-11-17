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
import { IMMUTABLE_VALUE_BLOCK_BYTES as BLOCK_BYTES } from "@noobot/session-protocol/immutable-storage-graph";

async function fixture(context) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-value-decoding-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return new ImmutableObjectStore(directory);
}

function invalidValue(reference) {
  return (error) => {
    assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
    assert.ok(error.cause instanceof SyntaxError);
    assert.ok(error.message.includes(reference));
    return true;
  };
}

for (const method of ["readValue", "readValueMetadata"]) {
  test(`${method} reports malformed JSON bytes as storage corruption`, async (context) => {
    const objects = await fixture(context);
    const reference = await objects.putValueBytes(Buffer.from('{"unfinished":'));
    await assert.rejects(objects[method](reference), invalidValue(reference));
  });

  test(`${method} reports malformed composite templates before accessing content`, async (context) => {
    const objects = await fixture(context);
    const template = await objects.putValueBytes(Buffer.from('{"message":'));
    const content = await objects.putValue("independently owned content");
    const reference = await objects.putPage({
      kind: "value-parts",
      template,
      parts: [{ path: ["message", "content"], reference: content }],
    });
    const read = objects.read.bind(objects);
    context.mock.method(objects, "read", (candidate) => {
      assert.notEqual(candidate, content, "invalid metadata must reject before opening content");
      return read(candidate);
    });
    await assert.rejects(objects[method](reference), invalidValue(template));
  });
}

test("metadata decoding preserves I/O failures and does not relabel them as JSON failures", async (context) => {
  const objects = await fixture(context);
  const reference = await objects.putValue({ message: { content: null } });
  const failure = Object.assign(new Error("injected storage read failure"), { code: "EIO" });
  context.mock.method(objects, "readValueBytes", async () => {
    throw failure;
  });
  await assert.rejects(objects.readValueMetadata(reference), (error) => error === failure);
});

test("metadata decoding preserves independent null content and complete value reads", async (context) => {
  const objects = await fixture(context);
  const value = { message: { content: null, summarized: false } };
  const reference = await objects.putValue(value, { contentPaths: [["message", "content"]] });
  const metadata = await objects.readValueMetadata(reference);
  assert.deepEqual(metadata.value, value);
  assert.equal(metadata.parts.length, 1);
  assert.equal(await objects.readValue(metadata.parts[0].reference), null);
  assert.deepEqual(await objects.readValue(reference), value);
});

for (const method of ["readPage", "readValue", "readValueMetadata"]) {
  test(`${method} rejects hash-valid JSON with invalid UTF-8 without replacing bytes`, async (context) => {
    const objects = await fixture(context);
    for (const invalid of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe4, 0xb8]]) {
      const bytes = Buffer.concat([
        Buffer.from('{"text":"'),
        Buffer.from(invalid),
        Buffer.from('"}'),
      ]);
      const reference = await objects[method === "readPage" ? "put" : "putValueBytes"](bytes);
      await assert.rejects(objects[method](reference), (error) => {
        assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
        assert.ok(error.cause instanceof TypeError);
        assert.ok(error.message.includes(reference));
        return true;
      });
    }
  });
}

test("invalid UTF-8 in composite metadata rejects before reading its body", async (context) => {
  const objects = await fixture(context);
  const template = await objects.putValueBytes(
    Buffer.concat([
      Buffer.from('{"message":{"content":null,"label":"'),
      Buffer.from([0xff]),
      Buffer.from('"}}'),
    ]),
  );
  const content = await objects.putValue("body");
  const reference = await objects.putPage({
    kind: "value-parts",
    template,
    parts: [{ path: ["message", "content"], reference: content }],
  });
  const read = objects.read.bind(objects);
  context.mock.method(objects, "read", (candidate) => {
    assert.notEqual(candidate, content);
    return read(candidate);
  });
  for (const method of ["readValue", "readValueMetadata"])
    await assert.rejects(objects[method](reference), (error) => {
      assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
      assert.ok(error.cause instanceof TypeError);
      assert.ok(error.message.includes(template));
      return true;
    });
});

test("strict decoding preserves valid replacement characters, BOM content and chunked Unicode", async (context) => {
  const objects = await fixture(context);
  const value = {
    message: { content: { text: "中🙂\ufffd\ufeff".repeat(20000) }, label: "\ufffd\ufeff" },
  };
  const reference = await objects.putValue(value, { contentPaths: [["message", "content"]] });
  assert.deepEqual(await objects.readValue(reference), value);
  const metadata = await objects.readValueMetadata(reference);
  assert.equal(metadata.value.message.label, value.message.label);
  assert.deepEqual(await objects.readValue(metadata.parts[0].reference), value.message.content);
});

test("reading composite values does not serialize or reparse the assembled body", async (context) => {
  const objects = await fixture(context);
  const value = { message: { content: { text: "中文🙂".repeat(20000) }, summarized: false } };
  const reference = await objects.putValue(value, { contentPaths: [["message", "content"]] });
  const json = JSON.stringify(value);
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  let assembledWrites = 0;
  let assembledReads = 0;
  context.mock.method(JSON, "stringify", (candidate, ...args) => {
    if (candidate?.message?.content?.text === value.message.content.text) assembledWrites += 1;
    return stringify(candidate, ...args);
  });
  context.mock.method(JSON, "parse", (candidate, ...args) => {
    if (candidate === json) assembledReads += 1;
    return parse(candidate, ...args);
  });
  assert.deepEqual(await objects.readValue(reference), value);
  assert.equal(assembledWrites, 0, "value reads must not serialize an already decoded body");
  assert.equal(assembledReads, 0, "value reads must not decode the assembled message again");
});

test("explicit byte reads retain the JSON byte contract for composite and ordinary values", async (context) => {
  const objects = await fixture(context);
  for (const content of [null, "中文🙂", { text: "正文".repeat(20000) }, [1, false, "text"]]) {
    const value = { message: { content, summarized: false }, ordinal: 1 };
    const reference = await objects.putValue(value, { contentPaths: [["message", "content"]] });
    assert.deepEqual(await objects.readValueBytes(reference), Buffer.from(JSON.stringify(value)));
    assert.deepEqual(await objects.readValue(reference), value);
  }
  const raw = Buffer.from('{ "number": 1, "text": "中文🙂" }');
  const reference = await objects.putValueBytes(raw);
  assert.deepEqual(await objects.readValueBytes(reference), raw);
  assert.deepEqual(await objects.readValue(reference), JSON.parse(raw));
});

test("appending bytes preserves all complete content blocks at stable byte boundaries", async (context) => {
  const objects = await fixture(context);
  const bytes = Buffer.alloc(BLOCK_BYTES * 3 + 17);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
  const collect = async (reference, leaves = []) => {
    const page = await objects.readPage(reference);
    if (page.kind === "value") leaves.push(page);
    else {
      await collect(page.left, leaves);
      await collect(page.right, leaves);
    }
    return leaves;
  };
  const original = await objects.putValueBytes(bytes);
  const appendedBytes = Buffer.concat([bytes, Buffer.from([42])]);
  const appended = await objects.putValueBytes(appendedBytes);
  const before = await collect(original);
  const after = await collect(appended);
  assert.deepEqual(
    before.map((page) => page.bytes),
    [BLOCK_BYTES, BLOCK_BYTES, BLOCK_BYTES, 17],
  );
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
  assert.deepEqual(await objects.readValueBytes(original), bytes);
  assert.deepEqual(await objects.readValueBytes(appended), appendedBytes);
});

test("byte branches read persisted balanced trees using the same concatenation contract", async (context) => {
  const objects = await fixture(context);
  const bytes = Buffer.alloc(BLOCK_BYTES + 13, 97);
  const middle = Math.floor(bytes.length / 2);
  const left = await objects.putValueBytes(bytes.subarray(0, middle));
  const right = await objects.putValueBytes(bytes.subarray(middle));
  const reference = await objects.putPage({
    kind: "value-branch",
    left,
    right,
    bytes: bytes.length,
  });
  assert.deepEqual(await objects.readValueBytes(reference), bytes);
});

test("malformed deep byte trees reject within the protocol traversal bound", async (context) => {
  const objects = await fixture(context);
  const missing = "f".repeat(64);
  let reference = missing;
  for (let depth = 0; depth < 64; depth += 1)
    reference = await objects.putPage({
      kind: "value-branch",
      left: reference,
      right: missing,
      bytes: BLOCK_BYTES + depth + 1,
    });
  await assert.rejects(objects.readValueBytes(reference), (error) => {
    assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
    assert.match(error.message, /protocol depth/);
    return true;
  });
});

test("byte branches reject inconsistent totals and empty or non-decreasing descendants", async (context) => {
  const objects = await fixture(context);
  const left = await objects.putValueBytes(Buffer.alloc(BLOCK_BYTES, 97));
  const short = await objects.putValueBytes(Buffer.from([98]));
  const empty = await objects.putValueBytes(Buffer.alloc(0));
  const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };
  for (const [right, bytes] of [
    [short, BLOCK_BYTES + 2],
    [left, BLOCK_BYTES + 1],
    [empty, BLOCK_BYTES + 1],
  ]) {
    const reference = await objects.putPage({ kind: "value-branch", left, right, bytes });
    await assert.rejects(objects.readValueBytes(reference), invalid);
  }
});
