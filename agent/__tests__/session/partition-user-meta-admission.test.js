/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  committedAt,
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

for (const [name, invalid] of [
  ["missing source", { result: { sourceAttachmentRef: "attach://source" } }],
  ["noncanonical source", { messageUid: " source ", result: {} }],
  ["missing attachment reference", { messageUid: "source", result: {} }],
  ["empty attachment reference", { messageUid: "source", result: { sourceAttachmentRef: " " } }],
  ["nontext attachment reference", { messageUid: "source", result: { sourceAttachmentRef: 1 } }],
]) {
  test(`partition user meta rejects ${name} without terminating its writer or batch`, async (t) => {
    const { journal, root, sessionId } = await createMessageCase(t, { batchWaitMs: 20 });
    const repository = openTestMessages(journal, sessionId);
    await repository.commit(
      await prepare(journal, repository, "source", {
        messages: [
          {
            ...scope,
            sessionId,
            messageUid: "source",
            role: "user",
            messageOrigin: "natural",
            type: "message",
            content: "source",
            attachments: [],
            ts: committedAt,
          },
        ],
      }),
    );
    const { last, outcome, result } = await journal.usingSnapshot(async (old) => {
      const request = (offset, operationId, changes) => ({
        epoch: old.epoch,
        expectedGeneration: old.sequence + offset,
        operationId,
        input: { committedAt, changes },
      });
      const result = { sourceAttachmentRef: "attach://source", summary: "parsed" };
      const first = request(0, "before-invalid", { messages: [message(sessionId, "before")] });
      const rejected = request(1, "invalid", { userMetaParsedResult: invalid });
      const last = request(1, "after-invalid", {
        userMetaParsedResult: { messageUid: "source", result },
      });
      const outcomes = await Promise.allSettled(
        [first, rejected, last].map((item) => repository.commit(item)),
      );
      assert.deepEqual(
        outcomes.map(({ status }) => status),
        ["fulfilled", "rejected", "fulfilled"],
        outcomes.map(({ reason }) => reason?.stack).join("\n"),
      );
      assert.equal(outcomes[1].reason.code, "SESSION_COMMIT_INPUT_INVALID");
      assert.equal(journal.head.sequence, old.sequence + 2);
      const retained = await repository.readTurnPage({
        snapshot: old,
        ...scope,
        cursor: null,
        limit: 4,
      });
      assert.deepEqual(
        retained.entries.map(({ message }) => message.messageUid),
        ["source"],
      );
      assert.equal(retained.entries[0].message.userMetaParsedResults, undefined);
      assert.deepEqual(outcomes[2].value.result, {
        userMetaParsedResult: { userMetaParsedResults: [result] },
      });
      return { last, outcome: outcomes[2].value, result };
    });
    await journal.close();
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    const reader = openTestMessages(cold, sessionId);
    assert.deepEqual(await reader.commit(last), { ...outcome, replayed: true });
    await cold.usingSnapshot(async (snapshot) => {
      const page = await reader.readTurnPage({ snapshot, ...scope, cursor: null, limit: 4 });
      assert.deepEqual(
        page.entries.map(({ message }) => message.messageUid),
        ["source", "before"],
      );
      assert.deepEqual(page.entries[0].message.userMetaParsedResults, [result]);
    });
  });
}
