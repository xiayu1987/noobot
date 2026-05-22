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
  extractJsonObjectFromText,
  getDefaultTaskOwner,
  parseRefinementChecklistFromModelOutput,
  parseTaskChecklistFromModelOutput,
  translateI18nText,
} from "./deps.js";
import { createPlanRevisionHelpers } from "../shared/plan-revision-helpers.js";
import { MAX_PLAN_REVISION_ATTEMPTS } from "../../../core/thresholds.js";

const planRevisionHelpers = createPlanRevisionHelpers({
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
  extractJsonObjectFromText,
  getDefaultTaskOwner,
  parseRefinementChecklistFromModelOutput,
  parseTaskChecklistFromModelOutput,
  translateI18nText,
});

export const resolveRefinementTargetMainSteps = planRevisionHelpers.resolveRefinementTargetMainSteps;
export const applyRevisedPlanFromText = planRevisionHelpers.applyRevisedPlanFromText;
export const buildPlanningRefinementPrompt = planRevisionHelpers.buildPlanningRefinementPrompt;
export const buildNextPhaseRelayContent = planRevisionHelpers.buildNextPhaseRelayContent;

export function buildPlanningRevisionPrompt(locale = LOCALE.ZH_CN, bucket = {}, state = {}, summaryText = "") {
  const planJsonExample =
    '{"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}';
  return [
    translateI18nText(locale, "planningRevisionMarker"),
    translateI18nText(locale, "planningRevisionPromptBody", {
      example: planJsonExample,
    }),
    JSON.stringify({
      currentSummary: String(summaryText || "").trim(),
      currentPlan: {
        totalGoal: bucket.totalGoal || "",
        taskOwner: bucket.taskOwner || getDefaultTaskOwner(locale),
        taskChecklist: bucket.taskChecklist || [],
        nextPhase: bucket.nextPhase || null,
      },
      harnessState: {
        signals: state.signals || {},
        counters: state.counters || {},
      },
    }, null, 2),
  ].join("\n");
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
