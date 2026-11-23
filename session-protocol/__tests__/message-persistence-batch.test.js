/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MESSAGE_WRITE_BUDGET_ERROR,
  selectMessagePersistenceBatch,
} from "@noobot/session-protocol/message-persistence-batch";
import { projectMessagePersistenceChange } from "@noobot/session-protocol/session-changes";

const ownership = { sessionId: "session", dialogProcessId: "dialog", turnScopeId: "turn" };
const entry = (messageUid, content = "增量🙂") => ({
  messageUid,
  message: { ...ownership, messageUid, role: "assistant", content },
  persisted: null,
  contentAppend: null,
});
const encodedBytes = (value) => Buffer.byteLength(JSON.stringify(value));
const deltaBytes = (value) =>
  encodedBytes(
    projectMessagePersistenceChange(value.message, value.persisted, ownership, value.contentAppend),
  );

test("byte selection includes UTF-8 and accepts the exact boundary", () => {
  const first = entry("m1");
  const second = entry("m2");
  const limit = deltaBytes(first);
  const batch = selectMessagePersistenceBatch({
    entries: [first, second],
    ownership,
    maxBytes: limit,
  });
  assert.deepEqual(batch.entries, [first]);
  assert.equal(batch.bytes, limit);
  assert.throws(
    () => selectMessagePersistenceBatch({ entries: [first], ownership, maxBytes: limit - 1 }),
    { code: MESSAGE_WRITE_BUDGET_ERROR, limit: limit - 1 },
  );
});

test("record selection stops consuming the source at its bound", () => {
  let visited = 0;
  function* source() {
    visited += 1;
    yield entry("m1");
    visited += 1;
    throw new Error("must not request another record");
  }
  const batch = selectMessagePersistenceBatch({ entries: source(), ownership, maxRecords: 1 });
  assert.equal(batch.entries.length, 1);
  assert.equal(visited, 1);
});

test("byte-limited selection defers rather than discards the next record", () => {
  const entries = [entry("m1"), entry("m2", "longer payload"), entry("m3")];
  const maxBytes = deltaBytes(entries[0]) + deltaBytes(entries[1]) - 1;
  const first = selectMessagePersistenceBatch({ entries, ownership, maxBytes });
  assert.deepEqual(first.entries, entries.slice(0, 1));
  const next = selectMessagePersistenceBatch({ entries: entries.slice(1), ownership, maxBytes });
  assert.deepEqual(next.entries, entries.slice(1, 2));
});

test("append budgeting excludes acknowledged accumulated content", () => {
  const message = { ...entry("m1", "x".repeat(100000)).message };
  const persisted = {
    message,
    receipt: {
      ...ownership,
      messageUid: message.messageUid,
      contentReference: "body-v1",
      owner: 1,
      generation: 1,
      activityEventIds: [],
    },
  };
  const change = {
    message: { ...message, content: `${message.content}🙂` },
    persisted,
    contentAppend: "🙂",
  };
  const batch = selectMessagePersistenceBatch({ entries: [change], ownership, maxBytes: 1024 });
  assert.equal(batch.entries.length, 1);
  assert.equal(batch.bytes, deltaBytes(change));
  assert.ok(batch.bytes < 1024);
});

test("malformed deltas are not hidden by a preceding selected record", () => {
  const invalid = entry("invalid");
  invalid.message.unsupported = undefined;
  assert.throws(
    () => selectMessagePersistenceBatch({ entries: [entry("m1"), invalid], ownership }),
    /finite JSON values/,
  );
});

test("invalid limits are rejected even for an empty batch", () => {
  for (const limits of [
    { maxBytes: 0 },
    { maxBytes: Infinity },
    { maxRecords: 0 },
    { maxRecords: 1.5 },
    { maxRecords: 257 },
  ]) {
    assert.throws(
      () => selectMessagePersistenceBatch({ entries: [], ownership, ...limits }),
      /bounded byte and record limits/,
    );
  }
});
