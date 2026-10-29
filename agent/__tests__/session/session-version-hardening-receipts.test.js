/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { pruneTurnSummaryCheckpoints } from "@noobot/context-protocol/policy/summary";
import { acceptTurn, harness } from "./session-version-hardening.test-helpers.js";

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
    expectedCheckpointRevision: 0,
    persistedMessageUids: [],
    retainedMessageUids: [],
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
      persistedMessageUids: [],
      retainedMessageUids: [],
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
      expectedCheckpointRevision: 1,
      persistedMessageUids: [],
      retainedMessageUids: [],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_ID_REUSED",
  );

  assert.deepEqual(pruneTurnSummaryCheckpoints(h.get().turnSummaryCheckpoints, []), {});
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
      const committed = await acceptTurn(h.service, { turnScopeId: `t${index}` });
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
        (e) => e.code === "INVALID_CANONICAL_ATTACHMENT",
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
      { role: "user", messageOrigin: "natural", content: "keep", turnScopeId: "keep" },
      { role: "user", messageOrigin: "natural", content: "delete", turnScopeId: "delete" },
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
  await acceptTurn(h.service, { turnScopeId: "later", expectedAggregateVersion: 3 });
  const replay = await h.service.deleteFromMessage(input);
  assert.equal(committed.committedAggregateVersion, 3);
  assert.equal(committed.deduplicated, false);
  assert.equal(replay.committedAggregateVersion, 3);
  assert.equal(replay.detail.sessions[0].aggregateVersion, 4);
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(replay.deletedCount, committed.deletedCount);
  assert.equal(h.get().messages.length, 2);
});

test("replaceTurn replays a committed receipt after the original anchor is gone", async () => {
  const h = harness({
    aggregateVersion: 4,
    messages: [
      {
        sessionId: "s1",
        role: "user",
        messageOrigin: "natural",
        content: "old",
        turnScopeId: "old",
      },
    ],
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
  assert.equal(committed.committedAggregateVersion, 5);
  assert.equal(replay.committedAggregateVersion, 5);
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

test("replaceTurn idempotency keys reject reuse with a different request", async () => {
  const replace = harness({
    messages: [
      {
        sessionId: "s1",
        role: "user",
        messageOrigin: "natural",
        content: "old",
        turnScopeId: "old",
      },
    ],
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
    (error) => error.code === "SESSION_IDEMPOTENCY_KEY_REUSED",
  );
});

test("user_meta parsed results attach only to an existing user source message", async () => {
  const h = harness({
    messages: [
      {
        messageUid: "sm_u",
        role: "user",
        messageOrigin: "natural",
        content: "q",
        turnScopeId: "t",
        dialogProcessId: "dp",
      },
      {
        messageUid: "sm_a",
        role: "assistant",
        content: "a",
        turnScopeId: "t",
        dialogProcessId: "dp",
      },
    ],
  });
  const record = (userMetaSourceMessageUid) =>
    h.service.recordUserMetaParsedResult({
      userId: "u1",
      sessionId: "s1",
      userMetaSourceMessageUid,
      result: { attachmentId: "att-1", content: "parsed" },
    });
  await assert.rejects(
    record("sm_missing"),
    (error) => error.code === "USER_META_SOURCE_NOT_FOUND",
  );
  await assert.rejects(record("sm_a"), (error) => error.code === "USER_META_SOURCE_ROLE_CONFLICT");
  assert.equal(
    h.get().messages.some((message) => "userMetaParsedResults" in message),
    false,
  );
});
