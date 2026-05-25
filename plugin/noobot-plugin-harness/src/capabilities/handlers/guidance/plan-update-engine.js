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

export function normalizePlanUpdateStage(stage = "") {
  return String(stage || "").trim().toLowerCase() === "revision" ? "revision" : "refinement";
}

export function resolvePlanUpdateAttempts(state = {}) {
  if (!state || typeof state !== "object") return 0;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  return Number.isFinite(Number(state.counters.planUpdateAttempts))
    ? Number(state.counters.planUpdateAttempts)
    : Number.isFinite(Number(state.counters.planRevisionAttempts))
      ? Number(state.counters.planRevisionAttempts)
      : 0;
}

function syncPlanUpdateAttempts(state = {}, next = 0) {
  if (!state || typeof state !== "object") return;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  state.counters.planUpdateAttempts = next;
}

export function canAttemptPlanUpdate(
  ctx = {},
  state = {},
  { increment = false, stage = "revision" } = {},
) {
  if (!state || typeof state !== "object") return false;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  const normalizedStage = normalizePlanUpdateStage(stage);
  const current = resolvePlanUpdateAttempts(state);
  if (current >= PLAN_UPDATE_POLICY.MAX_ATTEMPTS) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_revision_skipped_by_max_attempts",
      detail: {
        stage: normalizedStage,
        current,
        limit: PLAN_UPDATE_POLICY.MAX_ATTEMPTS,
      },
    });
    return false;
  }
  if (increment) {
    syncPlanUpdateAttempts(state, current + 1);
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
  if (active !== true) {
    pending.planUpdate = false;
    pending.planUpdateStage = "";
    pending.planUpdateContext = null;
    return true;
  }
  const normalizedStage = normalizePlanUpdateStage(stage);
  const normalizedSummaryText = String(summaryText || "").trim();
  const normalizedTargetMainStepIndexes = Array.isArray(targetMainStepIndexes)
    ? targetMainStepIndexes
    : [];
  pending.planUpdate = true;
  pending.planUpdateStage = normalizedStage;
  pending.planUpdateContext = {
    summaryText: normalizedSummaryText,
    targetMainStepIndexes: normalizedTargetMainStepIndexes,
  };
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
