/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  partitionMessageEntryKey,
  readPartitionMessagePositionVisibility,
  readPartitionSessionMessageCount,
  requirePartitionVisibleMessageTurnOwnership,
} from "../src/partition-session-messages.js";

const sessionId = "session-1";
const record = (messageUid, sessionOrdinal) => ({
  message: { sessionId, messageUid },
  sessionOrdinal,
});
const key = (ordinal) => partitionMessageEntryKey("messageOrder", sessionId, ordinal);

function reader(collections) {
  const calls = [];
  return {
    calls,
    async read(query) {
      calls.push(query);
      const { collection, keys, includeOwner } = query;
      return new Map(
        keys.map((key) => {
          const mutation = collections[collection]?.get(key) ?? null;
          return [key, includeOwner && mutation !== null ? { mutation } : mutation];
        }),
      );
    },
  };
}

test("visible-prefix lookup batches unique positions and does not open message records", async () => {
  const { read, calls } = reader({
    messageOrder: new Map([
      [key(1), { value: "a" }],
      [key(2), { value: "b" }],
    ]),
  });
  assert.deepEqual(
    await readPartitionMessagePositionVisibility(read, sessionId, 2, {
      records: [record("a", 1), record("b", 2), record("a", 1), record("hidden", 3)],
    }),
    [true, true, true, false],
  );
  assert.deepEqual(calls, [{ collection: "messageOrder", keys: [key(1), key(2)] }]);
});

test("an entirely truncated selection performs no position or message I/O", async () => {
  const { read, calls } = reader({});
  assert.deepEqual(
    await readPartitionMessagePositionVisibility(read, sessionId, 0, { records: [record("a", 1)] }),
    [false],
  );
  assert.deepEqual(calls, []);
});

test("a reused position requires evidence from the new record at that exact position", async () => {
  const { read, calls } = reader({
    messageOrder: new Map([[key(1), { value: "new" }]]),
    messages: new Map([["new", { value: record("new", 1) }]]),
  });
  assert.deepEqual(
    await readPartitionMessagePositionVisibility(read, sessionId, 1, {
      records: [record("old", 1)],
    }),
    [false],
  );
  assert.deepEqual(calls, [
    { collection: "messageOrder", keys: [key(1)] },
    { collection: "messages", keys: ["new"] },
  ]);
});

for (const value of [
  null,
  record("other", 1),
  record("new", 2),
  {
    ...record("new", 1),
    message: { sessionId: "foreign", messageUid: "new" },
  },
]) {
  test(`misdirected position is corruption rather than deletion: ${JSON.stringify(value)}`, async () => {
    const { read } = reader({
      messageOrder: new Map([[key(1), { value: "new" }]]),
      messages: new Map([["new", { value }]]),
    });
    await assert.rejects(
      readPartitionMessagePositionVisibility(read, sessionId, 1, { records: [record("old", 1)] }),
      {
        code: "SESSION_STORAGE_CORRUPT",
      },
    );
  });
}

test("missing positions, invalid message counts and invalid ownership cannot become invisible defaults", async () => {
  const { read } = reader({});
  for (const count of [undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      readPartitionMessagePositionVisibility(read, sessionId, count, { records: [] }),
      {
        code: "SESSION_STORAGE_CORRUPT",
      },
    );
  }
  await assert.rejects(readPartitionSessionMessageCount(read), { code: "SESSION_STORAGE_CORRUPT" });
  await assert.rejects(
    readPartitionMessagePositionVisibility(read, sessionId, 1, { records: [record("a", 1)] }),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
  await assert.rejects(
    readPartitionMessagePositionVisibility(read, "foreign", 0, { records: [record("a", 1)] }),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
  await assert.rejects(
    readPartitionMessagePositionVisibility(read, sessionId, 0, { records: [record("a", 0)] }),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
});

const ownedMessage = (turnOrdinal, dialogProcessId = "dialog") => ({
  message: { turnScopeId: "turn", dialogProcessId, messageUid: `message-${turnOrdinal}` },
  turnOrdinal,
});

test("visible message ownership batches each turn once and an empty page performs no I/O", async () => {
  const { read, calls } = reader({
    turns: new Map([["turn", { value: { dialogProcessId: "dialog", messageCount: 2 } }]]),
    turnMessages: new Map([
      [partitionMessageEntryKey("turnMessages", "turn", 1), { value: "message-1" }],
      [partitionMessageEntryKey("turnMessages", "turn", 2), { value: "message-2" }],
    ]),
  });
  await requirePartitionVisibleMessageTurnOwnership(read, []);
  assert.deepEqual(calls, []);
  await requirePartitionVisibleMessageTurnOwnership(read, [
    ownedMessage(1),
    ownedMessage(2),
    ownedMessage(1),
  ]);
  assert.deepEqual(calls, [
    { collection: "turns", keys: ["turn"], includeOwner: true },
    { collection: "lifecycle", keys: ["turn"], includeOwner: true },
    {
      collection: "turnMessages",
      keys: [
        partitionMessageEntryKey("turnMessages", "turn", 1),
        partitionMessageEntryKey("turnMessages", "turn", 2),
      ],
    },
  ]);
});

test("target ownership is checked without messages and shares the message turn batch", async () => {
  const { read, calls } = reader({
    turns: new Map([
      ["turn", { value: { dialogProcessId: "dialog", messageCount: 1 } }],
      ["target", { value: { dialogProcessId: "target-dialog", messageCount: 1 } }],
    ]),
    turnMessages: new Map([
      [partitionMessageEntryKey("turnMessages", "turn", 1), { value: "message-1" }],
    ]),
  });
  const target = { turnScopeId: "target", dialogProcessId: "target-dialog" };
  const ownership = await requirePartitionVisibleMessageTurnOwnership(read, [], target);
  assert.equal(ownership.turns.get("target").mutation.value.dialogProcessId, "target-dialog");
  assert.deepEqual(calls.splice(0), [
    { collection: "turns", keys: ["target"], includeOwner: true },
    { collection: "lifecycle", keys: ["target"], includeOwner: true },
  ]);
  await requirePartitionVisibleMessageTurnOwnership(read, [ownedMessage(1)], target);
  assert.deepEqual(calls.splice(0), [
    { collection: "turns", keys: ["turn", "target"], includeOwner: true },
    { collection: "lifecycle", keys: ["turn", "target"], includeOwner: true },
    {
      collection: "turnMessages",
      keys: [partitionMessageEntryKey("turnMessages", "turn", 1)],
    },
  ]);
  await assert.rejects(
    requirePartitionVisibleMessageTurnOwnership(read, [], {
      ...target,
      dialogProcessId: "foreign-dialog",
    }),
    { code: "SESSION_TURN_IDENTITY_CONFLICT" },
  );
});

test("published message membership disagreement is corruption, not a caller identity conflict", async () => {
  const { read } = reader({
    turns: new Map([["turn", { value: { dialogProcessId: "dialog", messageCount: 2 } }]]),
  });
  for (const record of [
    ownedMessage(1, "foreign-dialog"),
    ownedMessage(3),
    ownedMessage(0),
    ownedMessage(1.5),
    ownedMessage(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    await assert.rejects(requirePartitionVisibleMessageTurnOwnership(read, [record]), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  }
  const missing = reader({});
  await assert.rejects(
    requirePartitionVisibleMessageTurnOwnership(missing.read, [ownedMessage(1)]),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
});

test("visible membership requires the published turn position to reference that message", async () => {
  for (const position of [null, { value: "foreign-message" }]) {
    const { read } = reader({
      turns: new Map([["turn", { value: { dialogProcessId: "dialog", messageCount: 2 } }]]),
      turnMessages: new Map([[partitionMessageEntryKey("turnMessages", "turn", 1), position]]),
    });
    await assert.rejects(requirePartitionVisibleMessageTurnOwnership(read, [ownedMessage(1)]), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  }
});
