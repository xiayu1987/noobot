/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  canAttemptPlanUpdate,
  readPlanUpdateCaptureContext,
  resolvePlanUpdateAttempts,
  setPendingPlanUpdate,
  writePlanUpdateCaptureContext,
} from "../../src/capabilities/handlers/planning/plan-update-engine.js";
import { setCaptureFlagStateWithMeta } from "../../src/capabilities/pending-cleanup.js";
import { WORKFLOW_PARAMS } from "../../src/core/workflow-params.js";
import {
  createHarnessBucket,
  requireHarnessPlanUpdateStage,
} from "../../src/core/bucket-contract.js";

const PLAN_UPDATE_POLICY = Object.freeze({
  MAX_ATTEMPTS_REVISION: WORKFLOW_PARAMS.planning.planUpdate.revisionMaxAttempts,
  MAX_ATTEMPTS_REFINEMENT: WORKFLOW_PARAMS.planning.planUpdate.refinementMaxAttempts,
});

test("plan update stage requires an exact declared stage before state changes", () => {
  assert.equal(requireHarnessPlanUpdateStage("revision"), "revision");
  assert.equal(requireHarnessPlanUpdateStage("refinement"), "refinement");
  for (const stage of [undefined, null, "", "REFINEMENT", " revision", "other", 1]) {
    const { state } = createHarnessBucket();
    const before = structuredClone(state);
    assert.throws(
      () => requireHarnessPlanUpdateStage(stage),
      /invalid_harness_state:planUpdateStage/,
    );
    for (const operation of [
      () => canAttemptPlanUpdate({}, state, { increment: true, stage }),
      () => setPendingPlanUpdate(state, { active: true, stage, targetMainStepIndexes: [1] }),
      () => setPendingPlanUpdate(state, { active: false, stage }),
      () => writePlanUpdateCaptureContext(state, { stage, targetMainStepIndexes: [1] }),
    ]) {
      assert.throws(operation, /invalid_harness_state:planUpdateStage/);
    }
    assert.deepEqual(state, before);
  }
});

test("capture context validates all fields before writing", () => {
  const { state } = createHarnessBucket();
  const before = structuredClone(state);
  assert.throws(
    () => writePlanUpdateCaptureContext(state, { stage: "revision", targetMainStepIndexes: null }),
    /requires targetMainStepIndexes array/,
  );
  assert.deepEqual(state, before);
});

test("canAttemptPlanUpdate increments revision/refinement counters independently", () => {
  const { state } = createHarnessBucket();
  assert.equal(canAttemptPlanUpdate({}, state, { increment: true, stage: "revision" }), true);
  assert.equal(canAttemptPlanUpdate({}, state, { increment: true, stage: "refinement" }), true);
  assert.equal(resolvePlanUpdateAttempts(state, { stage: "revision" }), 1);
  assert.equal(resolvePlanUpdateAttempts(state, { stage: "refinement" }), 1);
  assert.equal(state.counters.planRevisionAttempts, 1);
  assert.equal(state.counters.planRefinementAttempts, 1);
  assert.equal(Object.hasOwn(state.counters, "planUpdateAttempts"), false);
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

test("fresh stage counters permit revision/refinement independently", () => {
  const { state } = createHarnessBucket();
  assert.equal(canAttemptPlanUpdate({}, state, { increment: false, stage: "revision" }), true);
  assert.equal(canAttemptPlanUpdate({}, state, { increment: false, stage: "refinement" }), true);
});

test("setPendingPlanUpdate manages independent revision/refinement pending fields", () => {
  const { state } = createHarnessBucket();
  setPendingPlanUpdate(state, {
    active: true,
    stage: "revision",
    targetMainStepIndexes: [1],
  });
  assert.equal(state.pending.planRevision, true);
  assert.deepEqual(state.pending.planRevisionContext, {
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

test("plan update capture context is cleared when the capture flag is released", () => {
  const state = { flags: {}, pendingMeta: { pending: {}, flags: {}, lastWarnHookTurn: null } };
  writePlanUpdateCaptureContext(state, {
    stage: "revision",
    targetMainStepIndexes: [1, 2],
  });
  assert.deepEqual(readPlanUpdateCaptureContext(state), {
    stage: "revision",
    targetMainStepIndexes: [1, 2],
  });
  assert.equal(setCaptureFlagStateWithMeta(state, "planUpdateCapturePending", false), true);
  assert.equal("planUpdateCaptureStage" in state.flags, false);
  assert.equal("planUpdateCaptureTargetMainStepIndexes" in state.flags, false);
});
