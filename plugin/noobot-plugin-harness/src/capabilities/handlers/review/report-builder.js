/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CAPABILITY_DOMAIN, appendCapabilityLog, ensureHarnessBucket } from "./deps.js";
import { HARNESS_HOOK_POINTS, HARNESS_RUN_STATUS } from "../../../core/constants.js";

export function buildReviewReport(point = "", ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return null;
  const { bucket, state } = holder;
  const acceptance = bucket.lastAcceptanceReport || null;
  const errorPoints = new Set([
    HARNESS_HOOK_POINTS.ON_ERROR,
    HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR,
    HARNESS_HOOK_POINTS.LLM_CALL_ERROR,
    HARNESS_HOOK_POINTS.TOOL_CALL_ERROR,
  ]);
  const status = String(ctx?.status || "").trim() ||
    (errorPoints.has(point)
      ? HARNESS_RUN_STATUS.ERROR
      : point === HARNESS_HOOK_POINTS.ON_ABORT
        ? HARNESS_RUN_STATUS.ABORT
        : HARNESS_RUN_STATUS.REVIEWED);
  const issues = [];
  if (state.flags.planningCaptured !== true) issues.push("planning_not_captured");
  if (acceptance?.summary?.pending > 0) issues.push("acceptance_has_pending_items");
  const semanticValidation = acceptance?.semanticValidation || null;
  if (semanticValidation && (semanticValidation.consistent === false || String(semanticValidation.status || "").toLowerCase() === "fail")) {
    issues.push("acceptance_semantic_validation_failed_or_inconsistent");
  }
  if (state.counters.totalToolFailures > 0) issues.push("tool_failures_observed");
  if (ctx?.error) issues.push("runtime_error_observed");
  return {
    point,
    status,
    reviewedAt: new Date().toISOString(),
    summary: {
      planningCaptured: state.flags.planningCaptured === true,
      acceptanceRequested: state.flags.acceptanceRequested === true,
      successfulToolCount: state.signals.successfulToolCount || 0,
      totalToolFailures: state.counters.totalToolFailures || 0,
      pendingAcceptanceItems: acceptance?.summary?.pending ?? null,
      semanticValidationStatus: semanticValidation?.status ?? null,
      semanticValidationConsistent: semanticValidation?.consistent ?? null,
      issues,
    },
    acceptanceReport: acceptance || undefined,
    error: ctx?.error ? String(ctx.error?.message || ctx.error || "") : undefined,
  };
}

export function appendReviewReport(point = "", ctx = {}, report = null) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder || !report) return false;
  const { bucket } = holder;
  bucket.lastReviewReport = report;
  bucket.reviewReports.push(report);
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.REVIEW,
    event: "review_report_generated",
    detail: { point, issues: report.summary.issues },
  });
  return true;
}
