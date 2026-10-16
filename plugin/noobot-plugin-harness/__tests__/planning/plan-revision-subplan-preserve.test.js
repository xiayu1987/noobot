/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createPlanRevisionHelpers } from "../../src/capabilities/handlers/shared/plan/revision-helpers.js";

test("planning revision resets acceptance status for changed plan items only", () => {
  const ctx = {
    bucket: {
      planText: ["1. 主计划一", "1.1 子计划一", "2. 主计划二"].join("\n"),
      globalRevisionCount: 0,
      lastRevisionChangedMainStepIndexes: [],
      planRevisions: [],
      planAcceptanceStatusByPlanId: {
        1: { planId: "1", status: "pass", taskStatus: "completed", source: "phase_acceptance" },
        1.1: { planId: "1.1", status: "pass", taskStatus: "completed", source: "phase_acceptance" },
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

  const applied = helpers.applyRevisedPlanFromText(ctx, "UPDATE [1] 主计划一（已修正）", {
    source: "planning_revision",
    stage: "revision",
  });

  assert.equal(applied, true);
  assert.equal(ctx.bucket.planAcceptanceStatusByPlanId[1].taskStatus, "pending");
  assert.equal(ctx.bucket.planAcceptanceStatusByPlanId[1].source, "plan_change_reset");
  assert.equal(ctx.bucket.planAcceptanceStatusByPlanId["1.1"].taskStatus, "completed");
  assert.equal(ctx.bucket.planAcceptanceStatusByPlanId[2].taskStatus, "completed");
});
