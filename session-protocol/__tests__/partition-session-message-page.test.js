/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PARTITION_MESSAGE_PAGE,
  createPartitionMessagePage,
  createPartitionMessageSuffixPage,
  requirePartitionMessagePage,
  resolvePartitionMessageSuffix,
} from "../src/partition-session-messages.js";

test("message page result budget counts UTF-8 bytes, JSON escaping and the continuation cursor", () => {
  const snapshot = {
    sessionId: "test-session",
    epoch: "a".repeat(32),
    sequence: 1,
    limits: { pageRecords: 2, pageBytes: 4096 },
  };
  const position = requirePartitionMessagePage(
    snapshot,
    PARTITION_MESSAGE_PAGE.turn,
    ["dialog", "turn"],
    { cursor: null, limit: 1 },
  );
  const expected = { entries: [], nextCursor: { after: 1, scope: position.scope } };
  const prefix = '\u4f60\u597d\n"\\';
  const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
  expected.entries.push(prefix);
  expected.entries[0] += "x".repeat(snapshot.limits.pageBytes - bytes(expected));
  assert.equal(bytes(expected), snapshot.limits.pageBytes);
  assert.deepEqual(
    createPartitionMessagePage(snapshot, expected.entries, position, true),
    expected,
  );

  const entries = [`${expected.entries[0]}x`];
  assert.ok(bytes({ entries, nextCursor: null }) <= snapshot.limits.pageBytes);
  assert.deepEqual(createPartitionMessagePage(snapshot, entries, position, false), {
    entries,
    nextCursor: null,
  });
  assert.throws(() => createPartitionMessagePage(snapshot, entries, position, true), {
    code: "SESSION_QUERY_BUDGET",
    message: /results exceed byte budget/,
  });
  assert.throws(() => createPartitionMessagePage(snapshot, entries, position, 2), TypeError);
  assert.throws(() => createPartitionMessagePage(snapshot, [], position, true), TypeError);
});

test("message suffix page includes its authoritative bounds in the response budget", () => {
  const snapshot = {
    sessionId: "test-session",
    epoch: "a".repeat(32),
    sequence: 1,
    limits: { pageRecords: 2, pageBytes: 4096 },
  };
  const position = requirePartitionMessagePage(snapshot, PARTITION_MESSAGE_PAGE.suffix, ["turn"], {
    cursor: null,
    limit: 1,
  });
  const anchor = { dialogProcessId: "dialog", turnScopeId: "turn", messageUid: "first" };
  const suffix = resolvePartitionMessageSuffix(
    snapshot,
    { message: { sessionId: snapshot.sessionId, ...anchor }, sessionOrdinal: 10, turnOrdinal: 1 },
    11,
  );
  const entries = ["\u4f60"];
  const expected = {
    messageSuffix: {
      firstOrdinal: 10,
      previousMessageCount: 11,
    },
    predecessor: { sessionId: snapshot.sessionId, epoch: snapshot.epoch, generation: 1 },
    anchor,
    entries,
    nextCursor: { after: 1, scope: position.scope },
  };
  const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
  entries[0] += "x".repeat(snapshot.limits.pageBytes - bytes(expected));
  assert.equal(bytes(expected), snapshot.limits.pageBytes);
  assert.deepEqual(createPartitionMessageSuffixPage(snapshot, entries, position, suffix), expected);
  const oversized = [`${entries[0]}x`];
  assert.doesNotThrow(() => createPartitionMessagePage(snapshot, oversized, position, true));
  assert.throws(() => createPartitionMessageSuffixPage(snapshot, oversized, position, suffix), {
    code: "SESSION_QUERY_BUDGET",
  });
});

test("continuation cursors cannot cross message query types", () => {
  const snapshot = {
    sessionId: "test-session",
    epoch: "a".repeat(32),
    sequence: 1,
    limits: { pageRecords: 2, pageBytes: 4096 },
  };
  const turnQuery = [PARTITION_MESSAGE_PAGE.turn, [snapshot.sessionId, "turn"]];
  const suffixQuery = [PARTITION_MESSAGE_PAGE.suffix, ["turn"]];
  const turn = requirePartitionMessagePage(snapshot, ...turnQuery, { cursor: null, limit: 1 });
  const suffix = requirePartitionMessagePage(snapshot, ...suffixQuery, { cursor: null, limit: 1 });
  for (const [query, foreign] of [
    [turnQuery, suffix],
    [suffixQuery, turn],
  ]) {
    assert.throws(
      () =>
        requirePartitionMessagePage(snapshot, ...query, {
          cursor: { after: 1, scope: foreign.scope },
          limit: 1,
        }),
      { code: "SESSION_PAGE_CURSOR_CONFLICT" },
    );
  }
  assert.throws(
    () => requirePartitionMessagePage(snapshot, "unknown", [], { cursor: null, limit: 1 }),
    TypeError,
  );
});
