/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendTurnSummaryCheckpointReceipt,
  assertTurnSummaryCheckpointState,
  createEmptyTurnSummaryCheckpointState,
} from "../src/policy/summary.js";

const SCOPE = { dialogProcessId: "dp", turnScopeId: "t" };

function receipt(checkpointRevision) {
  return {
    checkpointId: `cp-${checkpointRevision}`,
    checkpointRevision,
    requestHash: `sha256:${checkpointRevision}`,
    persistedMessageUids: [],
    summarizedMessageUids: ["sm_a"],
    retainedMessageUids: [],
    markedCount: 1,
    committedAt: "2026-01-01T00:00:00.000Z",
  };
}

const INVALID_STATE = { code: "INVALID_TURN_SUMMARY_CHECKPOINT_STATE" };

test("checkpoint receipts append in strict revision order", () => {
  const first = appendTurnSummaryCheckpointReceipt(
    createEmptyTurnSummaryCheckpointState(SCOPE),
    receipt(1),
  );
  const second = appendTurnSummaryCheckpointReceipt(first, receipt(2));
  assert.equal(second.checkpointRevision, 2);
  assert.deepEqual(
    second.receipts.map((item) => item.checkpointRevision),
    [1, 2],
  );
  assert.equal(assertTurnSummaryCheckpointState(second, "t"), second);
});

test("checkpoint receipt append rejects revisions that skip or repeat", () => {
  const empty = createEmptyTurnSummaryCheckpointState(SCOPE);
  assert.throws(() => appendTurnSummaryCheckpointReceipt(empty, receipt(2)), INVALID_STATE);
  const first = appendTurnSummaryCheckpointReceipt(empty, receipt(1));
  assert.throws(() => appendTurnSummaryCheckpointReceipt(first, receipt(1)), INVALID_STATE);
});

test("checkpoint state keeps its revision after receipts are pruned", () => {
  const pruned = { ...SCOPE, checkpointRevision: 3, receipts: [receipt(2)] };
  assert.equal(assertTurnSummaryCheckpointState(pruned, "t"), pruned);
});

test("checkpoint state rejects receipts ahead of or out of revision order", () => {
  assert.throws(
    () =>
      assertTurnSummaryCheckpointState(
        { ...SCOPE, checkpointRevision: 1, receipts: [receipt(2)] },
        "t",
      ),
    INVALID_STATE,
  );
  assert.throws(
    () =>
      assertTurnSummaryCheckpointState(
        { ...SCOPE, checkpointRevision: 2, receipts: [receipt(2), receipt(1)] },
        "t",
      ),
    INVALID_STATE,
  );
});
