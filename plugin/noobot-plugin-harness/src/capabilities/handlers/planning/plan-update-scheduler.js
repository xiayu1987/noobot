/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { translateI18nText } from "../shared/i18n.js";
import { LOCALE } from "../shared/constants.js";
import {
  resolvePendingPlanUpdateForWorkflow,
  resolveWorkflowActionDecision,
  resolveWorkflowActionExecutor,
} from "../shared/workflow/scheduler.js";

const GUIDANCE_DECISION = WORKFLOW_PARAMS.guidance.decisions;
const GUIDANCE_REASON_LABEL_KEY = Object.freeze({
  [GUIDANCE_DECISION.reason.pendingSummaryOverflow]: "guidanceReasonPendingSummaryOverflow",
  [GUIDANCE_DECISION.reason.pendingSummaryTurns]: "guidanceReasonPendingSummaryTurns",
  [GUIDANCE_DECISION.reason.pendingGuidance]: "guidanceReasonPendingGuidance",
  [GUIDANCE_DECISION.reason.pendingRevision]: "guidanceReasonPendingRevision",
  [GUIDANCE_DECISION.reason.pendingRefinement]: "guidanceReasonPendingRefinement",
  [GUIDANCE_DECISION.reason.idle]: "guidanceReasonIdle",
});
const GUIDANCE_BLOCKED_REASON_LABEL_KEY = Object.freeze({
  phase_acceptance_deferred_by_guidance_priority: "guidanceBlockedPhaseAcceptanceDeferred",
});

function resolveDecisionLocale(state = {}) {
  const locale = String(state?.locale || "").trim().toLowerCase();
  return locale.startsWith("en") ? LOCALE.EN_US : LOCALE.ZH_CN;
}

function resolveReasonLabel(locale = LOCALE.ZH_CN, reason = "") {
  const key = GUIDANCE_REASON_LABEL_KEY[String(reason || "").trim()];
  if (!key) return String(reason || "").trim();
  return translateI18nText(locale, key) || String(reason || "").trim();
}

function resolveBlockedReasonLabel(locale = LOCALE.ZH_CN, reason = "") {
  const key = GUIDANCE_BLOCKED_REASON_LABEL_KEY[String(reason || "").trim()];
  if (!key) return String(reason || "").trim();
  return translateI18nText(locale, key) || String(reason || "").trim();
}

export function resolvePendingPlanUpdate(state = {}) {
  const pendingPlanUpdate = resolvePendingPlanUpdateForWorkflow(state);
  return {
    active: pendingPlanUpdate.active === true,
    stage: pendingPlanUpdate.stage || "",
    targetMainStepIndexes: Array.isArray(pendingPlanUpdate.targetMainStepIndexes)
      ? pendingPlanUpdate.targetMainStepIndexes
      : [],
  };
}

function guidanceActionFromDecision(decision = {}) {
  const action = String(decision?.chosenAction || "").trim();
  if (resolveWorkflowActionExecutor(action) !== "guidance") {
    return { action: GUIDANCE_DECISION.action.none, stage: "", reason: GUIDANCE_DECISION.reason.idle };
  }
  if (action === GUIDANCE_DECISION.label.guidance) {
    return { action: GUIDANCE_DECISION.action.guidance, stage: "", reason: GUIDANCE_DECISION.reason.pendingGuidance };
  }
  if (action === GUIDANCE_DECISION.label.planUpdateRevision) {
    return { action: GUIDANCE_DECISION.action.planUpdate, stage: GUIDANCE_DECISION.stage.revision, reason: GUIDANCE_DECISION.reason.pendingRevision };
  }
  if (action === GUIDANCE_DECISION.label.planUpdateRefinement) {
    return { action: GUIDANCE_DECISION.action.planUpdate, stage: GUIDANCE_DECISION.stage.refinement, reason: GUIDANCE_DECISION.reason.pendingRefinement };
  }
  if (action === GUIDANCE_DECISION.label.summaryOverflow) {
    return { action: GUIDANCE_DECISION.action.summary, stage: "", reason: GUIDANCE_DECISION.reason.pendingSummaryOverflow };
  }
  if (action === GUIDANCE_DECISION.label.summaryTurns) {
    return { action: GUIDANCE_DECISION.action.summary, stage: "", reason: GUIDANCE_DECISION.reason.pendingSummaryTurns };
  }
  return { action: GUIDANCE_DECISION.action.none, stage: "", reason: GUIDANCE_DECISION.reason.idle };
}

export function resolveNextGuidanceAction(state = {}) {
  return guidanceActionFromDecision(resolveWorkflowActionDecision(state));
}

function toPendingSnapshot(state = {}) {
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  const summaryByCharsPrompted = state?.flags?.summaryByCharsPrompted === true;
  const planUpdate = resolvePendingPlanUpdate(state);
  const unifiedDecision = resolveWorkflowActionDecision(state);
  const phaseAcceptanceActive = pending.phaseAcceptance === true;
  const phaseAcceptanceBlocked = unifiedDecision.blockedActions?.includes(
    WORKFLOW_PARAMS.acceptance.decisions.action.phaseAcceptance,
  );
  return {
    summary: {
      active: pending.summary === true,
      reason: pending.summary === true
        ? (summaryByCharsPrompted ? GUIDANCE_DECISION.label.summaryOverflow : GUIDANCE_DECISION.label.summaryTurns)
        : "",
    },
    guidance: {
      active: Boolean(pending.guidance),
      payload: pending.guidance || null,
    },
    planUpdate: {
      active: planUpdate.active === true,
      stage: planUpdate.stage || "",
      context: {
        targetMainStepIndexes: Array.isArray(planUpdate.targetMainStepIndexes) ? planUpdate.targetMainStepIndexes : [],
      },
    },
    phaseAcceptance: {
      active: phaseAcceptanceActive,
      blockedBy: phaseAcceptanceBlocked ? ["guidance_priority_order"] : [],
    },
    acceptanceSemanticValidation: {
      active: Boolean(pending.acceptanceSemanticValidation),
    },
    flags: {
      summaryByCharsPrompted,
      planningCaptured: state?.flags?.planningCaptured === true,
      overflowForceAcceptancePending: state?.flags?.overflowForceAcceptancePending === true,
    },
  };
}

export function resolveGuidancePriorityDecision(state = {}) {
  const locale = resolveDecisionLocale(state);
  const unifiedDecision = resolveWorkflowActionDecision(state);
  const nextAction = guidanceActionFromDecision(unifiedDecision);
  const chosenAction = resolveWorkflowActionExecutor(unifiedDecision.chosenAction) === "guidance"
    ? unifiedDecision.chosenAction
    : GUIDANCE_DECISION.label.none;
  const chosenReason = nextAction.reason;
  return {
    chosenAction,
    chosenReason,
    chosenReasonLabel: resolveReasonLabel(locale, chosenReason),
    chosenStage: nextAction.stage || "",
    candidateActions: unifiedDecision.candidateActions || [],
    deferredActions: (unifiedDecision.candidateActions || []).filter((label) => label !== chosenAction),
    blockedActions: unifiedDecision.blockedActions || [],
    blockedReasons: unifiedDecision.blockedReasons || [],
    blockedReasonLabels: (unifiedDecision.blockedReasons || []).map((reason) => resolveBlockedReasonLabel(locale, reason)),
    pendingSnapshot: toPendingSnapshot(state),
  };
}
