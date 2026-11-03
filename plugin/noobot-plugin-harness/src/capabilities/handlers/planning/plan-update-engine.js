/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CAPABILITY_DOMAIN } from "../shared/constants.js";
import { appendCapabilityLog } from "../shared/attachment-log-utils.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { requireHarnessPlanUpdateStage } from "../../../core/bucket-contract.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;
function resolveStageAttemptCounterKey(stage) {
  return requireHarnessPlanUpdateStage(stage) === "revision"
    ? "planRevisionAttempts"
    : "planRefinementAttempts";
}

function resolveStageAttemptLimit(stage) {
  const normalizedStage = requireHarnessPlanUpdateStage(stage);
  return normalizedStage === "revision"
    ? TURN_THRESHOLDS.harness.planning.planUpdateRevisionMaxAttempts
    : TURN_THRESHOLDS.harness.planning.planUpdateRefinementMaxAttempts;
}

export function resolvePlanUpdateAttempts(state, { stage }) {
  const normalizedStage = requireHarnessPlanUpdateStage(stage);
  const stageKey = resolveStageAttemptCounterKey(normalizedStage);
  return state.counters[stageKey];
}

function syncPlanUpdateAttempts(state, { stage, next }) {
  const normalizedStage = requireHarnessPlanUpdateStage(stage);
  const stageKey = resolveStageAttemptCounterKey(normalizedStage);
  state.counters[stageKey] = next;
}

export function canAttemptPlanUpdate(ctx, state, { increment = false, stage }) {
  const normalizedStage = requireHarnessPlanUpdateStage(stage);
  const current = resolvePlanUpdateAttempts(state, { stage: normalizedStage });
  const stageLimit = resolveStageAttemptLimit(normalizedStage);
  if (current >= stageLimit) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: GUIDANCE_EVENTS.revisionSkippedByMaxAttempts,
      detail: {
        stage: normalizedStage,
        current,
        limit: stageLimit,
      },
    });
    return false;
  }
  if (increment) {
    syncPlanUpdateAttempts(state, { stage: normalizedStage, next: current + 1 });
  }
  return true;
}

function requireTargetMainStepIndexes(owner, targetMainStepIndexes) {
  if (!Array.isArray(targetMainStepIndexes)) {
    throw new TypeError(`${owner} requires targetMainStepIndexes array`);
  }
  return targetMainStepIndexes;
}

export function setPendingPlanUpdate(state, { active = false, stage, targetMainStepIndexes = [] }) {
  const pending = state.pending;
  const normalizedStage = requireHarnessPlanUpdateStage(stage);
  if (active !== true) {
    if (normalizedStage === "revision") {
      setPendingStateWithMeta(state, "planRevision", false);
      pending.planRevisionContext = null;
    } else {
      setPendingStateWithMeta(state, "planRefinement", false);
      pending.planRefinementContext = null;
    }
    return true;
  }
  const normalizedContext = {
    targetMainStepIndexes: requireTargetMainStepIndexes(
      "setPendingPlanUpdate",
      targetMainStepIndexes,
    ),
  };
  if (normalizedStage === "revision") {
    setPendingStateWithMeta(state, "planRevision", true);
    pending.planRevisionContext = normalizedContext;
    setPendingStateWithMeta(state, "planRefinement", false);
    pending.planRefinementContext = null;
  } else {
    setPendingStateWithMeta(state, "planRefinement", true);
    pending.planRefinementContext = normalizedContext;
    setPendingStateWithMeta(state, "planRevision", false);
    pending.planRevisionContext = null;
  }
  return true;
}

export function writePlanUpdateCaptureContext(state, { stage, targetMainStepIndexes }) {
  const captureStage = requireHarnessPlanUpdateStage(stage);
  const targets = requireTargetMainStepIndexes(
    "writePlanUpdateCaptureContext",
    targetMainStepIndexes,
  );
  state.flags.planUpdateCaptureStage = captureStage;
  state.flags.planUpdateCaptureTargetMainStepIndexes = targets;
}

export function readPlanUpdateCaptureContext(state) {
  const { planUpdateCaptureStage, planUpdateCaptureTargetMainStepIndexes } = state.flags;
  return {
    stage: requireHarnessPlanUpdateStage(planUpdateCaptureStage),
    targetMainStepIndexes: requireTargetMainStepIndexes(
      "readPlanUpdateCaptureContext",
      planUpdateCaptureTargetMainStepIndexes,
    ),
  };
}
