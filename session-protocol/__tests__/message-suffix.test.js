/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSessionMessageSuffixEffect } from "../src/index.js";
import {
  PARTITION_MESSAGE_PAGE,
  createPartitionMessageSuffixPage,
  requirePartitionMessagePage,
  resolvePartitionMessageSuffix,
} from "../src/partition-session-messages.js";

function fixture() {
  const snapshot = {
    sessionId: "session-1",
    epoch: "a".repeat(32),
    sequence: 3,
    limits: { pageRecords: 2, pageBytes: 4096 },
  };
  const anchor = {
    message: {
      sessionId: snapshot.sessionId,
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      messageUid: "message-1",
    },
    sessionOrdinal: 10,
    turnOrdinal: 1,
  };
  const suffix = resolvePartitionMessageSuffix(snapshot, anchor, 11);
  const position = requirePartitionMessagePage(
    snapshot,
    PARTITION_MESSAGE_PAGE.suffix,
    ["turn-1"],
    {
      cursor: null,
      limit: 1,
    },
  );
  return { snapshot, suffix, position };
}

test("suffix bounds retain exact counts at single-message and safe-integer boundaries", () => {
  for (const [firstOrdinal, previousMessageCount] of [
    [1, 1],
    [1, Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [10, 11],
  ]) {
    const effect = resolveSessionMessageSuffixEffect({ firstOrdinal, previousMessageCount });
    assert.equal(effect.retainedMessageCount + effect.deletedCount, previousMessageCount);
    assert.equal(effect.retainedMessageCount + 1, firstOrdinal);
    assert.ok(effect.deletedCount >= 1);
  }
});

test("suffix effects reject ambiguous fields and invalid or empty ranges", () => {
  for (const value of [
    null,
    [],
    {},
    { firstOrdinal: 1 },
    { firstOrdinal: 1, previousMessageCount: 1, deletedCount: 1 },
    { firstOrdinal: 1, previousMessageCount: 1, predecessor: {} },
    { firstOrdinal: 0, previousMessageCount: 1 },
    { firstOrdinal: 2, previousMessageCount: 1 },
    { firstOrdinal: 1, previousMessageCount: 0 },
    { firstOrdinal: 1.5, previousMessageCount: 2 },
    { firstOrdinal: 1, previousMessageCount: Infinity },
    { firstOrdinal: 1, previousMessageCount: Number.MAX_SAFE_INTEGER + 1 },
    { firstOrdinal: "1", previousMessageCount: 1 },
  ])
    assert.equal(resolveSessionMessageSuffixEffect(value), null);
});

test("partition pages expose the same suffix effect as mutation projections", () => {
  const { snapshot, suffix, position } = fixture();
  const page = createPartitionMessageSuffixPage(snapshot, ["message-1"], position, suffix);
  assert.deepEqual(resolveSessionMessageSuffixEffect(page.messageSuffix), {
    messageSuffix: { firstOrdinal: 10, previousMessageCount: 11 },
    retainedMessageCount: 9,
    deletedCount: 2,
  });
  assert.deepEqual(page.predecessor, suffix.predecessor);
  assert.deepEqual(page.anchor, suffix.anchor);
});

for (const [field, value] of [
  ["sessionId", "foreign-session"],
  ["epoch", "b".repeat(32)],
  ["generation", 2],
  ["generation", 4],
]) {
  test(`suffix pages reject a foreign predecessor ${field}=${value}`, () => {
    const { snapshot, suffix, position } = fixture();
    assert.throws(
      () =>
        createPartitionMessageSuffixPage(snapshot, ["message-1"], position, {
          ...suffix,
          predecessor: { ...suffix.predecessor, [field]: value },
        }),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
  });
}

test("suffix pages reject missing, unknown and noncanonical source identity fields", () => {
  const { snapshot, suffix, position } = fixture();
  for (const change of [
    { predecessor: null },
    { predecessor: { ...suffix.predecessor, extra: true } },
    { anchor: null },
    { anchor: { ...suffix.anchor, messageUid: " message-1 " } },
    { anchor: { ...suffix.anchor, extra: "unexpected" } },
    { messageSuffix: { firstOrdinal: 10, previousMessageCount: 9 } },
    { messageSuffix: { ...suffix.messageSuffix, anchor: suffix.anchor } },
  ])
    assert.throws(
      () =>
        createPartitionMessageSuffixPage(snapshot, ["message-1"], position, {
          ...suffix,
          ...change,
        }),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
});
