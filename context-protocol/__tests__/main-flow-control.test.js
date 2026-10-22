/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  MAIN_FLOW_CONTROL_ACTION,
  MAIN_FLOW_CONTROL_REASON,
  assertMainFlowControlPort,
  createFinalNoToolsTurnInstruction,
  createSummaryCheckpointInstruction,
} from "../src/policy/main-flow-control.js";

test("summary checkpoint instruction carries canonical session message uids", () => {
  const instruction = createSummaryCheckpointInstruction({
    source: "plugin.summary",
    summarizedMessageUids: ["sm_a", "sm_b"],
  });
  assert.deepEqual(instruction, {
    action: MAIN_FLOW_CONTROL_ACTION.SUMMARY_CHECKPOINT,
    source: "plugin.summary",
    summarizedMessageUids: ["sm_a", "sm_b"],
  });
  assert.ok(Object.isFrozen(instruction));
});

test("summary checkpoint instruction rejects malformed input", () => {
  const cases = [
    { summarizedMessageUids: ["sm_a"] },
    { source: "x" },
    { source: "x", summarizedMessageUids: [] },
    { source: "x", summarizedMessageUids: ["sm_a", ""] },
    { source: "x", summarizedMessageUids: ["sm_a", "sm_a"] },
  ];
  for (const input of cases) {
    assert.throws(() => createSummaryCheckpointInstruction(input), TypeError);
  }
});

test("final no-tools turn instruction requires a known reason and source", () => {
  const instruction = createFinalNoToolsTurnInstruction({
    reason: MAIN_FLOW_CONTROL_REASON.TASK_SUMMARY_COMPLETE,
    source: "task_summary",
    detail: { state: "COMPLETE" },
  });
  assert.equal(instruction.action, MAIN_FLOW_CONTROL_ACTION.FINAL_NO_TOOLS_TURN);
  assert.equal(instruction.reason, MAIN_FLOW_CONTROL_REASON.TASK_SUMMARY_COMPLETE);
  assert.equal(instruction.source, "task_summary");
  assert.deepEqual(instruction.detail, { state: "COMPLETE" });
  assert.ok(instruction.requestedAt);

  assert.throws(() => createFinalNoToolsTurnInstruction({ source: "x" }), TypeError);
  assert.throws(
    () => createFinalNoToolsTurnInstruction({ reason: "unknown", source: "x" }),
    TypeError,
  );
  assert.throws(
    () =>
      createFinalNoToolsTurnInstruction({
        reason: MAIN_FLOW_CONTROL_REASON.TASK_SUMMARY_BLOCKED,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      createFinalNoToolsTurnInstruction({
        reason: MAIN_FLOW_CONTROL_REASON.TASK_SUMMARY_BLOCKED,
        source: "x",
        detail: null,
      }),
    TypeError,
  );
});

test("main flow control port must expose every declared method", () => {
  const port = {
    requestSummaryCheckpoint() {},
    isFinalNoToolsTurnEngaged() {
      return false;
    },
  };
  assert.equal(assertMainFlowControlPort(port), port);
  assert.throws(() => assertMainFlowControlPort(null), TypeError);
  assert.throws(
    () => assertMainFlowControlPort({ requestSummaryCheckpoint() {} }),
    /isFinalNoToolsTurnEngaged/,
  );
});
