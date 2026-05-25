/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizePlanUpdateStage(raw = "") {
  return String(raw || "").trim().toLowerCase() === "revision" ? "revision" : "refinement";
}

export function resolvePendingPlanUpdate(state = {}) {
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  const hasUnifiedPending = pending.planUpdate === true;
  const hasLegacyPending = pending.planRevision === true;
  if (!hasUnifiedPending && !hasLegacyPending) {
    return { active: false, stage: "", summaryText: "", targetMainStepIndexes: [] };
  }
  const stage = normalizePlanUpdateStage(
    pending.planUpdateStage ||
      pending.planRevisionStage ||
      "",
  );
  const context =
    pending.planUpdateContext && typeof pending.planUpdateContext === "object"
      ? pending.planUpdateContext
      : {};
  return {
    active: true,
    stage,
    summaryText: String(context.summaryText || pending.summaryText || "").trim(),
    targetMainStepIndexes: Array.isArray(context.targetMainStepIndexes)
      ? context.targetMainStepIndexes
      : Array.isArray(pending.planRevisionTargetMainStepIndexes)
        ? pending.planRevisionTargetMainStepIndexes
        : [],
  };
}

export function resolveNextGuidanceAction(state = {}) {
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  if (pending.summary === true) {
    return { action: "summary", stage: "", reason: "pending_summary" };
  }
  if (pending.guidance) {
    return { action: "guidance", stage: "", reason: "pending_guidance" };
  }
  const planUpdate = resolvePendingPlanUpdate(state);
  if (planUpdate.active) {
    return {
      action: "plan_update",
      stage: planUpdate.stage,
      reason: planUpdate.stage === "revision" ? "pending_revision" : "pending_refinement",
    };
  }
  return { action: "none", stage: "", reason: "idle" };
}

