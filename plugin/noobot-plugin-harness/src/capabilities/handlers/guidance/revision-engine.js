/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
} from "./deps.js";
import { createPlanRevisionHelpers } from "../shared/plan-revision-helpers.js";
import { MAX_PLAN_REVISION_ATTEMPTS } from "../../../core/thresholds.js";
import {
  buildPlanningRevisionPromptText,
  getPlanningRevisionMarker,
} from "../shared/workflow-prompts.js";

const planRevisionHelpers = createPlanRevisionHelpers({
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
});

export const resolveRefinementTargetMainSteps = planRevisionHelpers.resolveRefinementTargetMainSteps;
export const applyRevisedPlanFromText = planRevisionHelpers.applyRevisedPlanFromText;
export const buildPlanningRefinementPrompt = planRevisionHelpers.buildPlanningRefinementPrompt;
export const buildNextPhaseRelayContent = planRevisionHelpers.buildNextPhaseRelayContent;

export function buildPlanningRevisionPrompt(locale = LOCALE.ZH_CN, bucket = {}, state = {}, summaryText = "") {
  const globalRevisionCount = Number.isFinite(Number(bucket?.globalRevisionCount))
    ? Number(bucket.globalRevisionCount)
    : 0;
  void state;
  return buildPlanningRevisionPromptText({
    locale,
    marker: getPlanningRevisionMarker(locale),
    data: {
      globalRevisionCount,
      includeCurrentMainPlans: false,
      feedback: String(summaryText || "").trim(),
    },
  });
}

export function canAttemptPlanRevision(ctx = {}, state = {}, { increment = false } = {}) {
  if (!state || typeof state !== "object") return false;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  const current = Number.isFinite(Number(state.counters.planRevisionAttempts))
    ? Number(state.counters.planRevisionAttempts)
    : 0;
  if (current >= MAX_PLAN_REVISION_ATTEMPTS) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_revision_skipped_by_max_attempts",
      detail: { current, limit: MAX_PLAN_REVISION_ATTEMPTS },
    });
    return false;
  }
  if (increment) state.counters.planRevisionAttempts = current + 1;
  return true;
}
