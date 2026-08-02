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
    sessionId: "s1", parentSessionId: "", version: 0, revision: 0,
    messages: [], turnStatuses: [], ...initial,
  });
  let lockCalls = 0;
  const repo = {
    async withSessionMutation(_u, _s, _p, operation) { lockCalls += 1; return operation(); },
    async resolveParentSessionId() { return ""; },
    async ensureSession() {},
    async findById() { return structuredClone(session); },
    async save(_u, next, _p, { expectedVersion } = {}) {
      const actual = Number(session.version ?? session.revision ?? 0);
      if (expectedVersion != null && Number(expectedVersion) !== actual) {
        const error = new Error("session version conflict");
        error.statusCode = 409; error.errorCode = "SESSION_VERSION_CONFLICT"; error.currentVersion = actual;
        throw error;
      }
      session = structuredClone(next);
    },
  };
  return { service: new SessionMessageService({ repo, sessionRepo: repo, now: () => "2026-01-01T00:00:00.000Z" }), get: () => structuredClone(session), locks: () => lockCalls };
}

const canonical = (id = "a1") => ({
  attachmentId: id, sessionId: "s1", name: `${id}.docx`,
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: 321, path: `/workspace/${id}.docx`,
  parsedResult: { attachmentId: `${id}-parsed`, path: `/workspace/${id}.md`, status: "completed" },
});

test("commitTurn increments structural version and preserves canonical attachment round-trip", async () => {
  const h = harness();
  const first = await h.service.commitTurn({ userId: "u1", sessionId: "s1", content: "one", turnScopeId: "t1", idempotencyKey: "i1", expectedVersion: 0, attachments: [canonical()] });
  const second = await h.service.commitTurn({ userId: "u1", sessionId: "s1", content: "two", turnScopeId: "t2", idempotencyKey: "i2", expectedVersion: 1 });
  assert.equal(first.version, 1); assert.equal(second.version, 2);
  assert.equal(h.get().version, 2); assert.equal(h.get().revision, 2);
  assert.deepEqual(first.attachments, [canonical()]);
});

test("commitTurn persists the preallocated user message identity", async () => {
  const h = harness();
  const result = await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "hello",
    turnScopeId: "t1",
    idempotencyKey: "i1",
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
    idempotencyKey: "internal-turn:1",
    frontendUserMessage: false,
  });
  assert.equal(result.userMessage.frontendUserMessage, undefined);
  assert.equal(result.userMessage.messageOrigin, "internal");
});

test("commitTurn assigns an immutable logical dialog ordinal", async () => {
  const h = harness();
  await h.service.commitTurn({
    userId: "u1", sessionId: "s1", content: "first", turnScopeId: "t1",
    dialogProcessId: "d1", idempotencyKey: "i1",
  });
  await h.service.commitTurn({
    userId: "u1", sessionId: "s1", content: "second", turnScopeId: "t2",
    dialogProcessId: "d2", idempotencyKey: "i2",
  });

  assert.deepEqual(h.get().dialogOrder.map(({ dialogProcessId, dialogOrdinal }) => ({ dialogProcessId, dialogOrdinal })), [
    { dialogProcessId: "d1", dialogOrdinal: 1 },
    { dialogProcessId: "d2", dialogOrdinal: 2 },
  ]);
  assert.equal(h.get().dialogOrder.some((entry) => "sequence" in entry), false);
  assert.equal(new Set(h.get().messages.map((message) => message.messageUid)).size, 2);
  assert.equal(h.get().messages.every((message) => /^sm_/.test(message.messageUid)), true);
});

test("legacy dialog sequence is read only at the compatibility boundary", () => {
  const normalized = normalizeSessionEntity({
    sessionId: "s1",
    messages: [{
      role: "user", content: "legacy", dialogProcessId: "d1", turnScopeId: "t1",
      messageId: "m1", ts: "2026-01-01T00:00:00.000Z",
    }],
    dialogOrder: [{ dialogProcessId: "d1", sequence: 7 }],
  }, { now: () => "2026-01-01T00:00:00.000Z" });

  assert.deepEqual(normalized.dialogOrder.map(({ userMessageUid, ...entry }) => entry), [{
    dialogProcessId: "d1", turnScopeId: "t1",
    startedAt: "2026-01-01T00:00:00.000Z", dialogOrdinal: 7,
  }]);
  assert.equal(normalized.dialogOrder[0].userMessageUid, normalized.messages[0].messageUid);
  assert.equal("userMessageId" in normalized.dialogOrder[0], false);
  assert.equal("sequence" in normalized.dialogOrder[0], false);
});

test("legacy messages receive deterministic persistent message UIDs", () => {
  const legacy = {
    sessionId: "s1",
    messages: [{
      role: "assistant", content: "legacy", messageId: "am_1",
      dialogProcessId: "d1", turnScopeId: "t1", ts: "2026-01-01T00:00:00.000Z",
    }],
  };
  const first = normalizeSessionEntity(legacy, { now: () => "2026-01-01T00:00:00.000Z" });
  const second = normalizeSessionEntity(legacy, { now: () => "2026-01-01T00:00:00.000Z" });
  assert.match(first.messages[0].messageUid, /^sm_legacy_[0-9a-f]{32}$/);
  assert.equal(first.messages[0].messageUid, second.messages[0].messageUid);
});

test("same idempotency identity wins before stale version check", async () => {
  const h = harness();
  const input = { userId: "u1", sessionId: "s1", content: "one", turnScopeId: "t1", idempotencyKey: "i1", expectedVersion: 0, attachments: [canonical()] };
  const committed = await h.service.commitTurn(input);
  const replay = await h.service.commitTurn({ ...input, expectedVersion: 0 });
  assert.equal(replay.deduplicated, true); assert.equal(replay.version, committed.version);
  assert.equal(h.get().messages.filter((m) => m.role === "user").length, 1);
  assert.deepEqual(replay.attachments, committed.attachments);
});

test("different identity with stale version receives canonical conflict", async () => {
  const h = harness({ version: 3, revision: 3 });
  await assert.rejects(h.service.commitTurn({ userId: "u1", sessionId: "s1", content: "x", turnScopeId: "t", idempotencyKey: "i", expectedVersion: 2 }),
    (e) => e.statusCode === 409 && e.errorCode === "SESSION_VERSION_CONFLICT" && e.currentVersion === 3);
});

test("expectedVersion accepts missing, zero and integer strings but rejects unsafe forms", async (t) => {
  for (const value of [-1, 1.2, NaN, Infinity, "nope", "1.2", Number.MAX_SAFE_INTEGER + 1]) {
    await t.test(String(value), async () => {
      const h = harness();
      await assert.rejects(h.service.commitTurn({ userId: "u1", sessionId: "s1", content: "x", turnScopeId: `t-${value}`, idempotencyKey: `i-${value}`, expectedVersion: value }),
        (e) => e.statusCode === 400 && e.errorCode === "INVALID_SESSION_VERSION");
    });
  }
  const absent = harness();
  assert.equal((await absent.service.commitTurn({ userId: "u1", sessionId: "s1", content: "x", turnScopeId: "ta", idempotencyKey: "ia" })).version, 1);
  const stringZero = harness();
  assert.equal((await stringZero.service.commitTurn({ userId: "u1", sessionId: "s1", content: "x", turnScopeId: "tz", idempotencyKey: "iz", expectedVersion: "0" })).version, 1);
});

test("continue identity round-trips only when it matches the authoritative continuation relation", async () => {
  const h = harness({
    version: 4,
    revision: 4,
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
  const result = await h.service.commitTurn({ userId: "u1", sessionId: "s1", action: "continue", content: "continue", turnScopeId: "new", dialogProcessId: "dp-new", idempotencyKey: "continue-1", expectedVersion: 4, resumeTurnScopeId: "old", resumeDialogProcessId: "dp-old", attachments: [canonical("continued")] });
  assert.equal(result.userMessage.turnCommit.resumeTurnScopeId, "old");
  assert.equal(result.userMessage.turnCommit.resumeDialogProcessId, "dp-old");
  await assert.rejects(
    h.service.commitTurn({ userId: "u1", sessionId: "s1", action: "continue", content: "again", turnScopeId: "new2", idempotencyKey: "continue-2", expectedVersion: 5, resumeTurnScopeId: "old", resumeDialogProcessId: "dp-old" }),
    (error) => error.errorCode === "CONTINUE_AUTHORITY_MISMATCH",
  );
});

test("internal append and summarization use mutation lock without changing public version", async () => {
  const h = harness({
    version: 7,
    revision: 7,
    messages: [
      { role: "user", content: "q", turnScopeId: "t", dialogProcessId: "dp" },
      { role: "user", content: "historical", turnScopeId: "old", dialogProcessId: "dp-old" },
    ],
  });
  await h.service.appendTurn({ userId: "u1", sessionId: "s1", role: "assistant", content: "a", turnScopeId: "t", dialogProcessId: "dp" });
  await h.service.markSessionMessagesSummarized({ userId: "u1", sessionId: "s1", dialogProcessId: "dp" });
  assert.equal(h.get().version, 7); assert.equal(h.get().revision, 7);
  assert.equal(h.get().messages.filter((m) => m.dialogProcessId === "dp").every((m) => m.summarized), true);
  assert.equal(h.get().messages.find((m) => m.dialogProcessId === "dp-old").summarized, undefined);
  assert.equal(h.locks(), 2);
});

test("summarization without a dialog scope fails closed", async () => {
  const h = harness({
    messages: [{ role: "user", content: "historical", dialogProcessId: "dp-old" }],
  });

  const marked = await h.service.markSessionMessagesSummarized({
    userId: "u1",
    sessionId: "s1",
  });

  assert.equal(marked, 0);
  assert.equal(h.get().messages[0].summarized, undefined);
  assert.equal(h.locks(), 0);
});

test("turn summary checkpoints mark exact UIDs and persist an idempotent scoped receipt", async () => {
  const h = harness({
    messages: [
      { messageUid: "sm_target", role: "assistant", content: "same", dialogProcessId: "dp", turnScopeId: "t" },
      { messageUid: "sm_keep", role: "assistant", content: "same", dialogProcessId: "dp", turnScopeId: "t" },
      { messageUid: "sm_history", role: "assistant", content: "same", dialogProcessId: "old", turnScopeId: "old-t" },
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

test("turn summary checkpoints reject cross-turn messages and terminal turns", async () => {
  const crossTurn = harness({
    messages: [{ messageUid: "sm_old", role: "assistant", content: "old", dialogProcessId: "old", turnScopeId: "old-t" }],
    turnLifecycle: {
      activeTurnScopeId: "t",
      turns: { t: { turnScopeId: "t", dialogProcessId: "dp", state: "processing" } },
    },
  });
  await assert.rejects(crossTurn.service.commitTurnSummaryCheckpoint({
    userId: "u1", sessionId: "s1", dialogProcessId: "dp", turnScopeId: "t",
    checkpointId: "cp-cross", summarizedMessageUids: ["sm_old"],
  }), (error) => error.code === "TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT");

  const terminal = harness({
    messages: [{ messageUid: "sm_done", role: "assistant", content: "done", dialogProcessId: "dp", turnScopeId: "t" }],
    turnLifecycle: {
      activeTurnScopeId: "",
      turns: { t: { turnScopeId: "t", dialogProcessId: "dp", state: "completed" } },
    },
  });
  await assert.rejects(terminal.service.commitTurnSummaryCheckpoint({
    userId: "u1", sessionId: "s1", dialogProcessId: "dp", turnScopeId: "t",
    checkpointId: "cp-terminal", summarizedMessageUids: ["sm_done"],
  }), (error) => error.code === "TURN_SUMMARY_CHECKPOINT_TERMINAL");
});

test("turn summary checkpoint receipts reject stale revisions and are pruned with removed turns", async () => {
  const h = harness({
    messages: [
      { messageUid: "sm_1", role: "assistant", content: "one", dialogProcessId: "dp", turnScopeId: "t" },
      { messageUid: "sm_2", role: "assistant", content: "two", dialogProcessId: "dp", turnScopeId: "t" },
    ],
  });
  await h.service.commitTurnSummaryCheckpoint({
    userId: "u1", sessionId: "s1", dialogProcessId: "dp", turnScopeId: "t",
    checkpointId: "cp-1", summarizedMessageUids: ["sm_1"],
  });
  await assert.rejects(h.service.commitTurnSummaryCheckpoint({
    userId: "u1", sessionId: "s1", dialogProcessId: "dp", turnScopeId: "t",
    checkpointId: "cp-2", expectedCheckpointRevision: 0, summarizedMessageUids: ["sm_2"],
  }), (error) => error.code === "TURN_SUMMARY_CHECKPOINT_REVISION_CONFLICT" && error.currentCheckpointRevision === 1);
  await assert.rejects(h.service.commitTurnSummaryCheckpoint({
    userId: "u1", sessionId: "s1", dialogProcessId: "dp", turnScopeId: "t",
    checkpointId: "cp-1", summarizedMessageUids: ["sm_2"],
  }), (error) => error.code === "TURN_SUMMARY_CHECKPOINT_ID_REUSED");

  const normalized = normalizeSessionEntity({
    ...h.get(),
    messages: [],
  }, { now: () => "2026-01-01T00:00:00.000Z" });
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
      await assert.rejects(h.service.commitTurn({ userId: "u1", sessionId: "s1", content: "x", turnScopeId: `t${index}`, idempotencyKey: `i${index}`, attachments: [attachment] }), (e) => e.errorCode === "INVALID_CANONICAL_ATTACHMENT");
      assert.equal(h.get().messages.length, 0);
    });
  }
});

test("deleteFromMessage replays a committed receipt without deleting again", async () => {
  const h = harness({
    version: 2,
    revision: 2,
    messages: [
      { role: "user", content: "keep", turnScopeId: "keep" },
      { role: "user", content: "delete", turnScopeId: "delete" },
    ],
  });
  const input = {
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "delete" },
    expectedVersion: 2,
    idempotencyKey: "delete-once",
  };
  const committed = await h.service.deleteFromMessage(input);
  await h.service.commitTurn({
    userId: "u1",
    sessionId: "s1",
    content: "later",
    turnScopeId: "later",
    idempotencyKey: "later",
    expectedVersion: 3,
  });
  const replay = await h.service.deleteFromMessage(input);
  assert.equal(committed.version, 3);
  assert.equal(replay.version, 4);
  assert.equal(replay.committedVersion, 3);
  assert.equal(replay.session.version, replay.version);
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(replay.deletedCount, committed.deletedCount);
  assert.equal(h.get().messages.length, 2);
});

test("replaceTurn replays a committed receipt after the original anchor is gone", async () => {
  const h = harness({
    version: 4,
    revision: 4,
    messages: [{ role: "user", content: "old", turnScopeId: "old" }],
  });
  const input = {
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "old" },
    newContent: "new",
    turnScopeId: "replacement",
    expectedVersion: 4,
    idempotencyKey: "replace-once",
  };
  const committed = await h.service.replaceTurn(input);
  const replay = await h.service.replaceTurn(input);
  assert.equal(committed.session.version, 5);
  assert.equal(replay.session.version, 5);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.turnReplacement.replacementTurnScopeId, "replacement");
  assert.equal(replay.turnReplacement.commandId, "replace-once");
  assert.deepEqual(h.get().messages.map((message) => message.content), ["new"]);
});

test("idempotency keys reject reuse with a different request", async () => {
  const send = harness();
  await send.service.commitTurn({
    userId: "u1", sessionId: "s1", content: "one", turnScopeId: "t1", idempotencyKey: "same",
  });
  await assert.rejects(send.service.commitTurn({
    userId: "u1", sessionId: "s1", content: "different", turnScopeId: "t2", idempotencyKey: "same",
  }), (error) => error.errorCode === "IDEMPOTENCY_KEY_REUSED");

  const replace = harness({
    messages: [{ role: "user", content: "old", turnScopeId: "old" }],
  });
  await replace.service.replaceTurn({
    userId: "u1", sessionId: "s1", anchor: { turnScopeId: "old" }, newContent: "new",
    turnScopeId: "new", idempotencyKey: "replace-key",
  });
  await assert.rejects(replace.service.replaceTurn({
    userId: "u1", sessionId: "s1", anchor: { turnScopeId: "other" }, newContent: "other",
    turnScopeId: "other-new", idempotencyKey: "replace-key",
  }), (error) => error.errorCode === "IDEMPOTENCY_KEY_REUSED");
});
