/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ERROR_CODE,
  applySessionStorageJournalRecords,
  compactSessionStorageJournalRecords,
  createSessionStorageJournalProjection,
  materializeSessionStorageJournal,
  sessionStorageMessageHash,
} from "../src/index.js";

function upsert(messageUid, content) {
  const message = { messageUid, content };
  return { op: "upsert", messageUid, message, hash: sessionStorageMessageHash(message) };
}
const order = (...uids) => ({
  op: "order",
  positions: uids.map((messageUid, index) => ({ messageUid, ordinal: index * 3 + 1 })),
});
function replay(base, records) {
  const state = createSessionStorageJournalProjection();
  applySessionStorageJournalRecords(state, base);
  applySessionStorageJournalRecords(state, records);
  return materializeSessionStorageJournal(state);
}

test("checkpoint delta compaction preserves replay on existing and empty bases", () => {
  const base = [upsert("a", "old"), upsert("b", "remove"), order("a", "b")];
  const delta = [
    upsert("a", "first update"),
    order("b", "a"),
    { op: "remove", messageUid: "b" },
    upsert("c", "temporary"),
    { op: "remove", messageUid: "c" },
    upsert("c", "restored"),
    upsert("a", "final update"),
    order("c", "a"),
  ];
  assert.deepEqual(replay(base, compactSessionStorageJournalRecords(delta)), replay(base, delta));
  assert.deepEqual(
    replay([], compactSessionStorageJournalRecords([...base, ...delta])),
    replay([], [...base, ...delta]),
  );
  assert.deepEqual(compactSessionStorageJournalRecords([]), []);
  const noOrder = [upsert("a", "first"), upsert("a", "last")];
  assert.deepEqual(
    replay(base, compactSessionStorageJournalRecords(noOrder)),
    replay(base, noOrder),
  );
});

test("checkpoint compaction composes across boundaries and preserves later removals", () => {
  const checkpoints = [
    [upsert("a", "one"), order("a"), upsert("a", "two")],
    [upsert("b", "three"), order("b", "a"), { op: "remove", messageUid: "a" }, order("b")],
    [upsert("a", "four"), order("a", "b"), upsert("b", "five")],
  ];
  const original = [];
  const compacted = [];
  for (const checkpoint of checkpoints) {
    original.push(...checkpoint);
    compacted.push(...compactSessionStorageJournalRecords(checkpoint));
    assert.deepEqual(replay([], compacted), replay([], original));
  }
});

test("checkpoint compaction validates overwritten records instead of hiding corruption", () => {
  for (const invalid of [
    { ...upsert("a", "bad"), hash: "sha256:invalid" },
    { op: "order", positions: [{ messageUid: "a", ordinal: 0 }] },
    { op: "remove", messageUid: " a " },
  ]) {
    assert.throws(
      () => compactSessionStorageJournalRecords([invalid, upsert("a", "valid"), order("a")]),
      { code: SESSION_ERROR_CODE.TURN_JOURNAL_RECORD_INVALID },
    );
  }
  assert.throws(() => compactSessionStorageJournalRecords(null), {
    code: SESSION_ERROR_CODE.TURN_JOURNAL_RECORD_INVALID,
  });
});

test("checkpoint delta size scales with final changes rather than repeated full orders", () => {
  const records = [];
  const uids = [];
  for (let index = 0; index < 96; index += 1) {
    uids.push(`message-${index}`);
    records.push(upsert(uids.at(-1), `content-${index}`), order(...uids));
  }
  const compacted = compactSessionStorageJournalRecords(records);
  assert.equal(compacted.length, 97);
  assert.equal(compacted.filter((record) => record.op === "order").length, 1);
  assert.ok(JSON.stringify(compacted).length < JSON.stringify(records).length / 8);
  assert.deepEqual(replay([], compacted), replay([], records));
  assert.deepEqual(compactSessionStorageJournalRecords(compacted), compacted);
});
