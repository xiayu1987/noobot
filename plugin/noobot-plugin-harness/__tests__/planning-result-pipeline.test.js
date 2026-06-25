/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { WORKFLOW_PARAMS } from "../src/core/workflow-params.js";
import { LOCALE } from "../src/capabilities/handlers/shared.js";
import { processPlanningResult } from "../src/capabilities/handlers/planning/result-pipeline.js";

const MAX_PLANNING_CAPTURE_ATTEMPTS = WORKFLOW_PARAMS.planning.capture.maxAttempts;

function createCtx() {
  return {
    agentContext: {
      payload: {
        harness: {},
      },
    },
  };
}

test("workflow params define plan refinement defaults by scenario mode", () => {
  assert.equal(WORKFLOW_PARAMS.modeThresholds.full.planning.planRefinement.enabled, true);
  assert.equal(WORKFLOW_PARAMS.modeThresholds.text.planning.planRefinement.enabled, true);
  assert.equal(WORKFLOW_PARAMS.modeThresholds.programming.planning.planRefinement.enabled, false);
});

test("planning result pipeline captures plan text directly", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: "1. 解析附件\n2. 执行核心任务",
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(result.sourceType, "plan_text");
  assert.equal(result.checklistCount, 2);
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "plan_text");
  assert.equal(ctx.agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRefinement, true);
  assert.deepEqual(
    ctx.agentContext.payload.harness.state.pending.planRefinementContext.targetMainStepIndexes,
    [1, 2],
  );
});

test("planning result pipeline disables plan refinement by default in programming scenario", async () => {
  assert.equal(WORKFLOW_PARAMS.modeThresholds.programming.planning.planRefinement.enabled, false);

  const ctx = createCtx();
  ctx.runConfig = {
    scenarioProfile: { key: "programming", name: "编程" },
  };

  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: "1. 解析附件\n2. 执行核心任务",
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planningCaptured, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, false);
  assert.notEqual(ctx.agentContext.payload.harness.state.pending.planRefinement, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRefinementContext, null);
});

test("planning result pipeline allows explicit plan refinement enablement in programming scenario", async () => {
  const ctx = createCtx();
  ctx.runConfig = {
    scenarioProfile: { key: "programming", name: "编程" },
  };

  const result = await processPlanningResult(ctx, { harness: { planRefinementEnabled: true } }, {
    source: "after_llm_call",
    rawText: "1. 解析附件\n2. 执行核心任务",
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRefinement, true);
  assert.deepEqual(
    ctx.agentContext.payload.harness.state.pending.planRefinementContext.targetMainStepIndexes,
    [1, 2],
  );
});

test("planning result pipeline honors explicit plan refinement disablement outside programming scenario", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, { harness: { planRefinementEnabled: false } }, {
    source: "after_llm_call",
    rawText: "1. 解析附件\n2. 执行核心任务",
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.notEqual(ctx.agentContext.payload.harness.state.pending.planRefinement, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRefinementContext, null);
});

test("planning result pipeline enables plan refinement by default in text scenario", async () => {
  assert.equal(WORKFLOW_PARAMS.modeThresholds.text.planning.planRefinement.enabled, true);

  const ctx = createCtx();
  ctx.runConfig = {
    scenarioProfile: { key: "text", name: "文本" },
  };
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: "1. 梳理文本\n2. 输出结果",
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRefinement, true);
  assert.deepEqual(ctx.agentContext.payload.harness.state.pending.planRefinementContext.targetMainStepIndexes, [1, 2]);
});

test("planning result pipeline supports ID+PATCH main plan text", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: "ADD [1] 解析附件\nADD [2] 执行核心任务",
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(result.sourceType, "plan_text");
  assert.equal(result.checklistCount, 2);
  assert.match(String(ctx.agentContext.payload.harness.planText || ""), /^1\. 解析附件/m);
  assert.match(String(ctx.agentContext.payload.harness.planText || ""), /^2\. 执行核心任务/m);
});

test("planning result pipeline extracts current task goal from planning text protocol", async () => {
  const ctx = createCtx();
  ctx.dialogProcessId = "planning-dp";
  ctx.messages = [{ role: "user", content: "开始任务" }];
  const persisted = [];
  ctx.agentContext.execution = {
    controllers: {
      runtime: {
        currentTurnMessages: {
          push(message) {
            persisted.push(message);
          },
        },
      },
    },
  };
  const result = await processPlanningResult(ctx, {}, {
    source: "separate_model",
    rawText: [
      "[CURRENT_TASK_GOAL]",
      "由计划模型确认的当前任务目标",
      "[PLAN]",
      "ADD [1] 解析附件",
      "ADD [2] 执行核心任务",
    ].join("\n"),
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(ctx.agentContext.payload.harness.currentTaskGoal, "由计划模型确认的当前任务目标");
  const injectedGoalMessage = ctx.messages.find((item = {}) =>
    String(item?.injectedMessageType || "") === "planning_current_task_goal"
  );
  assert.equal(injectedGoalMessage?.role, "system");
  assert.equal(injectedGoalMessage?.injectedMessage, true);
  assert.equal(injectedGoalMessage?.injectedBy, "harness-plugin");
  assert.equal(injectedGoalMessage?.dialogProcessId, "planning-dp");
  assert.ok(injectedGoalMessage?.additional_kwargs?.noobotMessageId);
  assert.equal(
    ctx.messageBlocks.incrementalIds.includes(injectedGoalMessage.additional_kwargs.noobotMessageId),
    true,
  );
  assert.match(String(injectedGoalMessage?.content || ""), /\[CURRENT_TASK_GOAL\]/);
  assert.match(String(injectedGoalMessage?.content || ""), /由计划模型确认的当前任务目标/);
  assert.equal(
    persisted.some((item = {}) =>
      String(item?.injectedMessageType || "") === "planning_current_task_goal"
    ),
    true,
  );
  assert.match(String(ctx.agentContext.payload.harness.planText || ""), /^1\. 解析附件/m);
  assert.doesNotMatch(String(ctx.agentContext.payload.harness.planText || ""), /CURRENT_TASK_GOAL/);
});

test("planning result pipeline schedules retry when payload has no main plan", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: '{"taskChecklist":[{index:1,task:"解析附件"}]}',
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, false);
  assert.equal(result.retryScheduled, true);
  assert.equal(result.jsonRepairAttempted, false);
  assert.equal(result.sourceType, "none");
});

test("planning result pipeline rejects sub-plan-only patch payload", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: "UPDATE 2.8 标记完成\nUPDATE 2.9 标记完成",
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, false);
  assert.equal(result.retryScheduled, true);
  assert.equal(result.sourceType, "none");
});

test("planning result pipeline applies default checklist when retry exhausted", async () => {
  const ctx = createCtx();
  ctx.agentContext.payload.harness.state = {
    counters: { planningCaptureAttempts: MAX_PLANNING_CAPTURE_ATTEMPTS - 1 },
    flags: {},
  };

  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: "",
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(result.retryScheduled, false);
  assert.equal(result.sourceType, "default");
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "plan_text");
  assert.equal(ctx.agentContext.payload.harness.state.flags.planningCaptured, true);
  const logs = Array.isArray(ctx.agentContext.payload.harness.logs?.planning)
    ? ctx.agentContext.payload.harness.logs.planning
    : [];
  const event = logs.find((item = {}) => item?.event === "planning_default_checklist_applied");
  assert.equal(event?.detail?.reason, "planning_retry_exhausted");
  assert.equal(event?.detail?.reasonLabel, "规划重试次数耗尽，使用默认主计划");
});

test("planning result pipeline keeps waiting when malformed payload is non-empty", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: '{"taskChecklist":[{bad json}]}',
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.jsonRepairAttempted, false);
  assert.equal(result.retryScheduled, true);
  assert.equal(result.sourceType, "none");
});

test("planning result pipeline records english fallback reason label", async () => {
  const ctx = createCtx();
  ctx.agentContext.payload.harness.state = {
    counters: { planningCaptureAttempts: MAX_PLANNING_CAPTURE_ATTEMPTS - 1 },
    flags: {},
  };

  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: '{"taskChecklist":[{bad json}]}',
    locale: LOCALE.EN_US,
  });

  assert.equal(result.captured, true);
  assert.equal(result.sourceType, "default");
  const logs = Array.isArray(ctx.agentContext.payload.harness.logs?.planning)
    ? ctx.agentContext.payload.harness.logs.planning
    : [];
  const event = logs.find((item = {}) => item?.event === "planning_default_checklist_applied");
  assert.equal(event?.detail?.reason, "planning_invalid_nonempty_response");
  assert.match(
    String(event?.detail?.reasonLabel || ""),
    /fallback to default main plan/i,
  );
});
