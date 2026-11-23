/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { selectShortMemoryBatch, acknowledgeShortMemoryBatch } from "../src/short-memory.js";

function item(id, ...contents) {
  return { captureId: id, records: contents.map((content) => ({ role: "user", content })) };
}

test("batch budgets keep the oldest prefix and retain every unselected item", () => {
  const source = [item("a", "first"), item("b", "second"), item("c", "third")];
  const batch = selectShortMemoryBatch(source, { maxItems: 2, maxChars: 1024 });
  assert.deepEqual(
    batch.promptPayload,
    source.slice(0, 2).map(({ records }) => ({ records })),
  );
  assert.deepEqual(acknowledgeShortMemoryBatch(source, batch.entries), [source[2]]);
  assert.deepEqual(source[0].records, [{ role: "user", content: "first" }]);
});

test("oversized text progresses without discarding escapes, Unicode or trailing whitespace", () => {
  const text = 'a😀"\\\n\t'.repeat(40) + "  ";
  let remaining = [item("a", text, "after")];
  const consumed = [];
  let iterations = 0;
  while (remaining.length) {
    const batch = selectShortMemoryBatch(remaining, { maxItems: 1, maxChars: 80 });
    assert.ok(JSON.stringify(batch.promptPayload).length <= 80);
    for (const { records } of batch.promptPayload) {
      for (const record of records) {
        assert.ok(record.content.isWellFormed());
        consumed.push(record.content);
      }
    }
    const next = acknowledgeShortMemoryBatch(remaining, batch.entries);
    assert.notDeepEqual(next, remaining);
    remaining = next;
    assert.ok(++iterations < 100);
  }
  assert.equal(consumed.join(""), text + "after");
  assert.ok(iterations > 1);
});

test("partial confirmation retains concurrent captures and changed source versions", () => {
  const original = item("a", "x".repeat(1000));
  const batch = selectShortMemoryBatch([original], { maxItems: 1, maxChars: 100 });
  const concurrent = item("b", "new");
  const changed = item("a", "changed");
  assert.deepEqual(acknowledgeShortMemoryBatch([changed, concurrent], batch.entries), [
    changed,
    concurrent,
  ]);
  const next = acknowledgeShortMemoryBatch([original, concurrent], batch.entries);
  assert.equal(next[1], concurrent);
  assert.equal(next[0].captureId, original.captureId);
  assert.ok(next[0].records[0].content.length < original.records[0].content.length);
  assert.equal(acknowledgeShortMemoryBatch(next, batch.entries), next);
});

test("confirmation counts equal snapshots and leaves a later equal-content capture intact", () => {
  const original = item("a", "same");
  const later = item("b", "same");
  const batch = selectShortMemoryBatch([original], { maxItems: 1, maxChars: 100 });
  assert.deepEqual(acknowledgeShortMemoryBatch([original, original, later], batch.entries), [
    original,
    later,
  ]);
});

test("a complete record prefix leaves the next record untouched", () => {
  const original = item("a", "first", "second");
  const limit = JSON.stringify([{ records: [original.records[0]] }]).length;
  const batch = selectShortMemoryBatch([original], { maxItems: 1, maxChars: limit });
  assert.deepEqual(batch.entries[0].end, { record: 1, offset: 0 });
  assert.deepEqual(acknowledgeShortMemoryBatch([original], batch.entries), [item("a", "second")]);
});

test("empty captured items can be consumed without fabricating text", () => {
  const source = [item("a"), item("b", "text")];
  const batch = selectShortMemoryBatch(source, { maxItems: 2, maxChars: 100 });
  assert.deepEqual(acknowledgeShortMemoryBatch(source, batch.entries), []);
  assert.deepEqual(selectShortMemoryBatch([], { maxItems: 1, maxChars: 2 }), {
    entries: [],
    promptPayload: [],
  });
});

test("invalid ranges cannot confirm beyond a snapshot or split a surrogate pair", () => {
  const source = item("a", "😀tail");
  for (const end of [
    { record: 0, offset: 0 },
    { record: 0, offset: 1 },
    { record: 0, offset: 100 },
    { record: 1, offset: 1 },
    { record: 2, offset: 0 },
    { record: -1, offset: 0 },
  ])
    assert.throws(() => acknowledgeShortMemoryBatch([source], [{ source, end }]), TypeError);
  assert.throws(() => acknowledgeShortMemoryBatch([], null), TypeError);
});

test("invalid limits and malformed text fail explicitly", () => {
  for (const limits of [
    { maxItems: 0, maxChars: 100 },
    { maxItems: 1, maxChars: NaN },
    { maxItems: 1, maxChars: 1 },
    { maxItems: 1.5, maxChars: 100 },
  ])
    assert.throws(() => selectShortMemoryBatch([], limits), TypeError);
  assert.throws(
    () => selectShortMemoryBatch([item("a", "😀")], { maxItems: 1, maxChars: 2 }),
    RangeError,
  );
  assert.throws(
    () =>
      selectShortMemoryBatch([{ records: [{ role: "tool", content: "x" }] }], {
        maxItems: 1,
        maxChars: 100,
      }),
    TypeError,
  );
});
