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

test("display source pages skip suppressed bodies and keep snapshot and purpose boundaries", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, {
    pageRecords: 2,
    transactionBytes: 32 * 1024,
    receiptBytes: 32 * 1024,
    pageBytes: 32 * 1024,
  });
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "seed-display", {
      messages: [
        message(sessionId, "visible"),
        {
          ...message(sessionId, "hidden"),
          chatPresentation: false,
          content: "suppressed".repeat(1000),
        },
      ],
    }),
  );
  const options = { journal, sessionId, parentSessionId: "" };
  let escaped;
  {
    await using reader = await openPartitionSessionReader(options);
    escaped = reader;
    const first = await reader.readDisplaySourcePage({ limit: 1, maxBytes: 4096 });
    assert.equal(first.records[0].message.content, "visible");
    assert.equal(Object.hasOwn(first.records[0], "display"), false);
    assert.equal(first.messageCount, 2);
    await messages.commit(
      await prepare(journal, messages, "append-display", {
        messages: [message(sessionId, "later")],
      }),
    );
    const last = await reader.readDisplaySourcePage({
      cursor: first.nextCursor,
      limit: 1,
      maxBytes: 4096,
    });
    assert.equal(last.generation, first.generation);
    assert.equal(last.messageCount, 2);
    assert.equal(last.nextCursor, null);
    assert.equal(last.records[0].ordinal, 2);
    assert.equal(last.records[0].message.messageUid, "hidden");
    assert.equal(last.records[0].message.content, null);
    await assert.rejects(reader.readMessagePage({ cursor: first.nextCursor }), {
      code: "SESSION_PAGE_CURSOR_CONFLICT",
    });
    await assert.rejects(reader.readDisplaySourcePage({ cursor: first.nextCursor, maxBytes: 1 }), {
      code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
    });
    await using current = await openPartitionSessionReader(options);
    await assert.rejects(current.readDisplaySourcePage({ cursor: first.nextCursor }), {
      code: "SESSION_PAGE_CURSOR_CONFLICT",
    });
    assert.equal((await current.readDisplaySourcePage({ limit: 1 })).messageCount, 3);
  }
  await assert.rejects(escaped.readDisplaySourcePage(), { code: "SESSION_READER_CLOSED" });
});

test("display source page enforces visible body budget and caps records at the journal limit", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, {
    pageRecords: 1,
    transactionBytes: 32 * 1024,
    receiptBytes: 32 * 1024,
    pageBytes: 32 * 1024,
  });
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "visible-display", {
      messages: [{ ...message(sessionId, "large"), content: "x".repeat(6000) }],
    }),
  );
  await messages.commit(
    await prepare(journal, messages, "next-display", {
      messages: [message(sessionId, "next")],
    }),
  );
  await using reader = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  await assert.rejects(reader.readDisplaySourcePage({ maxBytes: 4096 }), {
    code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
  });
  const first = await reader.readDisplaySourcePage({ limit: 10, maxBytes: 16384 });
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0].message.content.length, 6000);
  assert.ok(first.nextCursor);
  const last = await reader.readDisplaySourcePage({ cursor: first.nextCursor, limit: 10 });
  assert.equal(last.records[0].message.content, "next");
  assert.equal(last.nextCursor, null);
});
