/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { summarizeExecutionMetrics } from "../../src/observability/execution-log/execution-report-metrics.js";

const at = (seconds) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
const log = (event, seconds, data = {}) => ({ event, ts: at(seconds), data });

test("summarizeExecutionMetrics aggregates model calls, retries and switches", () => {
  const metrics = summarizeExecutionMetrics([
    log("llm_call_start", 0, { modelLoopRound: 1 }),
    log("model.invocation.started", 0, { model: { alias: "m1", model: "m-1" } }),
    log("model.invocation.completed", 1, { attemptCount: 3 }),
    log("llm_call_end", 1, { hasToolCalls: true }),
    log("model_switched", 2, { alias: "m2" }),
    log("llm_call_start", 2, { modelLoopRound: 4 }),
    log("model.invocation.started", 2, { model: { model: "m-2" } }),
    log("model.invocation.completed", 3, { attemptCount: 1 }),
    log("llm_call_end", 3, { hasToolCalls: false }),
  ]);
  assert.deepEqual(metrics.model, {
    llmCalls: 2,
    llmCallsWithTools: 1,
    maxLoopRound: 4,
    invocations: 2,
    retries: 2,
    switches: 1,
    models: { m1: 1, "m-2": 1 },
  });
});

test("summarizeExecutionMetrics pairs tool calls by id and uses end risk level", () => {
  const metrics = summarizeExecutionMetrics([
    log("tool_call_start", 0, {
      tool: "read_file",
      toolCallId: "a",
      riskLevel: "low",
      args: { filePath: "src/a.js" },
    }),
    log("tool_call_start", 1, {
      tool: "execute_script",
      toolCallId: "b",
      riskLevel: "medium",
      args: { command: "npm test" },
    }),
    log("tool_call_end", 2, {
      tool: "read_file",
      toolCallId: "a",
      success: true,
      riskLevel: "low",
    }),
    log("tool_call_end", 6, {
      tool: "execute_script",
      toolCallId: "b",
      success: false,
      riskLevel: "critical",
    }),
    log("tool_call_start", 7, { tool: "search", toolCallId: "c" }),
  ]);
  assert.deepEqual(metrics.tools.toolStats, {
    read_file: { calls: 1, failures: 0, timedCount: 1, totalDurationMs: 2000, maxDurationMs: 2000 },
    execute_script: {
      calls: 1,
      failures: 1,
      timedCount: 1,
      totalDurationMs: 5000,
      maxDurationMs: 5000,
    },
    search: { calls: 1, failures: 0, timedCount: 0, totalDurationMs: 0, maxDurationMs: 0 },
  });
  assert.deepEqual(metrics.tools.riskLevels, { low: 1, critical: 1 });
  assert.equal(metrics.tools.totalToolDurationMs, 7000);
  assert.deepEqual(
    metrics.tools.slowestToolCalls.map(({ toolCallId, subject, success }) => [
      toolCallId,
      subject,
      success,
    ]),
    [
      ["b", "npm test", false],
      ["a", "src/a.js", true],
    ],
  );
});

test("summarizeExecutionMetrics counts one failure per toolCallId despite extra error logs", () => {
  const metrics = summarizeExecutionMetrics([
    log("tool_call_start", 0, { tool: "execute_script", toolCallId: "x" }),
    log("tool_error", 1, { tool: "execute_script", toolCallId: "x", message: "boom" }),
    log("tool_call_end", 2, { tool: "execute_script", toolCallId: "x", success: false }),
    log("tool_call_end", 2, { tool: "execute_script", toolCallId: "x", success: false }),
  ]);
  assert.deepEqual(metrics.tools.toolStats.execute_script, {
    calls: 1,
    failures: 1,
    timedCount: 1,
    totalDurationMs: 2000,
    maxDurationMs: 2000,
  });
});

test("summarizeExecutionMetrics sums hooks and measures context build time", () => {
  const metrics = summarizeExecutionMetrics([
    log("context_building", 0),
    log("hook_summary", 1, { durationMs: 20, errorCount: 0 }),
    log("hook_summary", 1, { durationMs: 5, errorCount: 2 }),
    log("context_ready", 3),
  ]);
  assert.deepEqual(metrics.hooks, { count: 2, errorCount: 2, totalDurationMs: 25 });
  assert.equal(metrics.phases.contextBuildMs, 3000);
});

test("summarizeExecutionMetrics returns empty aggregates for no logs", () => {
  const metrics = summarizeExecutionMetrics();
  assert.equal(metrics.model.llmCalls, 0);
  assert.deepEqual(metrics.tools.slowestToolCalls, []);
  assert.equal(metrics.phases.contextBuildMs, null);
});
