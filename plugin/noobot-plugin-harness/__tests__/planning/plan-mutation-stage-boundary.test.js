/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createPlanRevisionHelpers } from "../../src/capabilities/handlers/shared/plan/revision-helpers.js";
import { buildPlanChecklistSystemContent } from "../../src/capabilities/handlers/shared/plan/checklist-context.js";
import {
  buildPlanningRefinementPromptText,
  buildPlanningRevisionPromptText,
} from "../../src/capabilities/handlers/shared/workflow/prompts.js";

const ORIGINAL_PLAN_TEXT = ["1. 主计划一", "1.1 子计划一", "2. 主计划二", "2.1 子计划二"].join(
  "\n",
);

function createFixture() {
  const logs = [];
  const ctx = {
    bucket: {
      planAcceptanceStatusByPlanId: {},
      planText: ORIGINAL_PLAN_TEXT,
      globalRevisionCount: 0,
      lastRevisionChangedMainStepIndexes: [],
      planRevisions: [],
    },
    state: { flags: {} },
  };
  const helpers = createPlanRevisionHelpers({
    CAPABILITY_DOMAIN: { PLANNING: "planning" },
    LOCALE: { ZH_CN: "zh-CN" },
    appendCapabilityLog: (_ctx, payload) => logs.push(payload),
    ensureHarnessBucket: (inputCtx = {}) => ({
      bucket: inputCtx.bucket,
      state: inputCtx.state,
    }),
  });
  return { ctx, helpers, logs };
}

test("revision rejects free text outside the patch protocol instead of appending it", () => {
  const { ctx, helpers } = createFixture();
  const applied = helpers.applyRevisedPlanFromText(ctx, "计划需要调整，但没有给出命令", {
    source: "planning_revision",
    stage: "revision",
  });
  assert.equal(applied, false);
  assert.equal(ctx.bucket.planText, ORIGINAL_PLAN_TEXT);
  assert.equal(ctx.bucket.globalRevisionCount, 0);
});

test("revision rejects sub-plan commands because revision only operates on main plan ids", () => {
  const { ctx, helpers } = createFixture();
  const applied = helpers.applyRevisedPlanFromText(ctx, "UPDATE [2.8] 标记完成", {
    source: "planning_revision",
    stage: "revision",
  });
  assert.equal(applied, false);
  assert.equal(ctx.bucket.planText, ORIGINAL_PLAN_TEXT);
});

test("refinement applies only sub-plan commands and leaves main plans untouched", () => {
  const { ctx, helpers } = createFixture();
  const applied = helpers.applyRevisedPlanFromText(
    ctx,
    ["UPDATE [2] 主计划二（越界修改）", "UPDATE [2.2] 子计划二-新增细化"].join("\n"),
    { source: "planning_refinement", stage: "refinement", targetMainStepIndexes: [2] },
  );
  assert.equal(applied, true);
  assert.match(ctx.bucket.planText, /^2\. 主计划二$/m);
  assert.doesNotMatch(ctx.bucket.planText, /越界修改/);
  assert.match(ctx.bucket.planText, /^2\.2 子计划二-新增细化$/m);
});

test("plan mutations keep planText as the only persisted plan fact", () => {
  const { ctx, helpers } = createFixture();
  const applied = helpers.applyRevisedPlanFromText(ctx, "UPDATE [1] 主计划一（已修正）", {
    source: "planning_revision",
    stage: "revision",
  });
  assert.equal(applied, true);
  assert.equal("planDocument" in ctx.bucket, false);
});

test("plan checklist context renders explicit planText and ignores a stale planDocument", () => {
  const content = buildPlanChecklistSystemContent({
    locale: "zh-CN",
    planText: "1. 当前主计划",
    bucket: {
      planAcceptanceStatusByPlanId: {},
      planDocument: { mainPlans: [{ id: 1, content: "过期主计划" }] },
    },
  });
  assert.match(String(content), /^1\. 当前主计划$/m);
  assert.doesNotMatch(String(content), /过期主计划/);
});

test("revision rejects a numbered main-plan list because revision only accepts patch commands", () => {
  const { ctx, helpers } = createFixture();
  const applied = helpers.applyRevisedPlanFromText(
    ctx,
    ["1. 新主计划一", "2. 新主计划二"].join("\n"),
    {
      source: "planning_revision",
      stage: "revision",
    },
  );
  assert.equal(applied, false);
  assert.equal(ctx.bucket.planText, ORIGINAL_PLAN_TEXT);
});

test("refinement passes target main plan ids down to the mutation execution layer", () => {
  const { ctx, helpers } = createFixture();
  const applied = helpers.applyRevisedPlanFromText(ctx, "ADD [1.2] 越界细化", {
    source: "planning_refinement",
    stage: "refinement",
    targetMainStepIndexes: [2],
  });
  assert.equal(applied, false);
  assert.equal(ctx.bucket.planText, ORIGINAL_PLAN_TEXT);
});

test("english revision and refinement prompts contain no chinese fallback text", () => {
  const revision = buildPlanningRevisionPromptText({
    locale: "en-US",
    marker: "<m>",
    data: { currentMainPlansText: "1. a" },
  });
  const refinement = buildPlanningRefinementPromptText({
    locale: "en-US",
    marker: "<m>",
    data: { targetIds: [1], targetPlansText: "1. a" },
  });
  assert.doesNotMatch(revision, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(refinement, /[\u4e00-\u9fff]/);
});

test("refinement targets converge to empty when every main step already has sub plans", () => {
  const { ctx, helpers } = createFixture();
  assert.deepEqual(helpers.resolveRefinementTargetMainSteps(ctx.bucket, ctx.state), []);
  ctx.bucket.planText = `${ORIGINAL_PLAN_TEXT}\n3. 主计划三`;
  assert.deepEqual(
    helpers.resolveRefinementTargetMainSteps(ctx.bucket, ctx.state).map((item) => item.index),
    [3],
  );
});

test("english refinement prompt localizes existing sub-plan sections", () => {
  const { helpers } = createFixture();
  const bucket = { planText: ["1. Inspect", "1.1 Read config", "2. Ship"].join("\n") };
  const prompt = helpers.buildPlanningRefinementPrompt(
    "en-US",
    bucket,
    {},
    {
      targetMainStepIndexes: [1, 2],
    },
  );
  assert.match(prompt, /Main plan 1:\n1\.1 Read config/);
  assert.match(prompt, /Main plan 2:\nN\/A/);
  assert.doesNotMatch(prompt, /[\u4e00-\u9fff\uff08\uff09]/);
});
