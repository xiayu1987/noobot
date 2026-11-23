/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendCommandReceipt,
  createMessageDeleteResult,
  decideCommandIdempotency,
  resolveMessageDeleteResultEffect,
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
    replacementUserMessageUid: "user-new",
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

test("deletion receipts round-trip exact suffix bounds including safe-integer limits", () => {
  for (const [firstOrdinal, previousMessageCount] of [
    [1, 1],
    [3, 8],
    [1, Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ]) {
    const messageSuffix = { firstOrdinal, previousMessageCount };
    const scopes = ["interleaved", "anchor"];
    const result = createMessageDeleteResult(messageSuffix, scopes);
    scopes.reverse();
    assert.deepEqual(result.deletedTurnScopeIds, ["interleaved", "anchor"]);
    assert.deepEqual(resolveMessageDeleteResultEffect(result), {
      messageSuffix,
      retainedMessageCount: firstOrdinal - 1,
      deletedCount: previousMessageCount - firstOrdinal + 1,
    });
  }
});

for (const [label, fields, error] of [
  ["empty suffix", { deletedCount: 0 }, "invalid_result_message_suffix"],
  ["overflowing count", { deletedCount: Number.MAX_SAFE_INTEGER }, "invalid_result_message_suffix"],
  ["overflowing anchor", { anchorIndex: Number.MAX_SAFE_INTEGER }, "invalid_result_message_suffix"],
  ["fractional count", { deletedCount: 1.5 }, "invalid_result_deleted_count"],
  [
    "duplicate scopes",
    { deletedTurnScopeIds: ["turn-1", "turn-1"] },
    "invalid_result_deleted_turn_scope_ids",
  ],
]) {
  test(`deletion receipt rejects ${label} during validation and replay`, () => {
    const result = { deletedCount: 1, anchorIndex: 1, deletedTurnScopeIds: ["turn-1"], ...fields };
    assert.deepEqual(
      validateCommandReceiptResult(SESSION_COMMAND.MESSAGE_DELETE_FROM, result).errors,
      [error],
    );
    assert.equal(resolveMessageDeleteResultEffect(result), null);
    const receipt = {
      type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
      commandId: "delete-invalid",
      requestHash: "hash-1",
      aggregateVersion: 2,
      committedAt: "2026-07-31T00:00:00.000Z",
      result,
    };
    assert.throws(() => appendCommandReceipt([], receipt), /invalid command receipt/);
    assert.throws(
      () => decideCommandIdempotency({ ...receipt, receipts: [receipt] }),
      /invalid command receipt/,
    );
  });
}

test("deletion result construction rejects ambiguous bounds and invalid scope facts", () => {
  for (const bounds of [
    null,
    { firstOrdinal: 2, previousMessageCount: 1 },
    { firstOrdinal: 1, previousMessageCount: 1, deletedCount: 1 },
  ])
    assert.throws(() => createMessageDeleteResult(bounds, []), /invalid command receipt/);
  assert.throws(
    () => createMessageDeleteResult({ firstOrdinal: 1, previousMessageCount: 1 }, ["a", "a"]),
    /invalid command receipt/,
  );
});

test("deletion replay preserves the stored result and scope ordering without recomputation", () => {
  const receipt = {
    type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
    commandId: "delete-replay",
    requestHash: "hash-1",
    aggregateVersion: 2,
    committedAt: "2026-07-31T00:00:00.000Z",
    result: { deletedCount: 3, anchorIndex: 2, deletedTurnScopeIds: ["turn-b", "turn-a"] },
  };
  const receipts = appendCommandReceipt([], receipt);
  const decision = decideCommandIdempotency({ ...receipt, receipts });
  assert.equal(decision.deduplicated, true);
  assert.deepEqual(decision.receipt, receipt);
  assert.notEqual(decision.receipt, receipts[0]);
  assert.deepEqual(resolveMessageDeleteResultEffect(decision.receipt.result).messageSuffix, {
    firstOrdinal: 3,
    previousMessageCount: 5,
  });
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
    /invalid command receipt/,
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
