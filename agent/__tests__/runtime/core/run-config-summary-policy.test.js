/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_THRESHOLDS } from "../../../src/config/index.js";
import {
  resolvePhaseSummaryLoopTurns,
  resolveTaskCheckLoopTurns,
} from "../../../src/runtime/run-config/config-resolver.js";

test("phase summary loop threshold comes only from the canonical run summary policy", () => {
  assert.equal(
    resolvePhaseSummaryLoopTurns({
      runConfig: { summaryPolicy: { phaseSummaryLoopTurns: 1 } },
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
    BUILTIN_THRESHOLDS.taskSummary.phaseSummaryLoopTurns,
  );
});

test("task check threshold comes only from the canonical run summary policy", () => {
  assert.equal(resolveTaskCheckLoopTurns({
    runConfig: { summaryPolicy: { taskCheckLoopTurns: 2 } },
  }), 2);
  assert.equal(resolveTaskCheckLoopTurns({
    runConfig: { taskCheckLoopTurns: 1, pluginModelConfig: { taskCheckLoopTurns: 3 } },
  }), BUILTIN_THRESHOLDS.taskCheck.taskCheckLoopTurns);
  assert.equal(resolveTaskCheckLoopTurns(), 10);
});

test("main phase summary builtin threshold is twenty turns", () => {
  assert.equal(BUILTIN_THRESHOLDS.taskSummary.phaseSummaryLoopTurns, 20);
});

test("phase summary loop threshold preserves the builtin default when absent", () => {
  assert.equal(
    resolvePhaseSummaryLoopTurns(),
    BUILTIN_THRESHOLDS.taskSummary.phaseSummaryLoopTurns,
  );
});
