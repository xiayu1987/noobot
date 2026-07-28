/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createPlanRevisionHelpers } from "../src/capabilities/handlers/shared/plan/revision-helpers.js";

test("planning revision full-main replacement preserves existing first-level sub-plans for retained main steps", () => {
  const ctx = {
    bucket: {
      planText: [
        "1. 旧主计划一",
        "1.1 旧子计划一",
        "2. 旧主计划二",
        "2.1 旧子计划二",
      ].join("\n"),
      globalRevisionCount: 0,
      lastRevisionChangedMainStepIndexes: [],
      planRevisions: [],
    },
    state: { flags: {} },
  };
  const helpers = createPlanRevisionHelpers({
    CAPABILITY_DOMAIN: { PLANNING: "planning" },
    LOCALE: { ZH_CN: "zh-CN" },
    appendCapabilityLog: () => {},
    ensureHarnessBucket: (inputCtx = {}) => ({
      bucket: inputCtx.bucket,
      state: inputCtx.state,
    }),
  });

  const applied = helpers.applyRevisedPlanFromText(
    ctx,
    [
      "1. 新主计划一",
      "2. 新主计划二",
    ].join("\n"),
    { source: "planning_revision", stage: "revision" },
  );

  assert.equal(applied, true);
  assert.match(String(ctx.bucket.planText || ""), /^1\. 新主计划一/m);
  assert.match(String(ctx.bucket.planText || ""), /^2\. 新主计划二/m);
  assert.match(String(ctx.bucket.planText || ""), /^1\.1 旧子计划一/m);
  assert.match(String(ctx.bucket.planText || ""), /^2\.1 旧子计划二/m);
});

test("planning revision with sub-plan-only patch applies sub-plan updates without collapsing full main plan", () => {
  const originalPlanText = [
    "1. 主计划一",
    "1.1 子计划一",
    "2. 主计划二",
    "2.1 子计划二",
  ].join("\n");
  const ctx = {
    bucket: {
      planText: originalPlanText,
      globalRevisionCount: 0,
      lastRevisionChangedMainStepIndexes: [],
      planRevisions: [],
    },
    state: { flags: {} },
  };
  const helpers = createPlanRevisionHelpers({
    CAPABILITY_DOMAIN: { PLANNING: "planning" },
    LOCALE: { ZH_CN: "zh-CN" },
    appendCapabilityLog: () => {},
    ensureHarnessBucket: (inputCtx = {}) => ({
      bucket: inputCtx.bucket,
      state: inputCtx.state,
    }),
  });

  const applied = helpers.applyRevisedPlanFromText(
    ctx,
    [
      "UPDATE 2.8 标记完成",
      "UPDATE 2.9 标记完成",
      "UPDATE 2.10 标记完成",
    ].join("\n"),
    { source: "planning_revision", stage: "revision" },
  );

  assert.equal(applied, true);
  assert.match(String(ctx.bucket.planText || ""), /^1\. 主计划一/m);
  assert.match(String(ctx.bucket.planText || ""), /^2\. 主计划二/m);
  assert.match(String(ctx.bucket.planText || ""), /^2\.8 标记完成/m);
  assert.match(String(ctx.bucket.planText || ""), /^2\.9 标记完成/m);
  assert.match(String(ctx.bucket.planText || ""), /^2\.10 标记完成/m);
  assert.doesNotMatch(String(ctx.bucket.planText || ""), /^2\. 主计划 2/m);
  assert.notEqual(String(ctx.bucket.planText || "").trim(), originalPlanText);
});

test("planning refinement allows main-plan patch and sub-plan patch in one payload", () => {
  const ctx = {
    bucket: {
      planText: [
        "1. 主计划一",
        "1.1 子计划一",
        "2. 主计划二",
        "2.1 子计划二",
      ].join("\n"),
      globalRevisionCount: 0,
      lastRevisionChangedMainStepIndexes: [],
      planRevisions: [],
    },
    state: { flags: {} },
  };
  const helpers = createPlanRevisionHelpers({
    CAPABILITY_DOMAIN: { PLANNING: "planning" },
    LOCALE: { ZH_CN: "zh-CN" },
    appendCapabilityLog: () => {},
    ensureHarnessBucket: (inputCtx = {}) => ({
      bucket: inputCtx.bucket,
      state: inputCtx.state,
    }),
  });

  const applied = helpers.applyRevisedPlanFromText(
    ctx,
    [
      "UPDATE [2] 主计划二（细化修正）",
      "UPDATE [2.2] 子计划二-新增细化",
    ].join("\n"),
    { source: "planning_refinement", stage: "refinement", targetMainStepIndexes: [2] },
  );

  assert.equal(applied, true);
  assert.match(String(ctx.bucket.planText || ""), /^2\. 主计划二（细化修正）/m);
  assert.match(String(ctx.bucket.planText || ""), /^2\.2 子计划二-新增细化/m);
  assert.equal(ctx.bucket.globalRevisionCount, 0);
});

test("planning revision resets acceptance status for changed plan items only", () => {
  const ctx = {
    bucket: {
      planText: [
        "1. 主计划一",
        "1.1 子计划一",
        "2. 主计划二",
      ].join("\n"),
      globalRevisionCount: 0,
      lastRevisionChangedMainStepIndexes: [],
      planRevisions: [],
      planAcceptanceStatusByPlanId: {
        1: { planId: "1", status: "pass", taskStatus: "completed", source: "phase_acceptance" },
        "1.1": { planId: "1.1", status: "pass", taskStatus: "completed", source: "phase_acceptance" },
        2: { planId: "2", status: "pass", taskStatus: "completed", source: "phase_acceptance" },
      },
    },
    state: { flags: {} },
  };
  const helpers = createPlanRevisionHelpers({
    CAPABILITY_DOMAIN: { PLANNING: "planning" },
    LOCALE: { ZH_CN: "zh-CN" },
    appendCapabilityLog: () => {},
    ensureHarnessBucket: (inputCtx = {}) => ({
      bucket: inputCtx.bucket,
      state: inputCtx.state,
    }),
  });

  const applied = helpers.applyRevisedPlanFromText(
    ctx,
    "UPDATE [1] 主计划一（已修正）",
    { source: "planning_revision", stage: "revision" },
  );

  assert.equal(applied, true);
  assert.equal(ctx.bucket.planAcceptanceStatusByPlanId[1].taskStatus, "pending");
  assert.equal(ctx.bucket.planAcceptanceStatusByPlanId[1].source, "plan_change_reset");
  assert.equal(ctx.bucket.planAcceptanceStatusByPlanId["1.1"].taskStatus, "completed");
  assert.equal(ctx.bucket.planAcceptanceStatusByPlanId[2].taskStatus, "completed");
});
