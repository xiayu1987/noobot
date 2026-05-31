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

