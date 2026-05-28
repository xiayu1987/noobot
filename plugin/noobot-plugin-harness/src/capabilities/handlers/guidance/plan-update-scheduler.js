/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { GUIDANCE_PRIORITY_ORDER } from "../shared/workflow/policy.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";

const GUIDANCE_DECISION = WORKFLOW_PARAMS.guidance.decisions;

function normalizePlanUpdateStage(raw = "") {
  return String(raw || "").trim().toLowerCase() === GUIDANCE_DECISION.stage.revision
    ? GUIDANCE_DECISION.stage.revision
    : GUIDANCE_DECISION.stage.refinement;
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

export function resolveGuidancePriorityDecision(state = {}) {
  const nextAction = resolveNextGuidanceAction(state);
  const chosenAction = toActionLabel(nextAction.action, nextAction.stage, nextAction.reason);
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  const pendingActionLabels = collectPendingActionLabels(state);
  return {
    chosenAction,
    chosenReason: nextAction.reason,
    chosenStage: nextAction.stage || "",
    blockedActions: pendingActionLabels.filter((label) => label !== chosenAction),
    pendingSnapshot: {
      summary: pending.summary === true,
      summaryByCharsPrompted: state?.flags?.summaryByCharsPrompted === true,
      guidance: pending.guidance || null,
      planUpdate: resolvePendingPlanUpdate(state),
      phaseAcceptance: pending.phaseAcceptance === true,
    },
  };
}
