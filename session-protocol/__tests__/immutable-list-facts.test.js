/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { requireImmutableListFacts } from "../src/immutable-storage-graph.js";

for (const value of [
  null,
  [],
  {},
  { messageCount: -1, lastMessageUid: "" },
  { messageCount: 1.5, lastMessageUid: "m" },
  { messageCount: Number.MAX_SAFE_INTEGER + 1, lastMessageUid: "m" },
  { messageCount: 0, lastMessageUid: "m" },
  { messageCount: 1, lastMessageUid: "" },
  { messageCount: 1, lastMessageUid: " " },
  { messageCount: 1, lastMessageUid: 3 },
]) {
  test(`list facts reject inconsistent authority: ${JSON.stringify(value)}`, () => {
    assert.throws(() => requireImmutableListFacts(value), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  });
}

test("list facts retain their identity and unrelated authoritative counters", () => {
  for (const facts of [
    { messageCount: 0, lastMessageUid: "", messageSequence: 0 },
    { messageCount: 10, lastMessageUid: "last", dialogSequence: 4 },
  ]) {
    assert.equal(requireImmutableListFacts(facts), facts);
  }
});
