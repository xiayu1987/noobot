/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readPartitionReplacement,
  readPartitionTurnMembershipVisibility,
} from "../src/partition-turn-visibility.js";
import { createTurnReplacementCommit } from "../src/lifecycle/turn-replacement.js";
import { SESSION_COMMAND } from "../src/command/session-command.js";
import { partitionMessageEntryKey } from "../src/partition-session-messages.js";

const member = { mutation: { value: { dialogProcessId: "dialog", messageCount: 1 } } };
const anchor = {
  message: {
    sessionId: "session",
    messageUid: "message",
    turnScopeId: "turn",
    dialogProcessId: "dialog",
  },
  sessionOrdinal: 1,
  turnOrdinal: 1,
};

function fixture({ position = "message", value = anchor, count = 1 } = {}) {
  const calls = [];
  const collections = {
    turnMessages: new Map([
      [partitionMessageEntryKey("turnMessages", "turn", 1), { value: position }],
    ]),
    messages: new Map([["message", { value }]]),
    metadata: new Map([["messageCount", { value: count }]]),
    messageOrder: new Map([
      [partitionMessageEntryKey("messageOrder", "session", 1), { value: "message" }],
    ]),
  };
  return {
    calls,
    read: async ({ collection, keys }) => {
      calls.push({ collection, keys });
      return new Map(keys.map((key) => [key, collections[collection]?.get(key) ?? null]));
    },
  };
}

test("lifecycle-only and removed memberships require no message I/O", async () => {
  const { read, calls } = fixture();
  assert.deepEqual(
    await readPartitionTurnMembershipVisibility(
      read,
      new Map([
        ["lifecycle-only", null],
        ["removed", { mutation: { remove: true } }],
      ]),
      (value) => value,
    ),
    new Map([
      ["lifecycle-only", true],
      ["removed", false],
    ]),
  );
  assert.deepEqual(calls, []);
});

test("membership visibility opens one anchor per selected turn, independently of its message count", async () => {
  const { read, calls } = fixture();
  const turns = new Map([
    ["turn", { mutation: { value: { ...member.mutation.value, messageCount: 1000000 } } }],
  ]);
  assert.deepEqual(
    await readPartitionTurnMembershipVisibility(read, turns, (value) => value),
    new Map([["turn", true]]),
  );
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ keys }) => keys.length === 1));
});

test("truncated anchors use the session count without opening session positions", async () => {
  const { read, calls } = fixture({ count: 0 });
  assert.equal(
    (
      await readPartitionTurnMembershipVisibility(
        read,
        new Map([["turn", member]]),
        (value) => value,
      )
    ).get("turn"),
    false,
  );
  assert.equal(calls.length, 3);
});

for (const value of [
  { ...anchor, turnOrdinal: 2 },
  { ...anchor, message: { ...anchor.message, turnScopeId: "foreign" } },
  { ...anchor, message: { ...anchor.message, dialogProcessId: "foreign" } },
]) {
  test(`a misdirected turn anchor rejects as corruption: ${JSON.stringify(value)}`, async () => {
    const { read } = fixture({ value });
    await assert.rejects(
      readPartitionTurnMembershipVisibility(read, new Map([["turn", member]]), (value) => value),
      {
        code: "SESSION_STORAGE_CORRUPT",
      },
    );
  });
}

test("missing anchors reject rather than silently hiding the turn", async () => {
  const { read } = fixture({ position: null });
  await assert.rejects(
    readPartitionTurnMembershipVisibility(read, new Map([["turn", member]]), (value) => value),
    {
      code: "SESSION_STORAGE_CORRUPT",
    },
  );
});

test("replacement references require a matching authoritative receipt", async () => {
  const query = { sessionId: "session", turnScopeId: "turn", lifecycleSequence: 3 };
  const replacement = createTurnReplacementCommit({
    sessionId: query.sessionId,
    commandId: "replace",
    committedAggregateVersion: 4,
    replacedTurnScopeIds: [query.turnScopeId],
    replacementDialogProcessId: "new-dialog",
    replacementTurnScopeId: "new-turn",
    replacementUserMessageUid: "new-message",
    requestHash: "hash",
    committedAt: "2026-11-19T00:00:00.000Z",
  });
  const receipt = {
    type: SESSION_COMMAND.TURN_REPLACE,
    commandId: replacement.commandId,
    aggregateVersion: replacement.committedAggregateVersion,
    requestHash: replacement.requestHash,
    committedAt: replacement.committedAt,
    result: { turnReplacement: replacement },
  };
  const reference = { commandId: receipt.commandId, sequence: 2 };
  const resolve = (pointer, command, scope = query) =>
    readPartitionReplacement(
      (collection) => (collection === "replacements" ? pointer : command),
      scope,
    );
  assert.equal(await resolve(null, null), null);
  assert.deepEqual(await resolve(reference, receipt), {
    commandId: "replace",
    committedAggregateVersion: 4,
    replacedTurnScopeIds: ["turn"],
    replacementDialogProcessId: "new-dialog",
    replacementTurnScopeId: "new-turn",
    replacementUserMessageUid: "new-message",
    requestHash: "hash",
    committedAt: "2026-11-19T00:00:00.000Z",
    turnScopeId: "turn",
    sequence: 2,
  });
  for (const pending of [
    () => resolve(reference, null),
    () => resolve(reference, { ...receipt, requestHash: "other" }),
    () => resolve({ ...reference, sequence: 4 }, receipt),
    () => resolve(reference, receipt, { ...query, sessionId: "foreign" }),
    () => resolve(reference, receipt, { ...query, turnScopeId: "foreign" }),
  ])
    await assert.rejects(pending, { code: "SESSION_STORAGE_CORRUPT" });
});
