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
import { WORKFLOW_PARAMS } from "../src/core/workflow-params.js";

const PLAN_UPDATE_POLICY = Object.freeze({
  MAX_ATTEMPTS_REVISION: WORKFLOW_PARAMS.planning.planUpdate.revisionMaxAttempts,
  MAX_ATTEMPTS_REFINEMENT: WORKFLOW_PARAMS.planning.planUpdate.refinementMaxAttempts,
});

test("normalizePlanUpdateStage keeps revision and defaults others to refinement", () => {
  assert.equal(normalizePlanUpdateStage("revision"), "revision");
  assert.equal(normalizePlanUpdateStage("REFINEMENT"), "refinement");
  assert.equal(normalizePlanUpdateStage(""), "refinement");
});

test("canAttemptPlanUpdate increments revision/refinement counters independently", () => {
  const state = { counters: { planUpdateAttempts: 0 } };
  assert.equal(canAttemptPlanUpdate({}, state, { increment: true, stage: "revision" }), true);
  assert.equal(canAttemptPlanUpdate({}, state, { increment: true, stage: "refinement" }), true);
  assert.equal(resolvePlanUpdateAttempts(state, { stage: "revision" }), 1);
  assert.equal(resolvePlanUpdateAttempts(state, { stage: "refinement" }), 1);
  assert.equal(state.counters.planRevisionAttempts, 1);
  assert.equal(state.counters.planRefinementAttempts, 1);
  assert.equal(state.counters.planUpdateAttempts, 2);
});

test("canAttemptPlanUpdate respects stage-specific max attempts", () => {
  const state = {
    counters: {
      planRevisionAttempts: PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REVISION,
      planRefinementAttempts: PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REFINEMENT,
    },
  };
  assert.equal(canAttemptPlanUpdate({}, state, { increment: false, stage: "revision" }), false);
  assert.equal(canAttemptPlanUpdate({}, state, { increment: false, stage: "refinement" }), false);
});

test("unified attempts no longer block revision/refinement", () => {
  const state = {
    counters: {
      planUpdateAttempts: Number.MAX_SAFE_INTEGER,
    },
  };
  assert.equal(canAttemptPlanUpdate({}, state, { increment: false, stage: "revision" }), true);
  assert.equal(canAttemptPlanUpdate({}, state, { increment: false, stage: "refinement" }), true);
});

test("setPendingPlanUpdate manages independent revision/refinement pending fields", () => {
  const state = { pending: {} };
  setPendingPlanUpdate(state, {
    active: true,
    stage: "revision",
    summaryText: "summary",
    targetMainStepIndexes: [1],
  });
  assert.equal(state.pending.planRevision, true);
  assert.deepEqual(state.pending.planRevisionContext, {
    summaryText: "summary",
    targetMainStepIndexes: [1],
  });
  assert.equal(state.pending.planRefinement, false);
  assert.equal(state.pending.planRefinementContext, null);
  assert.equal("planUpdate" in state.pending, false);
  assert.equal("planUpdateStage" in state.pending, false);
  assert.equal("planUpdateContext" in state.pending, false);

  setPendingPlanUpdate(state, { active: false, stage: "revision" });
  assert.equal(state.pending.planRevision, false);
  assert.equal(state.pending.planRevisionContext, null);
  assert.equal(state.pending.planRefinement, false);
  assert.equal(state.pending.planRefinementContext, null);
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
