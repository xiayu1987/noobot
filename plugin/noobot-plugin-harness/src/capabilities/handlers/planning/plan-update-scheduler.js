/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { GUIDANCE_PRIORITY_ORDER } from "../shared/workflow/policy.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { translateI18nText } from "../shared/i18n.js";
import { LOCALE } from "../shared/constants.js";

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
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  if (pending.planRevision === true) {
    const context =
      pending.planRevisionContext && typeof pending.planRevisionContext === "object"
        ? pending.planRevisionContext
        : {};
    return {
      active: true,
      stage: GUIDANCE_DECISION.stage.revision,
      targetMainStepIndexes: Array.isArray(context.targetMainStepIndexes)
        ? context.targetMainStepIndexes
        : [],
    };
  }
  if (pending.planRefinement === true) {
    const context =
      pending.planRefinementContext && typeof pending.planRefinementContext === "object"
        ? pending.planRefinementContext
        : {};
    return {
      active: true,
      stage: GUIDANCE_DECISION.stage.refinement,
      targetMainStepIndexes: Array.isArray(context.targetMainStepIndexes)
        ? context.targetMainStepIndexes
        : [],
    };
  }
  return { active: false, stage: "", targetMainStepIndexes: [] };
}

export function resolveNextGuidanceAction(state = {}) {
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  const summaryPending = pending.summary === true;
  const summaryByCharsPrompted = state?.flags?.summaryByCharsPrompted === true;
  const planUpdate = resolvePendingPlanUpdate(state);

  for (const item of GUIDANCE_PRIORITY_ORDER) {
    if (item === "summary_overflow" && summaryPending && summaryByCharsPrompted) {
      return {
        action: GUIDANCE_DECISION.action.summary,
        stage: "",
        reason: GUIDANCE_DECISION.reason.pendingSummaryOverflow,
      };
    }
    if (item === "guidance" && pending.guidance) {
      return {
        action: GUIDANCE_DECISION.action.guidance,
        stage: "",
        reason: GUIDANCE_DECISION.reason.pendingGuidance,
      };
    }
    if (item === "plan_update" && planUpdate.active) {
      return {
        action: GUIDANCE_DECISION.action.planUpdate,
        stage: planUpdate.stage,
        reason:
          planUpdate.stage === GUIDANCE_DECISION.stage.revision
            ? GUIDANCE_DECISION.reason.pendingRevision
            : GUIDANCE_DECISION.reason.pendingRefinement,
      };
    }
    if (item === "summary_turns" && summaryPending) {
      return {
        action: GUIDANCE_DECISION.action.summary,
        stage: "",
        reason: GUIDANCE_DECISION.reason.pendingSummaryTurns,
      };
    }
  }
  return { action: GUIDANCE_DECISION.action.none, stage: "", reason: GUIDANCE_DECISION.reason.idle };
}

function toActionLabel(action = "", stage = "", reason = "") {
  if (action === GUIDANCE_DECISION.action.summary) {
    return reason === GUIDANCE_DECISION.reason.pendingSummaryOverflow
      ? GUIDANCE_DECISION.label.summaryOverflow
      : GUIDANCE_DECISION.label.summaryTurns;
  }
  if (action === GUIDANCE_DECISION.action.planUpdate) {
    const normalizedStage = String(stage || "").trim().toLowerCase() === GUIDANCE_DECISION.stage.revision
      ? GUIDANCE_DECISION.stage.revision
      : GUIDANCE_DECISION.stage.refinement;
    return `plan_update_${normalizedStage}`;
  }
  if (action === GUIDANCE_DECISION.action.guidance) return GUIDANCE_DECISION.label.guidance;
  return GUIDANCE_DECISION.label.none;
}

function collectPendingActionLabels(state = {}) {
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  const labels = [];
  const summaryPending = pending.summary === true;
  const summaryByCharsPrompted = state?.flags?.summaryByCharsPrompted === true;
  if (summaryPending && summaryByCharsPrompted) {
    labels.push(GUIDANCE_DECISION.label.summaryOverflow);
  } else if (summaryPending) {
    labels.push(GUIDANCE_DECISION.label.summaryTurns);
  }
  if (pending.guidance) labels.push(GUIDANCE_DECISION.label.guidance);
  const planUpdate = resolvePendingPlanUpdate(state);
  if (planUpdate.active) {
    labels.push(
      `plan_update_${
        planUpdate.stage === GUIDANCE_DECISION.stage.revision
          ? GUIDANCE_DECISION.stage.revision
          : GUIDANCE_DECISION.stage.refinement
      }`,
    );
  }
  if (pending.phaseAcceptance === true) labels.push(GUIDANCE_DECISION.label.phaseAcceptance);
  return labels;
}

function toPendingSnapshot(state = {}) {
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  const summaryByCharsPrompted = state?.flags?.summaryByCharsPrompted === true;
  const planUpdate = resolvePendingPlanUpdate(state);
  const phaseAcceptanceActive = pending.phaseAcceptance === true;
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
      blockedBy: phaseAcceptanceActive ? ["guidance_priority_order"] : [],
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
  const nextAction = resolveNextGuidanceAction(state);
  const chosenAction = toActionLabel(nextAction.action, nextAction.stage, nextAction.reason);
  const pendingActionLabels = collectPendingActionLabels(state);
  const candidateActions = pendingActionLabels;
  const deferredActions = pendingActionLabels.filter((label) => label !== chosenAction);
  const blockedReasons = [];
  if (candidateActions.includes(GUIDANCE_DECISION.label.phaseAcceptance)) {
    blockedReasons.push("phase_acceptance_deferred_by_guidance_priority");
  }
  return {
    chosenAction,
    chosenReason: nextAction.reason,
    chosenReasonLabel: resolveReasonLabel(locale, nextAction.reason),
    chosenStage: nextAction.stage || "",
    candidateActions,
    deferredActions,
    blockedActions: deferredActions,
    blockedReasons,
    blockedReasonLabels: blockedReasons.map((reason) => resolveBlockedReasonLabel(locale, reason)),
    pendingSnapshot: toPendingSnapshot(state),
  };
}
