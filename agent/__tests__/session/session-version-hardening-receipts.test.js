/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { pruneTurnSummaryCheckpoints } from "@noobot/context-protocol/policy/summary";
import { acceptTurn, harness } from "./session-version-hardening.test-helpers.js";
import {
  immutableMutationFixture,
  mutationMessage,
} from "../helpers/immutable-mutation-integration-fixture.js";

test("turn summary checkpoint receipts reject stale revisions and are pruned with removed turns", async () => {
  const h = await harness({
    messages: [
      {
        attachments: [],
        messageUid: "sm_1",
        sessionId: "s1",
        ts: "2026-01-01T00:00:00.000Z",
        modelMessageId: "model-1",
        presentationMessageId: "message-t",
        role: "assistant",
        content: "one",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        attachments: [],
        messageUid: "sm_2",
        sessionId: "s1",
        ts: "2026-01-01T00:00:00.000Z",
        modelMessageId: "model-2",
        presentationMessageId: "message-t",
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
    messages: [],
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
      messages: [],
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
      messages: [],
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
      const h = await harness();
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

test("deleteFromMessage replays a committed receipt without deleting again", async (t) => {
  const h = await immutableMutationFixture(t, {
    aggregateVersion: 2,
    messages: [mutationMessage("keep"), mutationMessage("delete")],
  });
  const input = {
    ...h.request,
    anchor: { turnScopeId: "delete" },
    expectedAggregateVersion: 2,
    commandId: "delete-once",
  };
  const committed = await h.service.deleteFromMessage(input);
  await acceptTurn(h.service, { ...h.request, turnScopeId: "later", expectedAggregateVersion: 3 });
  const beforeReplay = await h.open();
  const replay = await h.service.deleteFromMessage(input);
  assert.equal(committed.committedAggregateVersion, 3);
  assert.equal(committed.deduplicated, false);
  assert.equal(replay.committedAggregateVersion, 3);
  assert.equal(replay.generation, beforeReplay.generation);
  assert.deepEqual(replay.projection, committed.projection);
  assert.equal(replay.projection.receipt.aggregateVersion, 3);
  assert.equal(Object.hasOwn(replay, "detail"), false);
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(replay.deletedCount, committed.deletedCount);
  const afterReplay = await h.open();
  assert.equal(afterReplay.generation, beforeReplay.generation);
  assert.equal((await afterReplay.readMetadata()).aggregateVersion, 4);
  assert.equal((await afterReplay.readFacts()).messageCount, 2);
});

test("replaceTurn replays a committed receipt after the original anchor is gone", async (t) => {
  const h = await immutableMutationFixture(t, {
    aggregateVersion: 4,
    messages: [mutationMessage("old")],
  });
  const input = {
    ...h.request,
    anchor: { turnScopeId: "old" },
    newContent: "new",
    attachments: [],
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
    (await (await h.open()).exportSession()).messages.map((message) => message.content),
    ["new"],
  );
});

test("replaceTurn idempotency keys reject reuse with a different request", async (t) => {
  const replace = await immutableMutationFixture(t, {
    messages: [mutationMessage("old")],
  });
  await replace.service.replaceTurn({
    attachments: [],
    ...replace.request,
    anchor: { turnScopeId: "old" },
    newContent: "new",
    turnScopeId: "new",
    commandId: "replace-key",
  });
  await assert.rejects(
    replace.service.replaceTurn({
      attachments: [],
      ...replace.request,
      anchor: { turnScopeId: "other" },
      newContent: "other",
      turnScopeId: "other-new",
      commandId: "replace-key",
    }),
    (error) => error.code === "SESSION_IDEMPOTENCY_KEY_REUSED",
  );
});

test("user_meta parsed results attach only to an existing user source message", async () => {
  const h = await harness({
    messages: [
      {
        attachments: [],
        messageUid: "sm_u",
        sessionId: "s1",
        ts: "2026-01-01T00:00:00.000Z",
        role: "user",
        messageOrigin: "natural",
        content: "q",
        turnScopeId: "t",
        dialogProcessId: "dp",
      },
      {
        attachments: [],
        messageUid: "sm_a",
        sessionId: "s1",
        ts: "2026-01-01T00:00:00.000Z",
        modelMessageId: "model-a",
        presentationMessageId: "message-t",
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
