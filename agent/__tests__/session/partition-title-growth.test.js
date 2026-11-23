/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import {
  committedAt,
  createMessageCase,
  openTestMessages,
  prepare,
  message,
} from "./partition-session-messages.test-helpers.js";

function userMessage(sessionId, id, turn, content) {
  return {
    sessionId,
    messageUid: id,
    userMessageId: id,
    dialogProcessId: `dialog-${turn}`,
    turnScopeId: `turn-${turn}`,
    type: "message",
    role: "user",
    messageOrigin: "natural",
    content,
    attachments: [],
    ts: committedAt,
  };
}

for (const count of [10, 200]) {
  test(`title reselects one candidate after replacement with ${count} retained unrelated messages`, async (t) => {
    const { journal, root, sessionId } = await createMessageCase(t);
    const repository = openTestMessages(journal, sessionId);
    const commit = async (operationId, changes) => {
      const outcome = await repository.commit(
        await prepare(journal, repository, operationId, changes),
      );
      assert.equal(outcome.status, "committed");
    };
    await commit("anchor", { messages: [userMessage(sessionId, "anchor", 1, "   ")] });
    for (let index = 0; index < count; index++)
      await commit(`assistant-${index}`, { messages: [message(sessionId, `assistant-${index}`)] });
    await commit("tail", { messages: [userMessage(sessionId, "tail", 2, "original")] });
    await commit("replace", {
      turnReplacement: {
        command: {
          commandId: "replace",
          anchor: { turnScopeId: "turn-2" },
          turnScopeId: "turn-3",
          newContent: "replacement",
          attachments: [],
        },
        identity: {
          dialogProcessId: "dialog-3",
          messageUid: "edited",
          userMessageId: "edited-user",
        },
      },
    });
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const withCollectionReader = PartitionTransactions.prototype.withCollectionReader;
    const messageKeys = [];
    t.mock.method(
      PartitionTransactions.prototype,
      "withCollectionReader",
      function (snapshot, run, options) {
        return withCollectionReader.call(
          this,
          snapshot,
          (read) =>
            run((query) => {
              if (query.collection === PARTITION_MESSAGE_COLLECTIONS.messages)
                messageKeys.push(...query.keys);
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
    assert.equal((await reader.readMetadata({ includeAutoTitle: true })).autoTitle, "replacement");
    assert.deepEqual(
      messageKeys,
      ["edited"],
      "title selection must read only its indexed visible candidate",
    );
  });
}
