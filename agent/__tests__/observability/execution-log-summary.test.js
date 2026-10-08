/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { summarizeExecutionLogs } from "../../src/observability/execution-log/execution-log-summary.js";

test("summarizeExecutionLogs hides noisy system events from frontend steps", () => {
  const summary = summarizeExecutionLogs([
    {
      event: "thinking",
      category: "system",
      type: "system",
      data: { rawEvent: "model_selected" },
    },
    {
      event: "thinking",
      category: "system",
      type: "system",
      data: { rawEvent: "llm_call_start" },
    },
    {
      event: "thinking",
      category: "tool",
      type: "tool_call",
      data: {
        rawEvent: "tool_call_start",
        tool: "execute_script",
        args: { command: "cd /project/agent && npm test" },
      },
    },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.visibleTotal, 1);
  assert.equal(summary.returned, 1);
  assert.equal(summary.steps[0].text, "开始：执行命令：cd /project/agent && npm test");
});

test("summarizeExecutionLogs renders tool results as readable frontend text", () => {
  const summary = summarizeExecutionLogs([
    {
      event: "thinking",
      category: "tool",
      type: "tool_call",
      data: {
        rawEvent: "tool_call_start",
        tool: "read_file",
        args: { filePath: "/project/agent/package.json" },
      },
    },
    {
      event: "thinking",
      category: "tool",
      type: "tool_result",
      data: {
        rawEvent: "tool_call_end",
        tool: "read_file",
        args: { filePath: "/project/agent/package.json" },
        ok: true,
      },
    },
  ]);

  assert.deepEqual(
    summary.steps.map((step) => step.text),
    ["开始：读取文件：/project/agent/package.json", "完成：读取文件：/project/agent/package.json"],
  );
  assert.equal(summary.toolCallCount, 1);
  assert.equal(summary.toolResultCount, 1);
});

function toolLog(phase, tool, toolCallId, extra = {}) {
  return {
    event: phase === "call" ? "tool_call_start" : "tool_call_end",
    category: "tool",
    type: phase === "call" ? "tool_call" : "tool_result",
    data: { tool, toolCallId, ...extra },
  };
}

test("summarizeExecutionLogs counts all visible logs beyond the step window", () => {
  const logs = [];
  for (let index = 0; index < 60; index += 1) {
    logs.push(toolLog("call", "read_file", `call-${index}`));
    logs.push(toolLog("result", "read_file", `call-${index}`, { success: true }));
  }
  const summary = summarizeExecutionLogs(logs, { maxSteps: 80 });

  assert.equal(summary.returned, 80);
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
    toolLog("result", "search", "call-2", { ok: false }),
  ]);

  assert.equal(summary.toolResultCount, 2);
  assert.equal(summary.errorCount, 2);
  assert.equal(summary.steps[1].text, "失败：执行命令");
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
