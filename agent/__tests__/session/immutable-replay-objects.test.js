/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ImmutableObjectStore,
  contentDigest,
} from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableRadixIndex } from "../../src/session/session-artifact-session/immutable-radix-index.js";
import { createImmutableReplayObjects } from "../../src/session/session-artifact-session/immutable-replay-objects.js";

function fixture() {
  const bytes = new Map();
  const source = new ImmutableObjectStore("/unused-in-memory-replay-test");
  source.put = async (value) => {
    const reference = contentDigest(value);
    bytes.set(reference, Buffer.from(value));
    return reference;
  };
  source.read = async (reference) => {
    assert.ok(bytes.has(reference), `missing source page ${reference}`);
    return bytes.get(reference);
  };
  const replay = createImmutableReplayObjects(source);
  return {
    bytes,
    source,
    replay,
    actual: new ImmutableRadixIndex(source),
    replayIndex: new ImmutableRadixIndex(replay.objects),
  };
}

async function compareGraph({ bytes, replay }, roots) {
  const pending = [...roots];
  const visited = new Set();
  while (pending.length) {
    const reference = pending.pop();
    if (!bytes.has(reference) || visited.has(reference)) continue;
    visited.add(reference);
    const pageBytes = await replay.objects.read(reference);
    assert.deepEqual(pageBytes, bytes.get(reference));
    const page = JSON.parse(pageBytes);
    pending.push(
      ...(page.kind === "index-leaf"
        ? page.entries.map(([, child]) => child)
        : Object.values(page.children)),
    );
  }
  return visited.size;
}

test("replay retains shared branch pages through multiple roots, replacements and deletions", async () => {
  const f = fixture();
  let actual = null;
  let replayed = null;
  for (let i = 0; i < 600; i += 1) {
    const reference = contentDigest(`value:${i}`);
    actual = await f.actual.set(actual, `key:${i}`, reference);
    replayed = await f.replayIndex.set(replayed, `key:${i}`, reference);
    assert.equal(replayed, actual);
  }
  const original = replayed;
  let root = await f.actual.set(null, "messages", actual);
  let replayRoot = await f.replayIndex.set(null, "messages", replayed);

  root = await f.actual.set(root, "turns", actual);
  replayRoot = await f.replayIndex.set(replayRoot, "turns", replayed);
  f.replay.retain(replayRoot, replayed);
  assert.equal(root, replayRoot);
  assert.ok((await compareGraph(f, [replayRoot, replayed])) > 1);
  for (let generation = 0; generation < 80; generation += 1) {
    const key = `key:${generation}`;
    const value = generation % 2 === 0 ? null : contentDigest(`replacement:${generation}`);
    actual = await f.actual.set(actual, key, value);
    replayed = await f.replayIndex.set(replayed, key, value);
    root = await f.actual.set(root, "messages", actual);
    replayRoot = await f.replayIndex.set(replayRoot, "messages", replayed);
    f.replay.retain(replayRoot, original);
    assert.equal(root, replayRoot);
    await compareGraph(f, [replayRoot, original]);
  }
  root = await f.actual.set(root, "turns", null);
  replayRoot = await f.replayIndex.set(replayRoot, "turns", null);
  f.replay.retain(replayRoot, null);
  assert.equal(root, replayRoot);
  await compareGraph(f, [replayRoot]);
  await assert.rejects(f.replay.objects.read(original), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  f.replay.retain(null, null);
  await assert.rejects(f.replay.objects.read(replayRoot), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("repeated identical roots and duplicate publications do not retire live pages", async () => {
  const f = fixture();
  const reference = contentDigest("value");
  const root = await f.replayIndex.set(null, "key", reference);
  const duplicate = await f.replayIndex.set(null, "key", reference);
  assert.equal(root, duplicate);
  f.replay.retain(root, root);
  for (let i = 0; i < 10; i += 1) {
    f.replay.retain(root, root);
    assert.equal(await f.replayIndex.get(root, "key"), reference);
  }
  f.replay.retain(null, root);
  assert.equal(await f.replayIndex.get(root, "key"), reference);
  f.replay.retain(null, null);
  await assert.rejects(f.replay.objects.read(root), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});

test("replay compares referenced content independently of its storage location", async () => {
  const f = fixture();
  let location = 0;

  f.source.put = async (bytes) => {
    const reference = contentDigest(`physical-location:${location++}`);
    f.bytes.set(reference, Buffer.from(bytes));
    return reference;
  };
  const value = { opaqueHash: "f".repeat(64), text: "committed" };
  const actualValue = await f.source.putValue(value);
  const expectedValue = await f.replay.objects.putValue(value);
  const actual = await f.actual.set(null, "key", actualValue);
  const expected = await f.replayIndex.set(null, "key", expectedValue);
  assert.notEqual(actual, expected);
  assert.equal(await f.replay.equivalent(actual, expected), true);
  f.replay.retain(expected, null);
  assert.deepEqual(await f.replay.objects.readValue(expectedValue), value);
  const incorrect = await f.source.putValue({ ...value, opaqueHash: "e".repeat(64) });
  const incorrectRoot = await f.actual.set(null, "key", incorrect);
  assert.equal(await f.replay.equivalent(incorrectRoot, expected), false);
  const renamedRoot = await f.actual.set(null, "different-key", actualValue);
  assert.equal(await f.replay.equivalent(renamedRoot, expected), false);
  assert.equal(await f.replay.equivalent(null, expected), false);
  f.replay.retain(null, null);
  await assert.rejects(f.replay.objects.readValue(expectedValue), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("replay compares index mappings across page splits and rejects changed or missing entries", async () => {
  const f = fixture();
  const compact = new ImmutableRadixIndex(f.source, 512);
  const entries = Array.from({ length: 80 }, (_, i) => [`key-${i}`, contentDigest(`value-${i}`)]);
  const actual = await compact.setMany(null, entries);
  const expected = await f.replayIndex.setMany(null, entries);
  assert.equal((await f.source.readPage(actual)).kind, "index-branch");
  assert.equal((await f.replay.objects.readPage(expected)).kind, "index-leaf");
  assert.equal(await f.replay.equivalent(actual, expected), true);
  assert.equal(
    await f.replay.equivalent(await compact.set(actual, "key-1", null), expected),
    false,
  );
  const changed = await f.source.putValue({ changed: true });
  assert.equal(
    await f.replay.equivalent(await compact.set(actual, "key-1", changed), expected),
    false,
  );
});

test("replay compares external and inline byte values and rejects different or malformed payloads", async () => {
  const f = fixture();
  const payload = Buffer.from(JSON.stringify({ committed: "same bytes" }));
  const external = await f.source.putPage({
    kind: "value",
    data: await f.source.put(payload),
    bytes: payload.length,
  });
  const inline = await f.replay.objects.putValueBytes(payload);
  assert.equal(await f.replay.equivalent(external, inline), true);
  const changed = await f.source.putPage({
    kind: "value",
    data: await f.source.put(Buffer.from(payload.toString().replace("same", "else"))),
    bytes: payload.length,
  });
  assert.equal(await f.replay.equivalent(changed, inline), false);
  const malformed = await f.source.putPage({
    kind: "value",
    data: await f.source.put(payload.subarray(1)),
    bytes: payload.length,
  });
  await assert.rejects(f.replay.equivalent(malformed, inline), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("replay structural comparison rejects hash-valid invalid UTF-8 instead of replacing key bytes", async () => {
  const f = fixture();
  const child = contentDigest("child");
  const expected = await f.replay.objects.putPage({
    kind: "index-leaf",
    entries: [["\ufffd", child]],
  });
  const bytes = Buffer.concat([
    Buffer.from('{"kind":"index-leaf","entries":[["'),
    Buffer.from([0xff]),
    Buffer.from(`","${child}"]]}`),
  ]);
  const actual = await f.source.put(bytes);
  await assert.rejects(f.replay.equivalent(actual, expected), (error) => {
    assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
    assert.ok(error.message.includes(actual));
    assert.ok(error.cause instanceof TypeError);
    return true;
  });
});
