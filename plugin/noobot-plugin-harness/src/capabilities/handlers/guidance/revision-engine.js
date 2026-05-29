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
import { createPlanRevisionHelpers } from "../shared/plan/revision-helpers.js";
import {
  buildPlanningRevisionPromptText,
  getPlanningRevisionMarker,
} from "../shared/workflow/prompts.js";
import { canAttemptPlanUpdate } from "./plan-update-engine.js";

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

export function canAttemptPlanRevision(ctx = {}, state = {}, { increment = false, stage = "revision" } = {}) {
  return canAttemptPlanUpdate(ctx, state, { increment, stage });
}
