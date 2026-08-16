/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";

function harness(initial = {}) {
  let session = structuredClone({
    sessionId: "s1",
    parentSessionId: "",
    aggregateVersion: 0,
    messages: [],
    turnLifecycle: { turns: {}, commandReceipts: [] },
    ...initial,
  });
  let lockCalls = 0;
  const repo = {
    async withSessionMutation(_u, _s, _p, operation) {
      lockCalls += 1;
      return operation();
    },
    async resolveParentSessionId() {
      return "";
    },
    async ensureSession() {},
    async findById() {
      return structuredClone(session);
    },
    async save(_u, next, _p, { expectedAggregateVersion } = {}) {
      const actual = Number(session.aggregateVersion ?? 0);
      if (expectedAggregateVersion != null && Number(expectedAggregateVersion) !== actual) {
        const error = new Error("session version conflict");
        error.statusCode = 409;
        error.errorCode = "SESSION_AGGREGATE_VERSION_CONFLICT";
        error.currentVersion = actual;
        throw error;
      }
      session = structuredClone(next);
    },
  };
  return {
    service: new SessionMessageService({
      repo,
      sessionRepo: repo,
      now: () => "2026-01-01T00:00:00.000Z",
      allocateDialogProcessId: () => "dialog-replacement",
    }),
    get: () => structuredClone(session),
    locks: () => lockCalls,
  };
}

const canonical = (id = "a1") => ({
  attachmentId: id,
  sessionId: "s1",
  attachmentSource: "user",
  name: `${id}.docx`,
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: 321,
  path: `/workspace/${id}.docx`,
  relations: [
    {
      relationType: "parsed_result",
      sourceIdentity: { attachmentId: id, sessionId: "s1", attachmentSource: "user" },
      targetIdentity: { attachmentId: `${id}-parsed`, sessionId: "s1", attachmentSource: "model" },
      mimeType: "text/markdown",
      createdAt: "2026-08-16T00:00:00.000Z",
    },
  ],
});

test("commitTurn increments structural version and preserves canonical attachment round-trip", async () => {
  const h = harness();
  const first = await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "one",
    turnScopeId: "t1",
    commandId: "i1",
    expectedAggregateVersion: 0,
    attachments: [canonical()],
  });
  const second = await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "two",
    turnScopeId: "t2",
    commandId: "i2",
    expectedAggregateVersion: 1,
  });
  assert.equal(first.aggregateVersion, 1);
  assert.equal(second.aggregateVersion, 2);
  assert.equal(h.get().aggregateVersion, 2);
  assert.deepEqual(first.attachments, [canonical()]);
});

test("commitTurn persists the preallocated user message identity", async () => {
  const h = harness();
  const result = await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "hello",
    turnScopeId: "t1",
    commandId: "i1",
    messageId: "msg_user-1",
  });

  assert.equal(result.userMessage.id, "msg_user-1");
  assert.equal(result.userMessage.messageId, "msg_user-1");
  assert.equal(h.get().messages[0].messageId, "msg_user-1");
});

test("commitTurn persists internal run origin without frontend user identity", async () => {
  const h = harness();
  const result = await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "internal task",
    turnScopeId: "internal-turn:1",
    commandId: "internal-turn:1",
    frontendUserMessage: false,
  });
  assert.equal(result.userMessage.frontendUserMessage, undefined);
  assert.equal(result.userMessage.messageOrigin, "internal");
});

test("commitTurn assigns an immutable logical dialog ordinal", async () => {
  const h = harness();
  await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "first",
    turnScopeId: "t1",
    dialogProcessId: "d1",
    commandId: "i1",
  });
  await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "second",
    turnScopeId: "t2",
    dialogProcessId: "d2",
    commandId: "i2",
  });

  assert.deepEqual(
    h.get().dialogOrder.map(({ dialogProcessId, dialogOrdinal }) => ({
      dialogProcessId,
      dialogOrdinal,
    })),
    [
      { dialogProcessId: "d1", dialogOrdinal: 1 },
      { dialogProcessId: "d2", dialogOrdinal: 2 },
    ],
  );
  assert.equal(
    h.get().dialogOrder.some((entry) => "sequence" in entry),
    false,
  );
  assert.equal(new Set(h.get().messages.map((message) => message.messageUid)).size, 2);
  assert.equal(
    h.get().messages.every((message) => /^sm_/.test(message.messageUid)),
    true,
  );
});

test("dialog order accepts only canonical dialogOrdinal and messageUid fields", () => {
  const normalized = normalizeSessionEntity(
    {
      sessionId: "s1",
      messages: [
        {
          role: "user",
          content: "legacy",
          dialogProcessId: "d1",
          turnScopeId: "t1",
          messageUid: "sm_m1",
          messageId: "m1",
          ts: "2026-01-01T00:00:00.000Z",
        },
      ],
      dialogOrder: [{ dialogProcessId: "d1", dialogOrdinal: 7 }],
    },
    { now: () => "2026-01-01T00:00:00.000Z" },
  );

  assert.deepEqual(
    normalized.dialogOrder.map(({ userMessageUid, ...entry }) => entry),
    [
      {
        dialogProcessId: "d1",
        turnScopeId: "t1",
        startedAt: "2026-01-01T00:00:00.000Z",
        dialogOrdinal: 7,
      },
    ],
  );
  assert.equal(normalized.dialogOrder[0].userMessageUid, normalized.messages[0].messageUid);
  assert.equal("userMessageId" in normalized.dialogOrder[0], false);
  assert.equal("sequence" in normalized.dialogOrder[0], false);
});

test("messages without a persistent messageUid are rejected", () => {
  const invalid = {
    sessionId: "s1",
    messages: [
      {
        role: "assistant",
        content: "legacy",
        messageId: "am_1",
        dialogProcessId: "d1",
        turnScopeId: "t1",
        ts: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  assert.throws(
    () => normalizeSessionEntity(invalid, { now: () => "2026-01-01T00:00:00.000Z" }),
    /invalid session aggregate: missing_message_uid/,
  );
});

test("same idempotency identity wins before stale version check", async () => {
  const h = harness();
  const input = {
    userId: "u1",
    sessionId: "s1",
    content: "one",
    turnScopeId: "t1",
    commandId: "i1",
    expectedAggregateVersion: 0,
    attachments: [canonical()],
  };
  const committed = await h.service.commitTurn(input);
  const replay = await h.service.commitTurn({ ...input, expectedAggregateVersion: 0 });
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.aggregateVersion, committed.aggregateVersion);
  assert.equal(h.get().messages.filter((m) => m.role === "user").length, 1);
  assert.deepEqual(replay.attachments, committed.attachments);
});

test("different identity with stale version receives canonical conflict", async () => {
  const h = harness({ aggregateVersion: 3 });
  await assert.rejects(
    h.service.commitTurn({
      userId: "u1",
      sessionId: "s1",
      content: "x",
      turnScopeId: "t",
      commandId: "i",
      expectedAggregateVersion: 2,
    }),
    (e) =>
      e.statusCode === 409 &&
      e.errorCode === "SESSION_AGGREGATE_VERSION_CONFLICT" &&
      e.currentVersion === 3,
  );
});

test("expectedAggregateVersion accepts only missing or non-negative safe integers", async (t) => {
  for (const value of [-1, 1.2, NaN, Infinity, "nope", "1.2", Number.MAX_SAFE_INTEGER + 1]) {
    await t.test(String(value), async () => {
      const h = harness();
      await assert.rejects(
        h.service.commitTurn({
          userId: "u1",
          sessionId: "s1",
          content: "x",
          turnScopeId: `t-${value}`,
          commandId: `i-${value}`,
          expectedAggregateVersion: value,
        }),
        (e) => e.statusCode === 400 && e.errorCode === "INVALID_SESSION_AGGREGATE_VERSION",
      );
    });
  }
  const absent = harness();
  assert.equal(
    (
      await absent.service.commitTurn({
        userId: "u1",
        sessionId: "s1",
        content: "x",
        turnScopeId: "ta",
        commandId: "ia",
      })
    ).aggregateVersion,
    1,
  );
  const stringZero = harness();
  await assert.rejects(
    stringZero.service.commitTurn({
      userId: "u1",
      sessionId: "s1",
      content: "x",
      turnScopeId: "tz",
      commandId: "iz",
      expectedAggregateVersion: "0",
    }),
    (error) => error.errorCode === "INVALID_SESSION_AGGREGATE_VERSION",
  );
});

test("continue identity round-trips only when it matches the authoritative continuation relation", async () => {
  const h = harness({
    aggregateVersion: 4,
    messages: [{ role: "user", content: "old", turnScopeId: "old", dialogProcessId: "dp-old" }],
    turnLifecycle: {
      sequence: 6,
      activeTurnScopeId: "new",
      turns: {
        old: {
          turnScopeId: "old",
          dialogProcessId: "dp-old",
          state: "stop_completed",
          executionState: "user_stopped",
          continuedByTurnScopeId: "new",
          revision: 5,
          sequence: 5,
        },
        new: {
          turnScopeId: "new",
          dialogProcessId: "dp-new",
          action: "continue",
          state: "action_requesting",
          continuationSource: { turnScopeId: "old", dialogProcessId: "dp-old" },
          revision: 1,
          sequence: 6,
        },
      },
    },
  });
  const result = await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    action: "continue",
    content: "continue",
    turnScopeId: "new",
    dialogProcessId: "dp-new",
    commandId: "continue-1",
    expectedAggregateVersion: 4,
    resumeTurnScopeId: "old",
    resumeDialogProcessId: "dp-old",
    attachments: [canonical("continued")],
  });
  assert.equal(result.userMessage.turnCommit.resumeTurnScopeId, "old");
  assert.equal(result.userMessage.turnCommit.resumeDialogProcessId, "dp-old");
  await assert.rejects(
    h.service.commitTurn({
      userId: "u1",
      sessionId: "s1",
      action: "continue",
      content: "again",
      turnScopeId: "new2",
      commandId: "continue-2",
      expectedAggregateVersion: 5,
      resumeTurnScopeId: "old",
      resumeDialogProcessId: "dp-old",
    }),
    (error) => error.errorCode === "SESSION_CONTINUE_AUTHORITY_MISMATCH",
  );
});

test("internal append and summary checkpoint use mutation lock without changing public version", async () => {
  const h = harness({
    aggregateVersion: 7,
    messages: [
      { messageUid: "sm_q", role: "user", content: "q", turnScopeId: "t", dialogProcessId: "dp" },
      {
        messageUid: "sm_old",
        role: "user",
        content: "historical",
        turnScopeId: "old",
        dialogProcessId: "dp-old",
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: "t",
      turns: { t: { turnScopeId: "t", dialogProcessId: "dp", state: "processing" } },
    },
  });
  await h.service.appendTurn({
    userId: "u1",
    sessionId: "s1",
    role: "assistant",
    content: "a",
    turnScopeId: "t",
    dialogProcessId: "dp",
  });
  const targetUid = h.get().messages.find((message) => message.content === "a").messageUid;
  await h.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-lock",
    summarizedMessageUids: [targetUid],
  });
  assert.equal(h.get().aggregateVersion, 7);
  assert.equal(h.get().messages.find((m) => m.messageUid === targetUid).summarized, true);
  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_q").summarized, undefined);
  assert.equal(h.get().messages.find((m) => m.dialogProcessId === "dp-old").summarized, undefined);
  assert.equal(h.locks(), 2);
});

test("summary checkpoint without complete transaction identity fails closed", async () => {
  const h = harness({
    messages: [
      { messageUid: "sm_old", role: "user", content: "historical", dialogProcessId: "dp-old" },
    ],
  });

  const result = await h.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    checkpointId: "cp-missing-scope",
    summarizedMessageUids: ["sm_old"],
  });

  assert.equal(result.committed, false);
  assert.equal(result.reason, "missing_checkpoint_identity");
  assert.equal(h.get().messages[0].summarized, undefined);
  assert.equal(h.locks(), 0);
});

test("turn summary checkpoints mark exact UIDs and persist an idempotent scoped receipt", async () => {
  const h = harness({
    messages: [
      {
        messageUid: "sm_target",
        role: "assistant",
        content: "same",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_keep",
        role: "assistant",
        content: "same",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_history",
        role: "assistant",
        content: "same",
        dialogProcessId: "old",
        turnScopeId: "old-t",
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: "t",
      turns: { t: { turnScopeId: "t", dialogProcessId: "dp", state: "processing" } },
    },
  });
  const input = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-1",
    persistedMessageUids: ["sm_target", "sm_keep"],
    summarizedMessageUids: ["sm_target"],
  };

  const committed = await h.service.commitTurnSummaryCheckpoint(input);
  const replay = await h.service.commitTurnSummaryCheckpoint(input);

  assert.equal(committed.committed, true);
  assert.equal(committed.checkpointRevision, 1);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.checkpointRevision, 1);
  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_target").summarized, true);
  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_keep").summarized, undefined);
  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_history").summarized, undefined);
  assert.equal(h.get().turnSummaryCheckpoints.t.checkpointRevision, 1);
  assert.equal("sequence" in h.get().turnSummaryCheckpoints.t, false);
});

test("turn summary checkpoints reject a split assistant tool-call and result pair", async () => {
  const h = harness({
    messages: [
      {
        messageUid: "sm_call",
        role: "assistant",
        content: "",
        dialogProcessId: "dp",
        turnScopeId: "t",
        tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: "{}" } }],
      },
      {
        messageUid: "sm_result",
        role: "tool",
        content: "result",
        dialogProcessId: "dp",
        turnScopeId: "t",
        tool_call_id: "call_1",
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: "t",
      turns: { t: { turnScopeId: "t", dialogProcessId: "dp", state: "processing" } },
    },
  });

  await assert.rejects(
    h.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-split",
      persistedMessageUids: ["sm_call", "sm_result"],
      summarizedMessageUids: ["sm_result"],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT",
  );

  assert.equal(
    h.get().messages.some((message) => message.summarized === true),
    false,
  );
});

test("turn summary checkpoints allow exact historical summary targets but keep persistence scoped", async () => {
  const crossTurn = harness({
    messages: [
      {
        messageUid: "sm_current",
        role: "assistant",
        content: "current",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_old",
        role: "assistant",
        content: "old",
        dialogProcessId: "old",
        turnScopeId: "old-t",
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: "t",
      turns: { t: { turnScopeId: "t", dialogProcessId: "dp", state: "processing" } },
    },
  });
  const historical = await crossTurn.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-cross",
    summarizedMessageUids: ["sm_old"],
  });
  assert.equal(historical.committed, true);
  assert.equal(
    crossTurn.get().messages.find((message) => message.messageUid === "sm_old").summarized,
    true,
  );
  assert.deepEqual(crossTurn.get().turnSummaryCheckpoints.t.receipts[0].summarizedMessageUids, [
    "sm_old",
  ]);
  const replay = await crossTurn.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-cross",
    summarizedMessageUids: ["sm_old"],
  });
  assert.equal(replay.deduplicated, true);

  await assert.rejects(
    crossTurn.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-cross-persist",
      persistedMessageUids: ["sm_old"],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT",
  );
});

test("turn summary checkpoints validate historical tool pairs inside their original round", async () => {
  const h = harness({
    messages: [
      {
        messageUid: "sm_old_call",
        role: "assistant",
        content: "",
        dialogProcessId: "old",
        turnScopeId: "old-t",
        tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: "{}" } }],
      },
      {
        messageUid: "sm_old_result",
        role: "tool",
        content: "result",
        dialogProcessId: "old",
        turnScopeId: "old-t",
        tool_call_id: "call_1",
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: "t",
      turns: { t: { turnScopeId: "t", dialogProcessId: "dp", state: "processing" } },
    },
  });

  await assert.rejects(
    h.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-old-split",
      summarizedMessageUids: ["sm_old_result"],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT",
  );
});

test("terminal turn checkpoints only mark already persisted canonical messages", async () => {
  const terminal = harness({
    messages: [
      {
        messageUid: "sm_done",
        role: "assistant",
        content: "done",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: "",
      turns: { t: { turnScopeId: "t", dialogProcessId: "dp", state: "completed" } },
    },
  });
  const committed = await terminal.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-terminal",
    summarizedMessageUids: ["sm_done"],
  });
  assert.equal(committed.committed, true);
  assert.equal(terminal.get().messages[0].summarized, true);

  await assert.rejects(
    terminal.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-terminal-persist",
      persistedMessageUids: ["sm_done"],
      summarizedMessageUids: ["sm_done"],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE",
  );
});

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

test("canonical attachment rejects placeholders and cross-session injection", async (t) => {
  const invalid = [
    { sessionId: "s1", path: "/workspace/a" },
    { attachmentId: "a", sessionId: "other", path: "/workspace/a" },
    { attachmentId: "a", sessionId: "s1" },
  ];
  for (const [index, attachment] of invalid.entries()) {
    await t.test(String(index), async () => {
      const h = harness();
      await assert.rejects(
        h.service.commitTurn({
          userId: "u1",
          sessionId: "s1",
          content: "x",
          turnScopeId: `t${index}`,
          commandId: `i${index}`,
          attachments: [attachment],
        }),
        (e) => e.errorCode === "INVALID_CANONICAL_ATTACHMENT",
      );
      assert.equal(h.get().messages.length, 0);
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
