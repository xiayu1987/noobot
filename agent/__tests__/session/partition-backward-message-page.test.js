/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
} from "./partition-session-messages.test-helpers.js";

for (const method of ["readMessagePage", "readDisplaySourcePage"]) {
  test(`${method} seeks from the tail and paginates a pinned version without gaps`, async (t) => {
    const { journal, sessionId } = await createMessageCase(t, { pageRecords: 2 });
    const messages = openTestMessages(journal, sessionId);
    for (let index = 1; index <= 5; index += 1)
      await messages.commit(
        await prepare(journal, messages, `seed-${index}`, {
          messages: [message(sessionId, `m${index}`)],
        }),
      );
    const options = { journal, sessionId, parentSessionId: "" };
    await using reader = await openPartitionSessionReader(options);
    const first = await reader[method]({ direction: "backward", limit: 3 });
    assert.equal(first.messageCount, 5);
    assert.deepEqual(
      first.records.map(({ ordinal }) => ordinal),
      [4, 5],
    );
    await messages.commit(
      await prepare(journal, messages, "append", {
        messages: [message(sessionId, "m6")],
      }),
    );
    const second = await reader[method]({
      direction: "backward",
      cursor: first.nextCursor,
      limit: 3,
    });
    assert.deepEqual(
      second.records.map(({ ordinal }) => ordinal),
      [2, 3],
    );
    const third = await reader[method]({
      direction: "backward",
      cursor: second.nextCursor,
      limit: 3,
    });
    assert.deepEqual(
      third.records.map(({ ordinal }) => ordinal),
      [1],
    );
    assert.equal(third.nextCursor, null);
    assert.equal(third.messageCount, 5);
    assert.equal(third.generation, first.generation);
    await assert.rejects(reader[method]({ cursor: first.nextCursor, limit: 3 }), {
      code: "SESSION_PAGE_CURSOR_CONFLICT",
    });
    await using current = await openPartitionSessionReader(options);
    await assert.rejects(
      current[method]({
        direction: "backward",
        cursor: first.nextCursor,
        limit: 3,
      }),
      { code: "SESSION_PAGE_CURSOR_CONFLICT" },
    );
    assert.deepEqual(
      (await current[method]({ direction: "backward", limit: 1 })).records.map(
        ({ ordinal }) => ordinal,
      ),
      [6],
    );
  });
}

test("tail display reads do not materialize an oversized body outside the selected window", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, {
    pageRecords: 1,
    transactionBytes: 32768,
    receiptBytes: 32768,
    pageBytes: 32768,
  });
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "large-history", {
      messages: [{ ...message(sessionId, "old"), content: "x".repeat(10000) }],
    }),
  );
  await messages.commit(
    await prepare(journal, messages, "recent", {
      messages: [message(sessionId, "recent")],
    }),
  );
  await using reader = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  const page = await reader.readDisplaySourcePage({
    direction: "backward",
    limit: 1,
    maxBytes: 4096,
  });
  assert.equal(page.records[0].message.content, "recent");
  await assert.rejects(
    reader.readDisplaySourcePage({
      direction: "backward",
      cursor: page.nextCursor,
      limit: 1,
      maxBytes: 4096,
    }),
    { code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED" },
  );
  const before = journal.work.readBytes;
  await assert.rejects(reader.readDisplaySourcePage({ direction: "invalid", limit: 1 }), TypeError);
  assert.equal(journal.work.readBytes, before);
});

test("empty backwards display window is terminal", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  await using reader = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  const page = await reader.readDisplaySourcePage({ direction: "backward", limit: 1 });
  assert.equal(page.messageCount, 0);
  assert.deepEqual(page.records, []);
  assert.equal(page.nextCursor, null);
});
