/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { sessionSummaryMethods } from "../../src/session/repositories/file-system-session-repository/summary-methods.js";
import {
  createMessageCase,
  committedAt,
  openTestMessages,
  prepare,
  message,
} from "./partition-session-messages.test-helpers.js";

function userMessage(sessionId, messageUid, turn, content) {
  return {
    sessionId,
    messageUid,
    type: "message",
    attachments: [],
    ts: committedAt,
    role: "user",
    userMessageId: messageUid,
    messageOrigin: "natural",
    dialogProcessId: `dialog-${turn}`,
    turnScopeId: `turn-${turn}`,
    content,
  };
}

async function assertTitle(reader, autoTitle, customTitle) {
  const metadata = await reader.readMetadata({ includeAutoTitle: true });
  assert.equal(metadata.autoTitle, autoTitle);
  assert.equal(metadata.customTitle, customTitle);
  const title = customTitle || autoTitle;
  if (title) {
    assert.equal((await reader.readDisplayProjection()).title, title);
    assert.equal((await sessionSummaryMethods._buildSessionSummaryFromReader(reader)).title, title);
  }
  assert.equal((await reader.exportSession()).autoTitle, autoTitle);
}

test("title follows committed replacement and deletion while retained snapshots and custom titles stay stable", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const commit = async (operationId, changes) => {
    const result = await repository.commit(
      await prepare(journal, repository, operationId, changes),
    );
    assert.equal(result.status, "committed");
    return result;
  };
  const open = (journal) => openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  await commit("seed", {
    messages: [
      userMessage(sessionId, "first", 1, "original"),
      userMessage(sessionId, "second", 2, "later"),
    ],
    sessionMetadata: { customTitle: "custom" },
  });
  await using original = await open(journal);
  await assertTitle(original, "original", "custom");
  await commit("replace", {
    turnReplacement: {
      command: {
        commandId: "replace",
        anchor: { turnScopeId: "turn-1" },
        turnScopeId: "turn-3",
        newContent: "edited",
        attachments: [],
      },
      identity: { dialogProcessId: "dialog-3", messageUid: "edited", userMessageId: "edited-user" },
    },
  });
  await using edited = await open(journal);
  await assertTitle(edited, "edited", "custom");
  await assertTitle(original, "original", "custom");
  await commit("delete", {
    messageDeletion: { commandId: "delete", anchor: { turnScopeId: "turn-3" } },
  });
  await using deleted = await open(journal);
  await assertTitle(deleted, undefined, "custom");
  await assertTitle(edited, "edited", "custom");
  await deleted.close();
  await edited.close();
  await original.close();
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await using cold = await open(reopened);
  await assertTitle(cold, undefined, "custom");
});

test("an initially empty user message derives its title from each committed content version", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const entry = userMessage(sessionId, "first", 1, "");
  const commit = async (operationId, changes) => {
    const result = await repository.commit(
      await prepare(journal, repository, operationId, changes),
    );
    assert.equal(result.status, "committed");
    return result.result.messageReceipts[0];
  };
  let receipt = await commit("empty", { messages: [entry] });
  await using empty = await openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  await assertTitle(empty, undefined, undefined);
  for (const [index, content] of ["first prefix", " later suffix"].entries()) {
    receipt = await commit(`append-${index}`, {
      messageContentAppends: [
        {
          dialogProcessId: entry.dialogProcessId,
          turnScopeId: entry.turnScopeId,
          messageUid: entry.messageUid,
          owner: receipt.owner,
          expectedContentReference: receipt.contentReference,
          content,
        },
      ],
    });
    await using current = await openPartitionSessionReader({
      journal,
      sessionId,
      parentSessionId: "",
    });
    await assertTitle(current, index === 0 ? "first prefix" : "first prefix later s", undefined);
    await journal.usingSnapshot(async (snapshot) => {
      assert.equal(Object.hasOwn(await repository.readMetadata({ snapshot }), "autoTitle"), false);
    });
  }
  await assertTitle(empty, undefined, undefined);
});

for (const count of [10, 200]) {
  test(`cold metadata title reads no message history with ${count} unrelated messages`, async (t) => {
    const { journal, root, sessionId } = await createMessageCase(t);
    const repository = openTestMessages(journal, sessionId);
    for (let index = 0; index < count; index++) {
      const result = await repository.commit(
        await prepare(journal, repository, `seed-${index}`, {
          messages: [message(sessionId, `assistant-${index}`)],
        }),
      );
      assert.equal(result.status, "committed");
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const withCollectionReader = PartitionTransactions.prototype.withCollectionReader;
    const collections = [];
    t.mock.method(
      PartitionTransactions.prototype,
      "withCollectionReader",
      function (snapshot, run, options) {
        return withCollectionReader.call(
          this,
          snapshot,
          (read) =>
            run((query) => {
              collections.push(query.collection);
              assert.equal(query.collection, "metadata");
              for (const key of query.keys)
                assert.ok(key === "session" || key === "titleCandidates:");
              return read(query);
            }),
          options,
        );
      },
    );
    await using reader = await openPartitionSessionReader({
      journal: reopened,
      sessionId,
      parentSessionId: "",
    });
    assert.equal((await reader.readMetadata({ includeAutoTitle: true })).autoTitle, undefined);
    assert.ok(collections.length <= 3, "title lookup must have a fixed metadata read budget");
  });
}
