/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../../src/system-core/session/services/session-message-service.js";

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

test("continue identity round-trips and a stopped source can only be consumed once", async () => {
  const h = harness({ version: 4, revision: 4, messages: [{ role: "user", content: "old", turnScopeId: "old", dialogProcessId: "dp-old" }], turnStatuses: [{ turnScopeId: "old", dialogProcessId: "dp-old", status: "user_stopped" }] });
  const result = await h.service.commitTurn({ userId: "u1", sessionId: "s1", action: "continue", content: "continue", turnScopeId: "new", dialogProcessId: "dp-new", idempotencyKey: "continue-1", expectedVersion: 4, resumeTurnScopeId: "old", resumeDialogProcessId: "dp-old", attachments: [canonical("continued")] });
  assert.equal(result.userMessage.turnCommit.resumeTurnScopeId, "old");
  assert.equal(result.userMessage.turnCommit.resumeDialogProcessId, "dp-old");
  await assert.rejects(h.service.commitTurn({ userId: "u1", sessionId: "s1", action: "continue", content: "again", turnScopeId: "new2", idempotencyKey: "continue-2", expectedVersion: 5, resumeTurnScopeId: "old", resumeDialogProcessId: "dp-old" }), (e) => e.errorCode === "CONTINUE_SOURCE_CONSUMED");
});

test("internal append, status and summarization use mutation lock without changing public version", async () => {
  const h = harness({ version: 7, revision: 7, messages: [{ role: "user", content: "q", turnScopeId: "t", dialogProcessId: "dp" }] });
  await h.service.appendTurn({ userId: "u1", sessionId: "s1", role: "assistant", content: "a", turnScopeId: "t", dialogProcessId: "dp" });
  await h.service.upsertTurnStatus({ userId: "u1", sessionId: "s1", turnScopeId: "t", dialogProcessId: "dp", command: "completed" });
  await h.service.markSessionMessagesSummarized({ userId: "u1", sessionId: "s1" });
  assert.equal(h.get().version, 7); assert.equal(h.get().revision, 7);
  assert.equal(h.get().messages.every((m) => m.summarized), true);
  assert.equal(h.locks(), 3);
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
  assert.equal(committed.version, 5);
  assert.equal(replay.version, 5);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.newTurn.turnScopeId, "replacement");
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
