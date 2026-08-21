/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { harness } from "./session-version-hardening.test-helpers.js";

test("turn summary checkpoint receipts reject stale revisions and are pruned with removed turns", async () => {
  const h = harness({
    messages: [
      {
        messageUid: "sm_1",
        role: "assistant",
        content: "one",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_2",
        role: "assistant",
        content: "two",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
    ],
  });
  await h.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-1",
    summarizedMessageUids: ["sm_1"],
  });
  await assert.rejects(
    h.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-2",
      expectedCheckpointRevision: 0,
      summarizedMessageUids: ["sm_2"],
    }),
    (error) =>
      error.code === "TURN_SUMMARY_CHECKPOINT_REVISION_CONFLICT" &&
      error.currentCheckpointRevision === 1,
  );
  await assert.rejects(
    h.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-1",
      summarizedMessageUids: ["sm_2"],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_ID_REUSED",
  );

  const normalized = normalizeSessionEntity(
    {
      ...h.get(),
      messages: [],
    },
    { now: () => "2026-01-01T00:00:00.000Z" },
  );
  assert.equal(normalized.turnSummaryCheckpoints, undefined);
});

test("attachment binding rejects placeholders and cross-session injection after Turn commit", async (t) => {
  const invalid = [
    { sessionId: "s1", path: "/workspace/a" },
    { attachmentId: "a", sessionId: "other", path: "/workspace/a" },
    { attachmentId: "a", sessionId: "s1" },
  ];
  for (const [index, attachment] of invalid.entries()) {
    await t.test(String(index), async () => {
      const h = harness();
      const committed = await h.service.commitTurn({
        userId: "u1",
        sessionId: "s1",
        content: "x",
        turnScopeId: `t${index}`,
        commandId: `i${index}`,
      });
      await assert.rejects(
        h.service.bindTurnAttachments({
          userId: "u1",
          sessionId: "s1",
          turnScopeId: `t${index}`,
          messageUid: committed.userMessage.messageUid,
          commandId: `i${index}:attachments.bind`,
          expectedAggregateVersion: 1,
          attachments: [attachment],
        }),
        (e) => e.errorCode === "INVALID_CANONICAL_ATTACHMENT",
      );
      assert.equal(h.get().messages.length, 1);
      assert.deepEqual(h.get().messages[0].attachments || [], []);
    });
  }
});

test("deleteFromMessage replays a committed receipt without deleting again", async () => {
  const h = harness({
    aggregateVersion: 2,
    messages: [
      { role: "user", content: "keep", turnScopeId: "keep" },
      { role: "user", content: "delete", turnScopeId: "delete" },
    ],
  });
  const input = {
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "delete" },
    expectedAggregateVersion: 2,
    commandId: "delete-once",
  };
  const committed = await h.service.deleteFromMessage(input);
  await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "later",
    turnScopeId: "later",
    commandId: "later",
    expectedAggregateVersion: 3,
  });
  const replay = await h.service.deleteFromMessage(input);
  assert.equal(committed.aggregateVersion, 3);
  assert.equal(replay.aggregateVersion, 4);
  assert.equal(replay.committedAggregateVersion, 3);
  assert.equal(replay.session.aggregateVersion, replay.aggregateVersion);
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(replay.deletedCount, committed.deletedCount);
  assert.equal(h.get().messages.length, 2);
});

test("replaceTurn replays a committed receipt after the original anchor is gone", async () => {
  const h = harness({
    aggregateVersion: 4,
    messages: [{ role: "user", content: "old", turnScopeId: "old" }],
  });
  const input = {
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "old" },
    newContent: "new",
    turnScopeId: "replacement",
    expectedAggregateVersion: 4,
    commandId: "replace-once",
  };
  const committed = await h.service.replaceTurn(input);
  const replay = await h.service.replaceTurn(input);
  assert.equal(committed.session.aggregateVersion, 5);
  assert.equal(replay.session.aggregateVersion, 5);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.turnReplacement.replacementTurnScopeId, "replacement");
  assert.equal(
    replay.turnReplacement.replacementDialogProcessId,
    committed.turnReplacement.replacementDialogProcessId,
  );
  assert.equal(replay.turnReplacement.commandId, "replace-once");
  assert.deepEqual(
    h.get().messages.map((message) => message.content),
    ["new"],
  );
});

test("idempotency keys reject reuse with a different request", async () => {
  const send = harness();
  await send.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "one",
    turnScopeId: "t1",
    commandId: "same",
  });
  await assert.rejects(
    send.service.commitTurn({
      userId: "u1",
      sessionId: "s1",
      content: "different",
      turnScopeId: "t2",
      commandId: "same",
    }),
    (error) => error.errorCode === "SESSION_IDEMPOTENCY_KEY_REUSED",
  );

  const replace = harness({
    messages: [{ role: "user", content: "old", turnScopeId: "old" }],
  });
  await replace.service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "old" },
    newContent: "new",
    turnScopeId: "new",
    commandId: "replace-key",
  });
  await assert.rejects(
    replace.service.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "other" },
      newContent: "other",
      turnScopeId: "other-new",
      commandId: "replace-key",
    }),
    (error) => error.errorCode === "SESSION_IDEMPOTENCY_KEY_REUSED",
  );
});
