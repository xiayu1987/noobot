/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTurnReplacementMaterialization,
  createTurnReplacementCommit,
  validateTurnReplacementCommit,
} from "../src/turn-replacement.mjs";

test("turn replacement commit binds one replacement user to one committed session version", () => {
  const commit = createTurnReplacementCommit({
    commandId: "resend-1",
    sessionId: "session-1",
    committedAggregateVersion: 4,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageId: "user-new",
    committedAt: "2026-07-31T00:00:00.000Z",
  });
  assert.equal(validateTurnReplacementCommit(commit).valid, true);
  const materialized = assertTurnReplacementMaterialization({
    commit,
    session: {
      sessionId: "session-1",
      aggregateVersion: 4,
      messages: [{ role: "user", messageId: "user-new", dialogProcessId: "dialog-new", turnScopeId: "turn-new" }],
    },
  });
  assert.equal(materialized.replacementUser.messageId, "user-new");
});

test("turn replacement materialization rejects a snapshot from another version", () => {
  const commit = createTurnReplacementCommit({
    commandId: "resend-1",
    sessionId: "session-1",
    committedAggregateVersion: 4,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageId: "user-new",
  });
  assert.throws(() => assertTurnReplacementMaterialization({
    commit,
    session: {
      sessionId: "session-1",
      aggregateVersion: 3,
      messages: [{ role: "user", messageId: "user-new", dialogProcessId: "dialog-new", turnScopeId: "turn-new" }],
    },
  }), /aggregate_version_mismatch/);
});

test("turn replacement materialization rejects a snapshot that still contains a replaced scope", () => {
  const commit = createTurnReplacementCommit({
    commandId: "resend-2",
    sessionId: "session-1",
    committedAggregateVersion: 5,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageId: "user-new",
  });
  assert.throws(() => assertTurnReplacementMaterialization({
    commit,
    session: {
      sessionId: "session-1",
      aggregateVersion: 5,
      messages: [
        { role: "user", messageId: "user-old", turnScopeId: "turn-old" },
        { role: "user", messageId: "user-new", dialogProcessId: "dialog-new", turnScopeId: "turn-new" },
      ],
    },
  }), /replaced_scope_still_materialized/);
});

test("turn replacement materialization requires a user-only replacement scope", () => {
  const commit = createTurnReplacementCommit({
    commandId: "resend-3",
    sessionId: "session-1",
    committedAggregateVersion: 6,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageId: "user-new",
  });
  assert.throws(() => assertTurnReplacementMaterialization({
    commit,
    session: {
      sessionId: "session-1",
      aggregateVersion: 6,
      messages: [
        { role: "user", messageId: "user-new", dialogProcessId: "dialog-new", turnScopeId: "turn-new" },
        { role: "assistant", messageId: "assistant-new", dialogProcessId: "dialog-new", turnScopeId: "turn-new" },
      ],
    },
  }), /replacement_scope_not_user_only/);
});

test("turn replacement materialization requires the committed dialog identity", () => {
  const commit = createTurnReplacementCommit({
    commandId: "resend-4",
    sessionId: "session-1",
    committedAggregateVersion: 7,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageId: "user-new",
  });
  assert.throws(() => assertTurnReplacementMaterialization({
    commit,
    session: {
      sessionId: "session-1",
      aggregateVersion: 7,
      messages: [{
        role: "user",
        messageId: "user-new",
        dialogProcessId: "dialog-other",
        turnScopeId: "turn-new",
      }],
    },
  }), /replacement_dialog_process_mismatch/);
});
