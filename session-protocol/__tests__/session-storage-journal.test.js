/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { storageDigest as portableStorageDigest } from "../src/storage-digest.js";
import { storageDigest as nativeStorageDigest } from "../src/storage-digest.node.js";
import {
  SESSION_ERROR_CODE,
  assertSessionStorageJournalRecord,
  createSessionStorageJournalProjection,
  applySessionStorageJournalRecords,
  materializeSessionStorageJournal,
  sessionStorageMessageHash,
} from "../src/index.js";

function upsert(messageUid, content) {
  const message = { messageUid, content };
  return {
    op: "upsert",
    messageUid,
    message,
    hash: `sha256:${createHash("sha256").update(JSON.stringify(message)).digest("hex")}`,
  };
}
const order = (positions) => ({
  op: "order",
  positions: positions.map(([messageUid, ordinal]) => ({ messageUid, ordinal })),
});
const reject = (fn) => assert.throws(fn, { code: SESSION_ERROR_CODE.TURN_JOURNAL_RECORD_INVALID });

test("journal order preserves noncontiguous global positions independently of insertion order", () => {
  const state = createSessionStorageJournalProjection();
  applySessionStorageJournalRecords(state, [
    upsert("a", "first"),
    upsert("b", "second"),
    order([
      ["b", 2],
      ["a", 9],
    ]),
  ]);
  assert.deepEqual(
    materializeSessionStorageJournal(state).map(({ message, ordinal }) => [
      message.messageUid,
      ordinal,
    ]),
    [
      ["b", 2],
      ["a", 9],
    ],
  );
});

test("journal replay composes snapshots and tails, updating hashes and removing messages", () => {
  const state = createSessionStorageJournalProjection();
  applySessionStorageJournalRecords(state, [
    upsert("a", "old"),
    upsert("b", "remove"),
    order([
      ["a", 1],
      ["b", 2],
    ]),
  ]);
  const changed = upsert("a", "new");
  applySessionStorageJournalRecords(state, [
    changed,
    { op: "remove", messageUid: "b" },
    upsert("c", "tail"),
    order([
      ["a", 1],
      ["c", 4],
    ]),
  ]);
  assert.deepEqual(
    materializeSessionStorageJournal(state).map(({ message }) => message.content),
    ["new", "tail"],
  );
  assert.equal(state.hashes.get("a"), changed.hash);
  assert.equal(state.hashes.has("b"), false);
});

test("an order record must cover every message without duplicate identities or global positions", () => {
  for (const positions of [
    [
      ["a", 1],
      ["a", 2],
    ],
    [
      ["a", 1],
      ["b", 1],
    ],
    [["a", 0]],
    [["a", 1.5]],
  ]) {
    reject(() => assertSessionStorageJournalRecord(order(positions)));
  }
  for (const positions of [
    [],
    [["missing", 1]],
    [
      ["a", 1],
      ["b", 2],
    ],
  ]) {
    const state = applySessionStorageJournalRecords(createSessionStorageJournalProjection(), [
      upsert("a", "data"),
      order(positions),
    ]);
    reject(() => materializeSessionStorageJournal(state));
  }
});

test("journal records reject unknown fields, identity conflicts and invalid digests", () => {
  const valid = upsert("a", "data");
  for (const record of [
    null,
    {},
    { op: "invalid", messageUid: "a" },
    { ...valid, extra: true },
    { ...valid, messageUid: "other" },
    { ...valid, hash: "sha256:invalid" },
    { op: "remove", messageUid: " a " },
    { op: "remove", messageUid: "a", message: {} },
    { op: "order", positions: [{ messageUid: "a", ordinal: 1, extra: true }] },
  ]) {
    reject(() => assertSessionStorageJournalRecord(record));
  }
  reject(() => applySessionStorageJournalRecords(createSessionStorageJournalProjection(), null));
});

test("native and portable storage digests preserve the same SHA-256 contract", () => {
  for (const content of [
    "",
    "abc",
    "中文 😀",
    "\ud800",
    "\udfff",
    "\u0000\n\r",
    "中".repeat(65536),
  ]) {
    const serialized = JSON.stringify({ messageUid: "a", content });
    const expected = createHash("sha256").update(serialized).digest("hex");
    assert.equal(nativeStorageDigest(serialized), expected);
    assert.equal(portableStorageDigest(serialized), expected);
    assert.equal(sessionStorageMessageHash({ messageUid: "a", content }), `sha256:${expected}`);
  }
});

test("journal digest authenticates exact serialized content including Unicode", () => {
  for (const content of ["", "中文 😀", "line\nbreak", "x".repeat(65536)]) {
    const record = upsert("a", content);
    assert.equal(sessionStorageMessageHash(record.message), record.hash);
    assertSessionStorageJournalRecord(record);
    reject(() =>
      assertSessionStorageJournalRecord({
        ...record,
        message: { ...record.message, content: `${content}!` },
      }),
    );
    reject(() =>
      assertSessionStorageJournalRecord({
        ...record,
        hash: `sha256:${"0".repeat(64)}`,
      }),
    );
  }
});
