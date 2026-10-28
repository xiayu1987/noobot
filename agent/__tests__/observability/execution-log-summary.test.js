/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { summarizeExecutionLogs } from "../../src/observability/execution-log/execution-log-summary.js";

function toolLog(phase, tool, toolCallId, extra = {}) {
  return {
    event: phase === "call" ? "tool_call_start" : "tool_call_end",
    category: "tool",
    type: phase === "call" ? "tool_call" : "tool_result",
    data:
      phase === "call"
        ? { tool, toolCallId, ...extra }
        : { tool, toolCallId, durationMs: 1, persistDurationMs: 0, ...extra },
  };
}

test("summarizeExecutionLogs only counts tool, error and semantic transfer logs as visible", () => {
  const summary = summarizeExecutionLogs([
    { event: "model_selected", category: "system", type: "system", data: {} },
    { event: "llm_call_start", category: "system", type: "system", data: {} },
    toolLog("call", "execute_script", "call-1", { args: { command: "npm test" } }),
    { event: "tool_call_start", category: "tool", type: "tool_call", data: {} },
    { event: "error", category: "error", type: "error", data: {} },
  ]);

  assert.deepEqual(Object.keys(summary).sort(), [
    "errorCount",
    "metrics",
    "toolCallCount",
    "toolResultCount",
    "visibleTotal",
  ]);
  assert.equal(summary.visibleTotal, 2);
  assert.equal(summary.toolCallCount, 1);
  assert.equal(summary.errorCount, 1);
});

test("summarizeExecutionLogs counts every visible tool log", () => {
  const logs = [];
  for (let index = 0; index < 60; index += 1) {
    logs.push(toolLog("call", "read_file", `call-${index}`));
    logs.push(toolLog("result", "read_file", `call-${index}`, { success: true }));
  }
  const summary = summarizeExecutionLogs(logs);

  assert.equal(summary.toolCallCount, 60);
  assert.equal(summary.toolResultCount, 60);
  assert.equal(summary.errorCount, 0);
  assert.equal("toolStats" in summary, false);
});

test("summarizeExecutionLogs treats unsuccessful tool results as errors", () => {
  const summary = summarizeExecutionLogs([
    toolLog("call", "execute_script", "call-1"),
    toolLog("result", "execute_script", "call-1", { success: false }),
    toolLog("call", "search", "call-2"),
    toolLog("result", "search", "call-2", { success: true }),
  ]);

  assert.equal(summary.toolResultCount, 2);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.metrics.tools.toolStats.execute_script.failures, 1);
  assert.equal(summary.metrics.tools.toolStats.search.failures, 0);
});

test("summarizeExecutionLogs de-duplicates replayed tool events by toolCallId", () => {
  const summary = summarizeExecutionLogs([
    toolLog("call", "read_file", "call-1"),
    toolLog("call", "read_file", "call-1"),
    toolLog("result", "read_file", "call-1", { success: false }),
    toolLog("result", "read_file", "call-1", { success: false }),
  ]);

  assert.equal(summary.toolCallCount, 1);
  assert.equal(summary.toolResultCount, 1);
  assert.equal(summary.errorCount, 1);
});
