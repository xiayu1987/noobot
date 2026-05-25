/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  canAttemptPlanUpdate,
  clearPlanUpdateCaptureContext,
  normalizePlanUpdateStage,
  readPlanUpdateCaptureContext,
  resolvePlanUpdateAttempts,
  setPendingPlanUpdate,
  writePlanUpdateCaptureContext,
} from "../src/capabilities/handlers/guidance/plan-update-engine.js";
import { PLAN_UPDATE_POLICY } from "../src/core/thresholds.js";

test("normalizePlanUpdateStage keeps revision and defaults others to refinement", () => {
  assert.equal(normalizePlanUpdateStage("revision"), "revision");
  assert.equal(normalizePlanUpdateStage("REFINEMENT"), "refinement");
  assert.equal(normalizePlanUpdateStage(""), "refinement");
});

test("canAttemptPlanUpdate increments unified and legacy counters together", () => {
  const state = { counters: { planUpdateAttempts: 0 } };
  assert.equal(canAttemptPlanUpdate({}, state, { increment: true, stage: "revision" }), true);
  assert.equal(canAttemptPlanUpdate({}, state, { increment: true, stage: "refinement" }), true);
  assert.equal(resolvePlanUpdateAttempts(state), 2);
  assert.equal(state.counters.planUpdateAttempts, 2);
});

test("canAttemptPlanUpdate respects PLAN_UPDATE_POLICY.MAX_ATTEMPTS", () => {
  const state = {
    counters: {
      planUpdateAttempts: PLAN_UPDATE_POLICY.MAX_ATTEMPTS,
    },
  };
  assert.equal(canAttemptPlanUpdate({}, state, { increment: false, stage: "revision" }), false);
  assert.equal(canAttemptPlanUpdate({}, state, { increment: false, stage: "refinement" }), false);
});

test("setPendingPlanUpdate syncs and clears unified + legacy pending fields", () => {
  const state = { pending: {} };
  setPendingPlanUpdate(state, {
    active: true,
    stage: "revision",
    summaryText: "summary",
    targetMainStepIndexes: [1],
  });
  assert.equal(state.pending.planUpdate, true);
  assert.equal(state.pending.planUpdateStage, "revision");
  assert.deepEqual(state.pending.planUpdateContext, {
    summaryText: "summary",
    targetMainStepIndexes: [1],
  });

  setPendingPlanUpdate(state, { active: false });
  assert.equal(state.pending.planUpdate, false);
  assert.equal(state.pending.planUpdateStage, "");
  assert.equal(state.pending.planUpdateContext, null);
});

test("plan update capture context helpers support unified + legacy fields", () => {
  const state = { flags: {} };
  writePlanUpdateCaptureContext(state, {
    stage: "revision",
    summaryText: "summary",
    targetMainStepIndexes: [1, 2],
  });
  assert.deepEqual(readPlanUpdateCaptureContext(state), {
    stage: "revision",
    summaryText: "summary",
    targetMainStepIndexes: [1, 2],
  });
  assert.equal(clearPlanUpdateCaptureContext(state), true);
  assert.equal("planUpdateCaptureStage" in state.flags, false);
  assert.equal("planRevisionCaptureStage" in state.flags, false);
});
