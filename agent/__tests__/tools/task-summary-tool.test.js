/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTaskSummaryTool } from "../../src/tools/collaboration/task-summary-tool.js";

function summaryContent(state = "CONTINUE") {
  return [
    "NOOBOT_TASK_SUMMARY/1",
    "[STATE]",
    state,
    "[ABSTRACT]",
    "协议实现已完成。",
    "[DETAILS]",
    "唯一解析器、工具回执和状态控制已经实现并完成确定性验证。",
    "[NEXT_ACTION]",
    state === "CONTINUE" ? "继续浏览器验证。" : state === "COMPLETE" ? "输出最终结果。" : "说明无法继续的原因。",
  ].join("\n");
}

function createTool() {
  const systemRuntime = {
    needsPhaseSummary: true,
    phaseSummaryLoopCount: 3,
  };
  const runtime = { systemRuntime };
  const [tool] = createTaskSummaryTool({
    agentContext: { bindings: { runtime } },
  });
  return { tool, runtime, systemRuntime };
}

test("task_summary returns only the derived receipt for CONTINUE", async () => {
  const { tool, systemRuntime } = createTool();
  const fullContent = summaryContent();
  const payload = JSON.parse(await tool.invoke({ summaryContent: fullContent }));

  assert.equal(payload.toolName, "task_summary");
  assert.equal(payload.protocolVersion, 1);
  assert.deepEqual(Object.keys(payload.summary).sort(), ["abstract", "contentHash", "nextAction", "state"]);
  assert.equal(payload.summary.state, "CONTINUE");
  assert.match(payload.summary.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(payload).includes(fullContent), false);
  assert.equal(payload.summary.details, undefined);
  assert.equal(systemRuntime.mainFlowControlInstruction, undefined);
  assert.equal(systemRuntime.needsPhaseSummary, false);
  assert.equal(systemRuntime.phaseSummaryLoopCount, 0);
});

for (const [state, reason] of [
  ["COMPLETE", "task_summary_complete"],
  ["BLOCKED", "task_summary_blocked"],
]) {
  test(`task_summary ${state} requests the canonical final no-tools turn`, async () => {
    const { tool, systemRuntime } = createTool();
    const payload = JSON.parse(await tool.invoke({ summaryContent: summaryContent(state) }));
    assert.equal(payload.summary.state, state);
    assert.equal(systemRuntime.mainFlowControlInstruction.action, "final_no_tools_turn");
    assert.equal(systemRuntime.mainFlowControlInstruction.reason, reason);
    assert.equal(systemRuntime.mainFlowControlInstruction.source, "task_summary");
    assert.deepEqual(systemRuntime.mainFlowControlInstruction.detail, payload.summary);
  });
}

test("task_summary rejects non-protocol text without mutating summary state", async () => {
  const { tool, systemRuntime } = createTool();
  await assert.rejects(
    tool.invoke({ summaryContent: "普通自由文本小结" }),
    (error) => error?.code === "RECOVERABLE_INVALID_TOOL_INPUT",
  );
  assert.equal(systemRuntime.needsPhaseSummary, true);
  assert.equal(systemRuntime.phaseSummaryLoopCount, 3);
  assert.equal(systemRuntime.mainFlowControlInstruction, undefined);
});
