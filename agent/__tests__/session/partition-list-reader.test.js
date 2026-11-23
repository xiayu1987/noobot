/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionMessagePreviewLimits } from "@noobot/session-protocol/message-preview";
import {
  PARTITION_MESSAGE_COLLECTIONS,
  partitionMessageEntryKey,
} from "@noobot/session-protocol/partition-session-messages";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { sessionSummaryMethods } from "../../src/session/repositories/file-system-session-repository/summary-methods.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  createMessageCase,
  openTestMessages,
  prepare,
  message,
  scope,
} from "./partition-session-messages.test-helpers.js";

const openReader = (journal, sessionId) =>
  openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });

test("partition list drives the business summary consumer for empty and populated sessions", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  await using empty = await openReader(journal, sessionId);
  assert.deepEqual(await empty.readListProjection(), { messageCount: 0, lastMessage: null });
  const initial = await sessionSummaryMethods._buildSessionSummaryFromReader(empty);
  assert.equal(initial.messageCount, 0);
  assert.equal(initial.lastMessage, null);
  await repository.commit(
    await prepare(journal, repository, "populate", {
      messages: [message(sessionId, "first"), message(sessionId, "last")],
      sessionMetadata: { customTitle: "partition business summary" },
    }),
  );
  await using current = await openReader(journal, sessionId);
  const summary = await sessionSummaryMethods._buildSessionSummaryFromReader(current);
  assert.equal(summary.title, "partition business summary");
  assert.equal(summary.messageCount, 2);
  assert.equal(summary.lastMessage.messageUid, "last");
  assert.equal(summary.lastMessage.content, "last");
  assert.equal(summary.lastMessage.contentTruncated, false);
  assert.deepEqual(await empty.readListProjection(), { messageCount: 0, lastMessage: null });
});

for (const [content, title] of [
  ["你好，Noobot", "你好，Noobot"],
  ["1234567890123456789🚀多余内容", "1234567890123456789🚀"],
]) {
  test(`partition session title uses the first user message: ${title}`, async (t) => {
    const { journal, sessionId, root } = await createMessageCase(t, { pageRecords: 1 });
    const repository = openTestMessages(journal, sessionId);
    const userMessage = (messageUid, content) => ({
      ...scope,
      sessionId,
      messageUid,
      userMessageId: messageUid,
      role: "user",
      type: "message",
      messageOrigin: "natural",
      content,
      attachments: [],
      ts: "2026-11-19T00:00:00.000Z",
    });
    for (const entry of [
      message(sessionId, "assistant"),
      userMessage("first", content),
      userMessage("second", "later question"),
    ]) {
      await repository.commit(
        await prepare(journal, repository, entry.messageUid, { messages: [entry] }),
      );
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    await using reader = await openReader(reopened, sessionId);
    assert.equal((await sessionSummaryMethods._buildSessionSummaryFromReader(reader)).title, title);
    assert.equal((await reader.readDisplayProjection()).title, title);
  });
}

for (const content of [
  "",
  '中文\n"\\\ud800',
  "x".repeat(sessionMessagePreviewLimits().chars - 1) + "🚀tail",
  "\u0000".repeat(sessionMessagePreviewLimits().chars + 5),
]) {
  test(`partition list uses the shared preview contract for ${JSON.stringify(content.slice(-12))}`, async (t) => {
    const { journal, sessionId } = await createMessageCase(t);
    const repository = openTestMessages(journal, sessionId);
    await repository.commit(
      await prepare(journal, repository, "create", {
        messages: [{ ...message(sessionId, "last"), content }],
      }),
    );
    await using reader = await openReader(journal, sessionId);
    const { lastMessage } = await reader.readListProjection();
    const chars = sessionMessagePreviewLimits().chars;
    const expected = content.includes("🚀") ? content.slice(0, chars - 1) : content.slice(0, chars);
    assert.equal(lastMessage.content, expected);
    assert.equal(lastMessage.contentTruncated, expected.length < content.length);
  });
}

test("partition list follows append, replacement, deletion and reopen while retained readers stay stable", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  let receipt = (
    await repository.commit(
      await prepare(journal, repository, "create", {
        messages: [{ ...message(sessionId, "first"), content: "" }],
      }),
    )
  ).result.messageReceipts[0];
  await using old = await openReader(journal, sessionId);
  for (const [index, content] of ["prefix", "\ud83d", "\ude80", "tail"].entries()) {
    receipt = (
      await repository.commit(
        await prepare(journal, repository, `append-${index}`, {
          messageContentAppends: [
            {
              ...scope,
              messageUid: "first",
              owner: receipt.owner,
              expectedContentReference: receipt.contentReference,
              content,
            },
          ],
        }),
      )
    ).result.messageReceipts[0];
  }
  await using appended = await openReader(journal, sessionId);
  assert.equal((await appended.readListProjection()).lastMessage.content, "prefix🚀tail");
  await repository.commit(
    await prepare(journal, repository, "replace", {
      messageContentReplacements: [
        {
          ...scope,
          messageUid: "first",
          owner: receipt.owner,
          expectedContentReference: receipt.contentReference,
          content: "replacement",
        },
      ],
    }),
  );
  await repository.commit(
    await prepare(journal, repository, "second", {
      messages: [{ ...message(sessionId, "second"), turnScopeId: "turn-2" }],
    }),
  );
  await repository.commit(
    await prepare(journal, repository, "delete", {
      messageDeletion: { commandId: "delete", anchor: { turnScopeId: "turn-2" } },
    }),
  );
  await using current = await openReader(journal, sessionId);
  assert.equal((await current.readListProjection()).messageCount, 1);
  assert.equal((await current.readListProjection()).lastMessage.content, "replacement");
  assert.equal((await old.readListProjection()).lastMessage.content, "");
  assert.equal((await appended.readListProjection()).lastMessage.content, "prefix🚀tail");
  await old.close();
  await appended.close();
  await current.close();
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await using cold = await openReader(reopened, sessionId);
  assert.equal((await cold.readListProjection()).lastMessage.content, "replacement");
});

for (const initialContent of ["", "x".repeat(2304)]) {
  test(`cold partition list reads a bounded prefix with ${initialContent.length} initial bytes`, async (t) => {
    const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 8192 });
    const repository = openTestMessages(journal, sessionId);
    const content = "x".repeat(2304);
    let receipt = (
      await repository.commit(
        await prepare(journal, repository, "create", {
          messages: [{ ...message(sessionId, "last"), content: initialContent }],
        }),
      )
    ).result.messageReceipts[0];
    for (let index = 0; index < (initialContent.length ? 24 : 25); index += 1) {
      receipt = (
        await repository.commit(
          await prepare(journal, repository, `append-${index}`, {
            messageContentAppends: [
              {
                ...scope,
                messageUid: "last",
                owner: receipt.owner,
                expectedContentReference: receipt.contentReference,
                content,
              },
            ],
          }),
        )
      ).result.messageReceipts[0];
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    await using reader = await openReader(reopened, sessionId);
    const { result, work } = await observeStorageIo(root, () => reader.readListProjection());
    assert.equal(result.lastMessage.content, "x".repeat(sessionMessagePreviewLimits().chars));
    assert.equal(result.lastMessage.contentTruncated, true);
    t.diagnostic(`Cold list with 25 appends: ${work.readBytes} physical bytes`);
    assert.ok(work.readBytes <= 4096, JSON.stringify(Object.fromEntries(work.readBytesByPath)));
  });
}

for (const content of ["", "nonempty body"]) {
  const collection = PARTITION_MESSAGE_COLLECTIONS.content;
  test(`list and byte pages reject deleted authoritative content for ${JSON.stringify(content)}`, async (t) => {
    const { journal, sessionId } = await createMessageCase(t);
    const repository = openTestMessages(journal, sessionId);
    await repository.commit(
      await prepare(journal, repository, "create", {
        messages: [{ ...message(sessionId, "last"), content }],
      }),
    );
    const transactions = new PartitionTransactions(journal);
    const key = partitionMessageEntryKey(PARTITION_MESSAGE_COLLECTIONS.content, "last", 1);
    const entry = await journal.usingSnapshot(async (snapshot) =>
      (await transactions.lookupLatestMany({ snapshot, collection, keys: [key] })).get(key),
    );
    await commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      expectedGeneration: journal.head.sequence,
      sequence: journal.head.sequence + 1,
      operationId: "remove-empty-content-authority",
      input: {},
      mutations: [{ collection, key, owner: entry.owner, remove: true }],
      result: null,
    });
    await using reader = await openReader(journal, sessionId);
    await assert.rejects(reader.readListProjection(), { code: "SESSION_STORAGE_CORRUPT" });
    await assert.rejects(
      reader.readMessageContentPage({
        messageUid: "last",
        byteOffset: 0,
        expectedContentReference: null,
        maxBytes: 2,
      }),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
  });
}
