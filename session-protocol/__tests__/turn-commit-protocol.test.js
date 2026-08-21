/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  assertTurnCommittedEventData,
  validateTurnCommittedEventData,
} from "@noobot/session-protocol/turn-commit";

function createCommit(overrides = {}) {
  return {
    sessionId: "session-1",
    aggregateVersion: 1,
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    userMessage: {
      messageUid: "sm_1",
      messageId: "frontend-user-1",
      role: "user",
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      attachments: [],
    },
    ...overrides,
  };
}

test("turn_committed accepts one canonical persisted user message", () => {
  const commit = createCommit();
  assert.equal(validateTurnCommittedEventData(commit).ok, true);
  assert.equal(assertTurnCommittedEventData(commit), commit);
});

test("turn_committed rejects attachments owned by the binding command", () => {
  const validation = validateTurnCommittedEventData(
    createCommit({
      userMessage: {
        ...createCommit().userMessage,
        attachments: [
          { sessionId: "session-1" },
          { attachmentId: "attachment-2", sessionId: "session-2" },
        ],
      },
    }),
  );
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.errors, [
    "user_message_attachments_forbidden",
    "attachment_id_missing",
    "attachment_session_mismatch",
  ]);
});

test("turn_committed rejects mismatched message identity atomically", () => {
  assert.throws(
    () =>
      assertTurnCommittedEventData(
        createCommit({
          userMessage: { ...createCommit().userMessage, turnScopeId: "turn-2" },
        }),
      ),
    (error) =>
      error?.code === "TURN_COMMITTED_PROTOCOL_INVALID" &&
      error?.validationErrors?.includes("user_message_turn_mismatch"),
  );
});
