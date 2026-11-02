/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { admitWorkflowSessionSnapshot } from "../src/workflow-runtime-event.js";

function consumer() {
  const state = { sequence: 0, timing: null };
  return {
    state,
    applyTurnLifecycleSnapshot({ sequence }) {
      if (sequence < state.sequence) return { applied: false, reason: "stale_snapshot" };
      const deduplicated = sequence === state.sequence;
      state.sequence = sequence;
      return { applied: !deduplicated, deduplicated };
    },
    applyTurnTimingSnapshot({ turnTimings }) {
      if (state.timing !== null && turnTimings[0] !== state.timing) {
        throw new Error("timing_conflict");
      }
      state.timing = turnTimings[0];
      return { applied: true };
    },
  };
}

function admit(target, sequence, version, timing, appliedAggregateVersion) {
  return admitWorkflowSessionSnapshot({
    ...target,
    appliedAggregateVersion,
    snapshot: {
      sessionId: "child",
      aggregateVersion: version,
      turnLifecycleSnapshot: { sequence },
      turnTimings: [timing],
    },
  });
}

test("message version does not gate lifecycle or timing domains", () => {
  for (const version of [2, 3]) {
    const target = consumer();
    const result = admit(target, 1, version, 4, 3);
    assert.equal(result.admitted, false);
    assert.equal(result.reason, version === 3 ? "duplicate_snapshot_version" : "stale_snapshot");
    assert.deepEqual(target.state, { sequence: 1, timing: 4 });
  }
});

test("stale lifecycle gates later domains", () => {
  const target = consumer();
  admit(target, 3, 1, 4);
  assert.equal(admit(target, 2, 2, 5, 1).admitted, false);
  assert.deepEqual(target.state, { sequence: 3, timing: 4 });
});

test("timing rejection preserves accepted lifecycle and permits corrected replay", () => {
  const target = consumer();
  admit(target, 1, 1, 4);
  assert.throws(() => admit(target, 2, 2, 5, 1), /timing_conflict/);
  assert.deepEqual(target.state, { sequence: 2, timing: 4 });
  assert.equal(admit(target, 2, 2, 4, 1).admitted, true);
});
