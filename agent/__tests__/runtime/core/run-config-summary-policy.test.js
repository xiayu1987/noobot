/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import {
  resolvePhaseSummaryLoopTurns,
  resolveTaskCheckLoopTurns,
} from "../../../src/runtime/run-config/config-resolver.js";

test("phase summary loop threshold requires the explicit frontend threshold mode", () => {
  assert.equal(
    resolvePhaseSummaryLoopTurns({
      runConfig: { summaryPolicy: { phaseSummaryLoopTurns: 1 } },
    }),
    TURN_THRESHOLDS.agent.phaseSummaryLoopTurns,
  );
  assert.equal(
    resolvePhaseSummaryLoopTurns({
      runConfig: {
        frontendThresholdsEnabled: true,
        summaryPolicy: { phaseSummaryLoopTurns: 1 },
      },
    }),
    1,
  );
  assert.equal(
    resolvePhaseSummaryLoopTurns({
      runConfig: {
        phaseSummaryLoopTurns: 2,
        pluginModelConfig: { harness: { phaseSummaryLoopTurns: 3 } },
      },
    }),
    TURN_THRESHOLDS.agent.phaseSummaryLoopTurns,
  );
});

test("task check threshold requires the explicit frontend threshold mode", () => {
  assert.equal(
    resolveTaskCheckLoopTurns({
      runConfig: { summaryPolicy: { taskCheckLoopTurns: 2 } },
    }),
    TURN_THRESHOLDS.agent.taskCheckLoopTurns,
  );
  assert.equal(
    resolveTaskCheckLoopTurns({
      runConfig: {
        frontendThresholdsEnabled: true,
        summaryPolicy: { taskCheckLoopTurns: 2 },
      },
    }),
    2,
  );
  assert.equal(
    resolveTaskCheckLoopTurns({
      runConfig: { taskCheckLoopTurns: 1, pluginModelConfig: { taskCheckLoopTurns: 3 } },
    }),
    TURN_THRESHOLDS.agent.taskCheckLoopTurns,
  );
  assert.equal(resolveTaskCheckLoopTurns(), TURN_THRESHOLDS.agent.taskCheckLoopTurns);
});

test("phase summary loop threshold preserves the builtin default when absent", () => {
  assert.equal(resolvePhaseSummaryLoopTurns(), TURN_THRESHOLDS.agent.phaseSummaryLoopTurns);
});

test("summary and task check reject declared invalid thresholds even when the gate is closed", () => {
  for (const frontendThresholdsEnabled of [false, true]) {
    for (const invalid of [null, "2", 0, -1, 1.5, Infinity]) {
      for (const [resolve, field] of [
        [resolvePhaseSummaryLoopTurns, "phaseSummaryLoopTurns"],
        [resolveTaskCheckLoopTurns, "taskCheckLoopTurns"],
      ]) {
        const runConfig = { frontendThresholdsEnabled, summaryPolicy: { [field]: invalid } };
        assert.throws(() => resolve({ runConfig }), /positive safe integer/);
        assert.equal(runConfig.summaryPolicy[field], invalid);
      }
    }
  }
});
