/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendCommandReceipt,
  validateCommandReceiptResult,
} from "../src/command/command-receipt.js";
import { SESSION_COMMAND } from "../src/command/session-command.js";
import { createTurnReplacementCommit } from "../src/lifecycle/turn-replacement.js";

function replacement() {
  return createTurnReplacementCommit({
    commandId: "replace-1",
    sessionId: "session-1",
    committedAggregateVersion: 3,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageId: "user-new",
    requestHash: "hash-1",
    committedAt: "2026-07-31T00:00:00.000Z",
  });
}

test("delete-from receipt result declares count, anchor and deleted turn scopes", () => {
  const valid = { deletedCount: 2, anchorIndex: 1, deletedTurnScopeIds: ["turn-1"] };
  assert.equal(
    validateCommandReceiptResult(SESSION_COMMAND.MESSAGE_DELETE_FROM, valid).valid,
    true,
  );
  assert.deepEqual(
    validateCommandReceiptResult(SESSION_COMMAND.MESSAGE_DELETE_FROM, {
      deletedCount: -1,
      anchorIndex: "1",
      extra: true,
    }).errors,
    [
      "unknown_command_result_field",
      "invalid_result_deleted_count",
      "invalid_result_anchor_index",
      "invalid_result_deleted_turn_scope_ids",
    ],
  );
  assert.deepEqual(
    validateCommandReceiptResult(SESSION_COMMAND.MESSAGE_DELETE_FROM, {
      ...valid,
      deletedTurnScopeIds: [" turn-1 "],
    }).errors,
    ["invalid_result_deleted_turn_scope_ids"],
  );
});

test("turn replace receipt result carries a valid turn replacement commit", () => {
  assert.equal(
    validateCommandReceiptResult(SESSION_COMMAND.TURN_REPLACE, { turnReplacement: replacement() })
      .valid,
    true,
  );
  assert.deepEqual(
    validateCommandReceiptResult(SESSION_COMMAND.TURN_REPLACE, {
      turnReplacement: { ...replacement(), replacedTurnScopeIds: [] },
      extra: 1,
    }).errors,
    ["unknown_command_result_field", "invalid_result_turn_replacement"],
  );
});

test("appendCommandReceipt rejects undeclared delete-from result shapes", () => {
  const receipt = {
    type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
    commandId: "delete-1",
    aggregateVersion: 2,
    requestHash: "hash-1",
    committedAt: "2026-07-31T00:00:00.000Z",
  };
  assert.throws(
    () => appendCommandReceipt([], { ...receipt, result: { deletedCount: 1 } }),
    /invalid command receipt result/,
  );
  const receipts = appendCommandReceipt([], {
    ...receipt,
    result: { deletedCount: 1, anchorIndex: 0, deletedTurnScopeIds: [] },
  });
  assert.deepEqual(receipts[0].result, {
    deletedCount: 1,
    anchorIndex: 0,
    deletedTurnScopeIds: [],
  });
});
