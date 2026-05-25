/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveNextGuidanceAction,
  resolvePendingPlanUpdate,
} from "../src/capabilities/handlers/guidance/plan-update-scheduler.js";

test("scheduler priority: summary > guidance > revision > refinement", () => {
  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: {
        summary: true,
        guidance: "consecutive_failures",
        planUpdate: true,
        planUpdateStage: "revision",
      },
    }),
    { action: "summary", stage: "", reason: "pending_summary" },
  );

  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: {
        summary: false,
        guidance: "consecutive_failures",
        planUpdate: true,
        planUpdateStage: "revision",
      },
    }),
    { action: "guidance", stage: "", reason: "pending_guidance" },
  );

  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: { summary: false, guidance: null, planUpdate: true, planUpdateStage: "revision" },
    }),
    { action: "plan_update", stage: "revision", reason: "pending_revision" },
  );

  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: { summary: false, guidance: null, planUpdate: true, planUpdateStage: "refinement" },
    }),
    { action: "plan_update", stage: "refinement", reason: "pending_refinement" },
  );
});

test("scheduler supports legacy planRevision pending fields", () => {
  const resolved = resolvePendingPlanUpdate({
    pending: {
      planRevision: true,
      planRevisionStage: "revision",
      summaryText: "legacy summary",
      planRevisionTargetMainStepIndexes: [1, 2],
    },
  });
  assert.deepEqual(resolved, {
    active: true,
    stage: "revision",
    summaryText: "legacy summary",
    targetMainStepIndexes: [1, 2],
  });
  assert.deepEqual(resolveNextGuidanceAction({ pending: { planRevision: true, planRevisionStage: "revision" } }), {
    action: "plan_update",
    stage: "revision",
    reason: "pending_revision",
  });
});

