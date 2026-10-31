/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { parseTurnSummaryCheckpointRequest } from "../src/policy/summary-checkpoint-request.js";
import { applyTurnSummaryCheckpoint } from "../src/policy/summary-checkpoint-transaction.js";

const committedAt = "2026-10-31T00:00:00.000Z";

function session() {
  return {
    turnLifecycle: {
      turns: { turn: { dialogProcessId: "dialog", state: "running" } },
      activeTurnScopeId: "turn",
    },
    messages: [
      {
        messageUid: "message",
        dialogProcessId: "dialog",
        turnScopeId: "turn",
        role: "assistant",
        content: "answer",
      },
    ],
  };
}

function request(overrides = {}) {
  return parseTurnSummaryCheckpointRequest({
    userId: "user",
    sessionId: "session",
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    checkpointId: "checkpoint",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["message"],
    summarizedMessageUids: ["message"],
    retainedMessageUids: [],
    ...overrides,
  });
}

test("checkpoint commit and retry share one receipt without rewriting facts", () => {
  const target = session();
  const first = applyTurnSummaryCheckpoint(target, request(), committedAt);
  assert.equal(first.committed, true);
  assert.equal(target.messages[0].summarized, true);
  assert.equal(first.checkpointRevision, 1);
  const committed = structuredClone(target);
  const retry = applyTurnSummaryCheckpoint(target, request(), "2026-11-01T00:00:00.000Z");
  assert.equal(retry.deduplicated, true);
  assert.deepEqual(target, committed);
  assert.throws(
    () => applyTurnSummaryCheckpoint(target, request({ summarizedMessageUids: [] }), committedAt),
    {
      code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_ID_REUSED,
    },
  );
  assert.deepEqual(target, committed);
});

test("checkpoint validation rejects unresolved messages and wrong turn without mutation", () => {
  for (const [overrides, code] of [
    [
      { persistedMessageUids: ["missing"] },
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING,
    ],
    [
      { expectedCheckpointRevision: 1 },
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_REVISION_CONFLICT,
    ],
  ]) {
    const target = session();
    const before = structuredClone(target);
    assert.throws(() => applyTurnSummaryCheckpoint(target, request(overrides), committedAt), {
      code,
    });
    assert.deepEqual(target, before);
  }
  const target = session();
  target.messages[0].turnScopeId = "other";
  const before = structuredClone(target);
  assert.throws(() => applyTurnSummaryCheckpoint(target, request(), committedAt), {
    code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT,
  });
  assert.deepEqual(target, before);
});

test("invalid receipt metadata leaves both messages and checkpoint state untouched", () => {
  const target = session();
  const before = structuredClone(target);
  assert.throws(() => applyTurnSummaryCheckpoint(target, request(), ""), /committedAt/);
  assert.deepEqual(target, before);
});
