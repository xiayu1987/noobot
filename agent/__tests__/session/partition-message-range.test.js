/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { listSnapshotRetentionFiles } from "../helpers/partition-journal-cases.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

async function seed(t) {
  const fixture = await createMessageCase(t, { pageRecords: 2 });
  const { journal, sessionId } = fixture;
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "seed", {
      messages: [message(sessionId, "m1"), message(sessionId, "m2")],
    }),
  );
  const second = { dialogProcessId: "dialog-2", turnScopeId: "turn-2" };
  await messages.commit(
    await prepare(journal, messages, "seed-next-turn", {
      messages: [
        { ...message(sessionId, "m3"), ...second },
        { ...message(sessionId, "m4"), ...second },
      ],
    }),
  );
  return { ...fixture, messages, second, options: { journal, sessionId, parentSessionId: "" } };
}

test("global body pages span turns and preserve a pinned snapshot during append", async (t) => {
  const { journal, messages, sessionId, options } = await seed(t);
  let escaped;
  {
    await using reader = await openPartitionSessionReader(options);
    escaped = reader;
    const first = await reader.readMessagePage({ limit: 3 });
    assert.equal(first.generation, reader.generation);
    assert.equal(first.messageCount, 4);
    assert.deepEqual(
      first.records.map(({ ordinal, message }) => [ordinal, message.content]),
      [
        [1, "m1"],
        [2, "m2"],
      ],
    );
    assert.ok(first.nextCursor);
    await messages.commit(
      await prepare(journal, messages, "append", {
        messages: [message(sessionId, "m5")],
      }),
    );
    const last = await reader.readMessagePage({ cursor: first.nextCursor, limit: 3 });
    assert.equal(last.messageCount, 4);
    assert.equal(last.nextCursor, null);
    assert.deepEqual(
      last.records.map(({ ordinal, turnOrdinal, message }) => [
        ordinal,
        turnOrdinal,
        message.content,
      ]),
      [
        [3, 1, "m3"],
        [4, 2, "m4"],
      ],
    );
    await using current = await openPartitionSessionReader(options);
    await assert.rejects(current.readMessagePage({ cursor: first.nextCursor, limit: 3 }), {
      code: "SESSION_PAGE_CURSOR_CONFLICT",
    });
    assert.equal((await current.readMessagePage({ limit: 1 })).messageCount, 5);
  }
  await assert.rejects(escaped.readMessagePage({ limit: 1 }), { code: "SESSION_READER_CLOSED" });
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("suffix body pages begin at the selected turn and cannot consume other page cursors", async (t) => {
  const { options, second } = await seed(t);
  await using reader = await openPartitionSessionReader(options);
  assert.equal(await reader.readMessageTailPage({ turnScopeId: "missing", limit: 1 }), null);
  const first = await reader.readMessageTailPage({ turnScopeId: second.turnScopeId, limit: 1 });
  assert.deepEqual(first.messageSuffix, { firstOrdinal: 3, previousMessageCount: 4 });
  assert.equal(first.records[0].message.content, "m3");
  const next = await reader.readMessageTailPage({
    turnScopeId: second.turnScopeId,
    cursor: first.nextCursor,
    limit: 1,
  });
  assert.equal(next.records[0].message.content, "m4");
  assert.equal(next.nextCursor, null);
  for (const read of [
    () => reader.readMessagePage({ cursor: first.nextCursor, limit: 1 }),
    () =>
      reader.readMessageTailPage({
        turnScopeId: scope.turnScopeId,
        cursor: first.nextCursor,
        limit: 1,
      }),
  ])
    await assert.rejects(read(), { code: "SESSION_PAGE_CURSOR_CONFLICT" });
});

test("range readers enforce shared byte budgets and reject out-of-range cursors", async (t) => {
  const { options } = await seed(t);
  await using reader = await openPartitionSessionReader(options);
  for (const read of [
    () => reader.readMessagePage({ limit: 1, maxBytes: 1 }),
    () => reader.readMessageTailPage({ turnScopeId: scope.turnScopeId, limit: 1, maxBytes: 1 }),
  ])
    await assert.rejects(read(), { code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED" });
  const first = await reader.readMessagePage({ limit: 1 });
  await assert.rejects(
    reader.readMessagePage({
      cursor: { ...first.nextCursor, after: 4 },
      limit: 1,
    }),
    { code: "SESSION_PAGE_CURSOR_CONFLICT" },
  );
});

test("empty session range is an empty terminal page", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  await using reader = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  assert.deepEqual(await reader.readMessagePage(), {
    generation: reader.generation,
    messageCount: 0,
    records: [],
    nextCursor: null,
  });
});
