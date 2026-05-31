/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MAX_PLANNING_CAPTURE_ATTEMPTS } from "../src/core/thresholds.js";
import { LOCALE } from "../src/capabilities/handlers/shared.js";
import { processPlanningResult } from "../src/capabilities/handlers/planning/result-pipeline.js";

function createCtx() {
  return {
    agentContext: {
      payload: {
        harness: {},
      },
    },
  };
}

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
  assert.equal(ctx.agentContext.payload.harness.state.pending.planUpdate, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planUpdateStage, "refinement");
  assert.deepEqual(
    ctx.agentContext.payload.harness.state.pending.planUpdateContext.targetMainStepIndexes,
    [1, 2],
  );
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

test("planning result pipeline treats malformed text as plan text when non-empty", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: '{"taskChecklist":[{index:1,task:"解析附件"}]}',
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(result.jsonRepairAttempted, false);
  assert.equal(result.sourceType, "plan_text");
});

test("planning result pipeline captures non-empty payload without retry", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: '{"taskChecklist":[{"index":1,"task":"解析附件","owner":"primary_task_owner"}]}',
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(result.retryScheduled, false);
  assert.equal(result.sourceType, "plan_text");
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "plan_text");
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
});

test("planning result pipeline keeps malformed json text when non-empty", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: '{"taskChecklist":[{bad json}]}',
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.jsonRepairAttempted, false);
  assert.equal(result.retryScheduled, false);
  assert.equal(result.sourceType, "plan_text");
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "plan_text");
});
