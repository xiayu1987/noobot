/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createTaskCheckTool } from "../../src/tools/collaboration/task-check-tool.js";

const checkContent = [
  "NOOBOT_TASK_CHECK/1",
  "[STATE]",
  "CONTINUE",
  "[ABSTRACT]",
  "任务目标未漂移。",
  "[DETAILS]",
  "当前进展符合目标，未发现遗漏。",
  "[NEXT_ACTION]",
  "继续下一项验证。",
].join("\n");

test("task_check returns only a receipt and creates no flow-control state", async () => {
  const systemRuntime = { taskCheckLoopCount: 10 };
  const [tool] = createTaskCheckTool({
    agentContext: { bindings: { runtime: { systemRuntime } } },
  });
  const payload = JSON.parse(await tool.invoke({ checkContent }));
  assert.equal(payload.toolName, "task_check");
  assert.equal(payload.protocolVersion, 1);
  assert.deepEqual(Object.keys(payload.summary).sort(), ["abstract", "contentHash", "nextAction", "state"]);
  assert.equal(JSON.stringify(payload).includes(checkContent), false);
  assert.equal(payload.summary.details, undefined);
  assert.equal(systemRuntime.taskCheckLoopCount, 0);
  assert.equal(systemRuntime.needsPhaseSummary, undefined);
  assert.equal(systemRuntime.mainFlowControlInstruction, undefined);
  assert.equal(systemRuntime.summaryCheckpointCommand, undefined);
});

test("task_check rejects non-protocol input without resetting its counter", async () => {
  const systemRuntime = { taskCheckLoopCount: 9 };
  const [tool] = createTaskCheckTool({
    agentContext: { bindings: { runtime: { systemRuntime } } },
  });
  await assert.rejects(
    tool.invoke({ checkContent: "普通检查文本" }),
    (error) => error?.code === "RECOVERABLE_INVALID_TOOL_INPUT",
  );
  assert.equal(systemRuntime.taskCheckLoopCount, 9);
});
