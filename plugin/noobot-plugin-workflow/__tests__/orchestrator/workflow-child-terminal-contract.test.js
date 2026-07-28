/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveCommittedChildTerminal } from "../../src/core/orchestrator/execution-runner.js";

function receipt(overrides = {}) {
  return {
    lifecycle: {
      executionId: "agent:child-1",
      executionKind: "agent",
      state: "completed",
      revision: 3,
      sequence: 5,
      ...overrides,
    },
  };
}

test("maps only committed child terminal lifecycle states to workflow node terminals", () => {
  assert.equal(resolveCommittedChildTerminal(receipt(), "agent:child-1").nodeStatus, "succeeded");
  assert.equal(resolveCommittedChildTerminal(receipt({ state: "stop_completed" }), "agent:child-1").nodeStatus, "stopped");
  for (const state of ["action_failed", "processing_failed", "completion_failed", "stop_failed"]) {
    assert.equal(resolveCommittedChildTerminal(receipt({ state }), "agent:child-1").nodeStatus, "failed");
  }
});

test("rejects missing, mismatched, non-terminal and malformed child receipts", () => {
  const cases = [
    [{}, "missing_lifecycle"],
    [receipt({ executionId: "agent:old-attempt" }), "execution_identity_mismatch"],
    [receipt({ executionKind: "workflow" }), "execution_kind_mismatch"],
    [receipt({ state: "processing" }), "non_terminal_state"],
    [receipt({ revision: 0 }), "invalid_revision"],
    [receipt({ revision: "3" }), "invalid_revision"],
    [receipt({ revision: 1.5 }), "invalid_revision"],
    [receipt({ sequence: 0 }), "invalid_sequence"],
    [receipt({ sequence: "5" }), "invalid_sequence"],
    [receipt({ sequence: 2.5 }), "invalid_sequence"],
  ];

  for (const [candidate, reason] of cases) {
    assert.throws(
      () => resolveCommittedChildTerminal(candidate, "agent:child-1"),
      (error) => {
        assert.equal(error?.code, "WORKFLOW_CHILD_TERMINAL_RECEIPT_INVALID");
        assert.equal(error?.receiptReason, reason);
        assert.equal(error?.nodeTerminalReceiptRejected, true);
        return true;
      },
    );
  }
});

