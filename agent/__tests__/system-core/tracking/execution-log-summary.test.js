import test from "node:test";
import assert from "node:assert/strict";

import { summarizeExecutionLogs } from "../../../src/system-core/tracking/execution-log/execution-log-summary.js";

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
    [
      "开始：读取文件：/project/agent/package.json",
      "完成：读取文件：/project/agent/package.json",
    ],
  );
  assert.equal(summary.toolCallCount, 1);
  assert.equal(summary.toolResultCount, 1);
});
