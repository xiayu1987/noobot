/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applySessionStorageJournalRecords,
  compactSessionStorageJournalRecords,
  createSessionStorageJournalProjection,
  materializeSessionStorageJournal,
  sessionStorageMessageHash,
} from "../src/index.js";

const positions = (...uids) =>
  uids.map((messageUid, index) => ({ messageUid, ordinal: index + 1 }));
function upsert(messageUid) {
  const message = { messageUid };
  return { op: "upsert", messageUid, message, hash: sessionStorageMessageHash(message) };
}
function replay(records) {
  return materializeSessionStorageJournal(
    applySessionStorageJournalRecords(createSessionStorageJournalProjection(), records),
  );
}

test("position deltas compose across checkpoints and full reorders", () => {
  const base = [upsert("a"), { op: "order", positions: positions("a") }];
  const delta = [
    upsert("b"),
    { op: "append_positions", positions: [{ messageUid: "b", ordinal: 2 }] },
    upsert("c"),
    { op: "append_positions", positions: [{ messageUid: "c", ordinal: 3 }] },
  ];
  assert.deepEqual(
    replay([...base, ...delta]),
    replay([...base, ...compactSessionStorageJournalRecords(delta)]),
  );
  const reorder = [
    { op: "remove", messageUid: "b" },
    { op: "order", positions: positions("c", "a") },
  ];
  const records = [
    ...base,
    ...delta,
    ...reorder,
    upsert("d"),
    { op: "append_positions", positions: [{ messageUid: "d", ordinal: 4 }] },
  ];
  assert.deepEqual(replay(records), replay(compactSessionStorageJournalRecords(records)));
  assert.deepEqual(
    compactSessionStorageJournalRecords(compactSessionStorageJournalRecords(records)),
    compactSessionStorageJournalRecords(records),
  );
});

test("position deltas reject duplicate positions and incomplete message coverage", () => {
  const base = [upsert("a"), { op: "order", positions: positions("a") }];
  for (const position of [
    { messageUid: "a", ordinal: 2 },
    { messageUid: "b", ordinal: 1 },
    { messageUid: "b", ordinal: 0 },
  ]) {
    assert.throws(() =>
      replay([...base, upsert("b"), { op: "append_positions", positions: [position] }]),
    );
  }
  assert.throws(() =>
    replay([...base, { op: "append_positions", positions: [{ messageUid: "b", ordinal: 2 }] }]),
  );
  assert.throws(() => replay([...base, upsert("b")]));
});

test("append position bytes grow with appended messages rather than history", () => {
  let bytes;
  for (const count of [10, 100, 1000]) {
    const records = [];
    for (let index = 0; index < count; index += 1) records.push(upsert(`m${index}`));
    records.push({
      op: "order",
      positions: records.map(({ messageUid }, index) => ({ messageUid, ordinal: index + 1 })),
    });
    const delta = [
      upsert("new"),
      { op: "append_positions", positions: [{ messageUid: "new", ordinal: 2000 }] },
    ];
    bytes ??= JSON.stringify(delta).length;
    assert.equal(JSON.stringify(delta).length, bytes);
    assert.equal(replay([...records, ...delta]).length, count + 1);
  }
});
