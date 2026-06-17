/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";

const GUIDANCE_DECISION = WORKFLOW_PARAMS.guidance.decisions;
const ACCEPTANCE_DECISION = WORKFLOW_PARAMS.acceptance.decisions;

export const WORKFLOW_SCHEDULER_ORDER = Object.freeze([
  ...(Array.isArray(WORKFLOW_PARAMS.workflow?.scheduler?.order)
    ? WORKFLOW_PARAMS.workflow.scheduler.order
    : []),
]);

export const WORKFLOW_ACTION_META = Object.freeze(
  WORKFLOW_SCHEDULER_ORDER.reduce((acc, item = {}, index) => {
    const action = String(item?.action || "").trim();
    if (!action) return acc;
    acc[action] = Object.freeze({
      flow: String(item?.flow || "").trim(),
      subflow: String(item?.subflow || "").trim(),
      action,
      executor: String(item?.executor || "none").trim() || "none",
      kind: String(item?.kind || "workflow").trim() || "workflow",
      hardOverride: item?.hardOverride === true,
      order: index,
    });
    return acc;
  }, {}),
);

export const WORKFLOW_ACTION_EXECUTOR = Object.freeze(
  Object.entries(WORKFLOW_ACTION_META).reduce((acc, [action, meta]) => {
    acc[action] = meta.executor || "none";
    return acc;
  }, { [GUIDANCE_DECISION.label.none]: "none" }),
);

function normalizePending(state = {}) {
  return state?.pending && typeof state.pending === "object" ? state.pending : {};
}

export function resolvePendingPlanUpdateForWorkflow(state = {}) {
  const pending = normalizePending(state);
  if (pending.planRevision === true) {
    const context = pending.planRevisionContext && typeof pending.planRevisionContext === "object"
      ? pending.planRevisionContext
      : {};
    return {
      active: true,
      stage: GUIDANCE_DECISION.stage.revision,
      action: GUIDANCE_DECISION.label.planUpdateRevision,
      reason: GUIDANCE_DECISION.reason.pendingRevision,
      targetMainStepIndexes: Array.isArray(context.targetMainStepIndexes)
        ? context.targetMainStepIndexes
        : [],
    };
  }
  if (state?.flags?.planRefinementEnabled === false) {
    return { active: false, stage: "", action: "", reason: "", targetMainStepIndexes: [] };
  }
  if (pending.planRefinement === true) {
    const context = pending.planRefinementContext && typeof pending.planRefinementContext === "object"
      ? pending.planRefinementContext
      : {};
    return {
      active: true,
      stage: GUIDANCE_DECISION.stage.refinement,
      action: GUIDANCE_DECISION.label.planUpdateRefinement,
      reason: GUIDANCE_DECISION.reason.pendingRefinement,
      targetMainStepIndexes: Array.isArray(context.targetMainStepIndexes)
        ? context.targetMainStepIndexes
        : [],
    };
  }
  return { active: false, stage: "", action: "", reason: "", targetMainStepIndexes: [] };
}

function isForcedAcceptancePending(state = {}) {
  return state?.flags?.overflowForceAcceptancePending === true;
}

function collectWorkflowCandidates(state = {}) {
  const pending = normalizePending(state);
  const candidates = [];
  if (pending.guidance) candidates.push(GUIDANCE_DECISION.label.guidance);

  const planUpdate = resolvePendingPlanUpdateForWorkflow(state);
  if (planUpdate.active) candidates.push(planUpdate.action);

  if (pending.phaseAcceptance === true) candidates.push(ACCEPTANCE_DECISION.action.phaseAcceptance);

  if (pending.summary === true) {
    candidates.push(
      state?.flags?.summaryByCharsPrompted === true
        ? GUIDANCE_DECISION.label.summaryOverflow
        : GUIDANCE_DECISION.label.summaryTurns,
    );
  }

  if (pending.acceptanceSemanticValidation) {
    candidates.push(ACCEPTANCE_DECISION.action.acceptanceSemanticValidation);
  }

  if (
    !candidates.length &&
    state?.flags?.planningCaptured !== true &&
    state?.flags?.planningPromptInjected !== true
  ) {
    candidates.push(WORKFLOW_PARAMS.planning.decisions.action.planningBootstrap);
  }

  return candidates;
}

function resolveBlockReason(action = "", state = {}) {
  const pending = normalizePending(state);
  const planUpdate = resolvePendingPlanUpdateForWorkflow(state);
  if (action === ACCEPTANCE_DECISION.action.phaseAcceptance) {
    if (state?.flags?.planningCaptured !== true) return "phase_acceptance_blocked_by_planning_not_captured";
    if (pending.guidance) return "phase_acceptance_blocked_by_guidance";
    if (planUpdate.active) return "phase_acceptance_blocked_by_plan_update";
    return "";
  }
  if (action === ACCEPTANCE_DECISION.action.acceptanceSemanticValidation && pending.phaseAcceptance === true) {
    return "acceptance_semantic_validation_deferred_by_phase_acceptance";
  }
  if (
    (action === GUIDANCE_DECISION.label.summaryOverflow || action === GUIDANCE_DECISION.label.summaryTurns) &&
    pending.phaseAcceptance === true &&
    !pending.guidance &&
    !planUpdate.active &&
    state?.flags?.planningCaptured === true
  ) {
    return "summary_deferred_by_phase_acceptance";
  }
  return "";
}

function reasonForAction(action = "", state = {}) {
  if (action === GUIDANCE_DECISION.label.guidance) return GUIDANCE_DECISION.reason.pendingGuidance;
  if (action === GUIDANCE_DECISION.label.planUpdateRevision) return GUIDANCE_DECISION.reason.pendingRevision;
  if (action === GUIDANCE_DECISION.label.planUpdateRefinement) return GUIDANCE_DECISION.reason.pendingRefinement;
  if (action === GUIDANCE_DECISION.label.summaryOverflow) return GUIDANCE_DECISION.reason.pendingSummaryOverflow;
  if (action === GUIDANCE_DECISION.label.summaryTurns) return GUIDANCE_DECISION.reason.pendingSummaryTurns;
  if (action === ACCEPTANCE_DECISION.action.phaseAcceptance) return ACCEPTANCE_DECISION.reason.phaseAcceptancePending;
  if (action === ACCEPTANCE_DECISION.action.acceptanceSemanticValidation) {
    return ACCEPTANCE_DECISION.reason.acceptanceSemanticValidationPending;
  }
  if (action === WORKFLOW_PARAMS.planning.decisions.action.planningBootstrap) {
    return WORKFLOW_PARAMS.planning.decisions.reason.idle;
  }
  void state;
  return GUIDANCE_DECISION.reason.idle;
}

function stageForAction(action = "") {
  if (action === GUIDANCE_DECISION.label.planUpdateRevision) return GUIDANCE_DECISION.stage.revision;
  if (action === GUIDANCE_DECISION.label.planUpdateRefinement) return GUIDANCE_DECISION.stage.refinement;
  return "";
}

function actionSortScore(action = "") {
  const score = WORKFLOW_ACTION_META[action]?.order;
  return Number.isFinite(Number(score)) ? Number(score) : 9999;
}

export function resolveWorkflowActionExecutor(action = "") {
  return WORKFLOW_ACTION_EXECUTOR[String(action || "").trim()] || "none";
}

export function resolveWorkflowActionDecision(state = {}) {
  const candidateActions = collectWorkflowCandidates(state);
  if (isForcedAcceptancePending(state)) {
    return {
      chosenAction: ACCEPTANCE_DECISION.action.forcedAcceptance,
      chosenReason: ACCEPTANCE_DECISION.reason.overflowForceAcceptance,
      chosenStage: "",
      candidateActions: [ACCEPTANCE_DECISION.action.forcedAcceptance, ...candidateActions],
      deferredActions: candidateActions,
      blockedActions: candidateActions,
      blockedReasons: ["guidance_deferred_by_forced_acceptance"],
    };
  }

  const eligible = [];
  const blockedActions = [];
  const blockedReasons = [];
  for (const action of candidateActions) {
    const reason = resolveBlockReason(action, state);
    if (reason) {
      blockedActions.push(action);
      if (!blockedReasons.includes(reason)) blockedReasons.push(reason);
      continue;
    }
    eligible.push(action);
  }

  eligible.sort((a, b) => actionSortScore(a) - actionSortScore(b));
  const chosenAction = eligible[0] || GUIDANCE_DECISION.label.none;
  const chosenReason = chosenAction === GUIDANCE_DECISION.label.none
    ? GUIDANCE_DECISION.reason.idle
    : reasonForAction(chosenAction, state);

  return {
    chosenAction,
    chosenReason,
    chosenStage: stageForAction(chosenAction),
    candidateActions,
    deferredActions: candidateActions.filter((action) => action !== chosenAction),
    blockedActions,
    blockedReasons,
  };
}
