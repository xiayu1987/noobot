/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

function declaration(sessionId) {
  return {
    ...message(sessionId, "call"),
    type: "tool_call",
    tool_calls: [
      { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
    ],
  };
}

function result(sessionId, messageUid) {
  const { modelMessageId: _model, ...record } = message(sessionId, messageUid);
  return { ...record, role: "tool", type: "tool_result", tool_call_id: "call-1" };
}

function checkpoint(sessionId, checkpointId, summarizedMessageUids) {
  return {
    ...scope,
    sessionId,
    userId: "admin",
    checkpointId,
    expectedCheckpointRevision: 0,
    messages: [],
    persistedMessageUids: [],
    summarizedMessageUids,
    retainedMessageUids: [],
  };
}

function deletionAnchor(sessionId) {
  return { ...message(sessionId, "deletion-anchor"), turnScopeId: "delete-turn" };
}

async function truncate(journal, repository) {
  const deleted = await repository.commit(
    await prepare(journal, repository, "truncate", {
      messageDeletion: { commandId: "truncate", anchor: { turnScopeId: "delete-turn" } },
    }),
  );
  assert.equal(deleted.result.messageDeletion.receipt.result.deletedCount, 2);
}

for (const reuse of [false, true]) {
  test(`checkpoint excludes hidden tool results after cold reopen (reuse=${reuse})`, async (t) => {
    const { journal, sessionId, root } = await createMessageCase(t, {
      transactionBytes: 16 * 1024,
      partitionRecords: 1,
    });
    const repository = openTestMessages(journal, sessionId);
    await repository.commit(
      await prepare(journal, repository, "seed", {
        messages: [
          declaration(sessionId),
          result(sessionId, "visible-result"),
          deletionAnchor(sessionId),
          result(sessionId, "hidden-result"),
        ],
      }),
    );
    await journal.usingSnapshot(async (snapshot) => {
      await truncate(journal, repository);
      if (reuse)
        await repository.commit(
          await prepare(journal, repository, "reuse", {
            messages: [{ ...message(sessionId, "other"), turnScopeId: "other-turn" }],
          }),
        );
      const page = await repository.readTurnPage({ snapshot, ...scope, cursor: null, limit: 4 });
      assert.deepEqual(
        page.entries.map(({ message }) => message.messageUid),
        ["call", "visible-result", "hidden-result"],
      );
    });
    await journal.close();
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    const reader = openTestMessages(cold, sessionId);
    const request = await prepare(cold, reader, "summary", {
      summaryCheckpoints: [checkpoint(sessionId, "summary", ["call", "visible-result"])],
    });
    const committed = await reader.commit(request);
    assert.equal(committed.result.summaryCheckpoints[0].markedCount, 2);
    assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
  });
}

test("appending a tool result replaces the hidden result position in the same checkpoint transaction", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, {
    transactionBytes: 16 * 1024,
    partitionRecords: 1,
  });
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "seed", {
      messages: [
        declaration(sessionId),
        deletionAnchor(sessionId),
        result(sessionId, "old-result"),
      ],
    }),
  );
  await truncate(journal, repository);
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = openTestMessages(cold, sessionId);
  const fresh = result(sessionId, "new-result");
  const committed = await reader.commit(
    await prepare(cold, reader, "replace-result", {
      messages: [fresh],
      summaryCheckpoints: [
        {
          ...checkpoint(sessionId, "summary", ["call", "new-result"]),
          messages: [fresh],
          persistedMessageUids: ["new-result"],
        },
      ],
    }),
  );
  assert.equal(committed.result.summaryCheckpoints[0].markedCount, 2);
});
