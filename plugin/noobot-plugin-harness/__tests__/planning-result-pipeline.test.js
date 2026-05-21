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

test("planning result pipeline captures complete checklist directly", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText:
      '{"totalGoal":"完成任务","taskChecklist":[{"index":1,"task":"解析附件","owner":"primary_task_owner","input":"附件","output":"结果","files":{"create":[],"modify":[],"delete":[]}}]}',
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(result.sourceType, "model");
  assert.equal(result.checklistCount, 1);
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "model");
  assert.equal(ctx.agentContext.payload.harness.state.flags.planningCaptured, true);
});

test("planning result pipeline repairs malformed json via model invoker", async () => {
  const ctx = createCtx();
  const tracePurposes = [];
  const invokerPurposes = [];

  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: '{"taskChecklist":[{index:1,task:"解析附件"}]}',
    locale: LOCALE.ZH_CN,
    repairInvoker: async ({ purpose }) => {
      invokerPurposes.push(purpose);
      return {
        content:
          '{"totalGoal":"完成任务","taskChecklist":[{"index":1,"task":"解析附件","owner":"primary_task_owner","input":"附件","output":"结果","files":{"create":[],"modify":[],"delete":[]}}]}',
      };
    },
    appendCapabilityModelTraceLog: async (_ctx, _meta, payload = {}) => {
      tracePurposes.push(payload.purpose);
    },
  });

  assert.equal(result.captured, true);
  assert.equal(result.jsonRepairAttempted, true);
  assert.deepEqual(invokerPurposes, ["planning_json_repair"]);
  assert.deepEqual(tracePurposes, ["planning_json_repair"]);
});

test("planning result pipeline rejects incomplete payload and schedules retry", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: '{"taskChecklist":[{"index":1,"task":"解析附件","owner":"primary_task_owner"}]}',
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, false);
  assert.equal(result.retryScheduled, true);
  assert.equal(result.attempts, 1);
  assert.equal(ctx.agentContext.payload.harness.taskChecklist.length, 0);
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "none");
});

test("planning result pipeline applies default checklist when retry exhausted", async () => {
  const ctx = createCtx();
  ctx.agentContext.payload.harness.state = {
    counters: { planningCaptureAttempts: MAX_PLANNING_CAPTURE_ATTEMPTS - 1 },
    flags: {},
  };

  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: "先读取上下文后再规划。",
    locale: LOCALE.ZH_CN,
  });

  assert.equal(result.captured, true);
  assert.equal(result.retryScheduled, false);
  assert.equal(result.sourceType, "default");
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "default");
  assert.equal(ctx.agentContext.payload.harness.state.flags.planningCaptured, true);
});

test("planning result pipeline falls back immediately when json repair output unusable", async () => {
  const ctx = createCtx();
  const result = await processPlanningResult(ctx, {}, {
    source: "after_llm_call",
    rawText: '{"taskChecklist":[{bad json}]}',
    locale: LOCALE.ZH_CN,
    repairInvoker: async () => ({ content: "{}" }),
  });

  assert.equal(result.jsonRepairAttempted, true);
  assert.equal(result.retryScheduled, false);
  assert.equal(result.sourceType, "default");
  assert.equal(ctx.agentContext.payload.harness.taskChecklistSource, "default");
});
