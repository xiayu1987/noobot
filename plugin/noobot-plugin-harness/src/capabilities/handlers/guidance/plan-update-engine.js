/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  appendCapabilityLog,
} from "./deps.js";
import { PLAN_UPDATE_POLICY } from "../../../core/thresholds.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;

export function normalizePlanUpdateStage(stage = "") {
  return String(stage || "").trim().toLowerCase() === "revision" ? "revision" : "refinement";
}

function resolveStageAttemptCounterKey(stage = "revision") {
  return normalizePlanUpdateStage(stage) === "revision"
    ? "planRevisionAttempts"
    : "planRefinementAttempts";
}

function resolveStageAttemptLimit(stage = "revision") {
  const normalizedStage = normalizePlanUpdateStage(stage);
  return normalizedStage === "revision"
    ? Number(PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REVISION)
    : Number(PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REFINEMENT);
}

export function resolvePlanUpdateAttempts(state = {}, { stage = "revision" } = {}) {
  if (!state || typeof state !== "object") return 0;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  const normalizedStage = normalizePlanUpdateStage(stage);
  const stageKey = resolveStageAttemptCounterKey(normalizedStage);
  if (Number.isFinite(Number(state.counters[stageKey]))) {
    return Number(state.counters[stageKey]);
  }
  return 0;
}

function syncPlanUpdateAttempts(state = {}, { stage = "revision", next = 0 } = {}) {
  if (!state || typeof state !== "object") return;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  const normalizedStage = normalizePlanUpdateStage(stage);
  const stageKey = resolveStageAttemptCounterKey(normalizedStage);
  state.counters[stageKey] = next;
  const revisionAttempts = Number.isFinite(Number(state.counters.planRevisionAttempts))
    ? Number(state.counters.planRevisionAttempts)
    : 0;
  const refinementAttempts = Number.isFinite(Number(state.counters.planRefinementAttempts))
    ? Number(state.counters.planRefinementAttempts)
    : 0;
  // Keep unified field for compatibility/observability.
  state.counters.planUpdateAttempts = revisionAttempts + refinementAttempts;
}

export function canAttemptPlanUpdate(
  ctx = {},
  state = {},
  { increment = false, stage = "revision" } = {},
) {
  if (!state || typeof state !== "object") return false;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  const normalizedStage = normalizePlanUpdateStage(stage);
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

export function setPendingPlanUpdate(
  state = {},
  {
    active = false,
    stage = "revision",
    summaryText = "",
    targetMainStepIndexes = [],
  } = {},
) {
  if (!state || typeof state !== "object") return false;
  if (!state.pending || typeof state.pending !== "object") state.pending = {};
  const pending = state.pending;
  const syncUnifiedFromIndependent = () => {
    const revisionActive = pending.planRevision === true;
    const refinementActive = pending.planRefinement === true;
    if (revisionActive) {
      const revisionContext =
        pending.planRevisionContext && typeof pending.planRevisionContext === "object"
          ? pending.planRevisionContext
          : {};
      pending.planUpdate = true;
      pending.planUpdateStage = "revision";
      pending.planUpdateContext = {
        summaryText: String(revisionContext.summaryText || "").trim(),
        targetMainStepIndexes: Array.isArray(revisionContext.targetMainStepIndexes)
          ? revisionContext.targetMainStepIndexes
          : [],
      };
      return;
    }
    if (refinementActive) {
      const refinementContext =
        pending.planRefinementContext && typeof pending.planRefinementContext === "object"
          ? pending.planRefinementContext
          : {};
      pending.planUpdate = true;
      pending.planUpdateStage = "refinement";
      pending.planUpdateContext = {
        summaryText: String(refinementContext.summaryText || "").trim(),
        targetMainStepIndexes: Array.isArray(refinementContext.targetMainStepIndexes)
          ? refinementContext.targetMainStepIndexes
          : [],
      };
      return;
    }
    pending.planUpdate = false;
    pending.planUpdateStage = "";
    pending.planUpdateContext = null;
  };
  if (active !== true) {
    const stageText = String(stage || "").trim().toLowerCase();
    if (stageText === "revision") {
      pending.planRevision = false;
      pending.planRevisionContext = null;
    } else if (stageText === "refinement") {
      pending.planRefinement = false;
      pending.planRefinementContext = null;
    } else {
      pending.planRevision = false;
      pending.planRevisionContext = null;
      pending.planRefinement = false;
      pending.planRefinementContext = null;
    }
    syncUnifiedFromIndependent();
    return true;
  }
  const normalizedStage = normalizePlanUpdateStage(stage);
  const normalizedSummaryText = String(summaryText || "").trim();
  const normalizedTargetMainStepIndexes = Array.isArray(targetMainStepIndexes)
    ? targetMainStepIndexes
    : [];
  const normalizedContext = {
    summaryText: normalizedSummaryText,
    targetMainStepIndexes: normalizedTargetMainStepIndexes,
  };
  if (normalizedStage === "revision") {
    pending.planRevision = true;
    pending.planRevisionContext = normalizedContext;
  } else {
    pending.planRefinement = true;
    pending.planRefinementContext = normalizedContext;
  }
  syncUnifiedFromIndependent();
  return true;
}

export function writePlanUpdateCaptureContext(
  state = {},
  { stage = "revision", summaryText = "", targetMainStepIndexes = [] } = {},
) {
  if (!state || typeof state !== "object") return false;
  if (!state.flags || typeof state.flags !== "object") state.flags = {};
  const normalizedStage = normalizePlanUpdateStage(stage);
  const normalizedSummaryText = String(summaryText || "").trim();
  const normalizedTargetMainStepIndexes = Array.isArray(targetMainStepIndexes)
    ? targetMainStepIndexes
    : [];
  state.flags.planUpdateCaptureStage = normalizedStage;
  state.flags.planUpdateCaptureSummaryText = normalizedSummaryText;
  state.flags.planUpdateCaptureTargetMainStepIndexes = normalizedTargetMainStepIndexes;
  return true;
}

export function readPlanUpdateCaptureContext(state = {}) {
  const flags = state?.flags && typeof state.flags === "object" ? state.flags : {};
  const stage = normalizePlanUpdateStage(
    flags.planUpdateCaptureStage || flags.planRevisionCaptureStage || "refinement",
  );
  const summaryText = String(
    flags.planUpdateCaptureSummaryText || flags.planRevisionCaptureSummaryText || "",
  ).trim();
  const targetMainStepIndexes = Array.isArray(flags.planUpdateCaptureTargetMainStepIndexes)
    ? flags.planUpdateCaptureTargetMainStepIndexes
    : Array.isArray(flags.planRevisionCaptureTargetMainStepIndexes)
      ? flags.planRevisionCaptureTargetMainStepIndexes
      : [];
  return { stage, summaryText, targetMainStepIndexes };
}

export function clearPlanUpdateCaptureContext(state = {}) {
  if (!state?.flags || typeof state.flags !== "object") return false;
  delete state.flags.planUpdateCaptureStage;
  delete state.flags.planUpdateCaptureSummaryText;
  delete state.flags.planUpdateCaptureTargetMainStepIndexes;
  return true;
}
