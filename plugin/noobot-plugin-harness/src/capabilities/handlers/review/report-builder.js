/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { CAPABILITY_DOMAIN, appendCapabilityLog, ensureHarnessBucket } from "./deps.js";
import { HARNESS_HOOK_POINTS, HARNESS_RUN_STATUS } from "../../../core/constants.js";
import { collectRuleCodes } from "../shared/rule-table-utils.js";
import { nowIsoTimestamp } from "../shared/report-utils.js";

const REVIEW_EVENTS = WORKFLOW_PARAMS.logging.events.review;

const REVIEW_ERROR_POINTS = new Set([
  HARNESS_HOOK_POINTS.ON_ERROR,
  HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR,
  HARNESS_HOOK_POINTS.LLM_CALL_ERROR,
  HARNESS_HOOK_POINTS.TOOL_CALL_ERROR,
]);

const REVIEW_ISSUE_RULES = Object.freeze([
  {
    code: "planning_not_captured",
    when: ({ state = {} } = {}) => state?.flags?.planningCaptured !== true,
  },
  {
    code: "acceptance_has_pending_items",
    when: ({ acceptance = null } = {}) => Number(acceptance?.summary?.pending || 0) > 0,
  },
  {
    code: "acceptance_semantic_validation_failed_or_inconsistent",
    when: ({ acceptance = null } = {}) => {
      const semanticValidation = acceptance?.semanticValidation || null;
      if (!semanticValidation) return false;
      return (
        semanticValidation.consistent === false ||
        String(semanticValidation.status || "").toLowerCase() === "fail"
      );
    },
  },
  {
    code: "tool_failures_observed",
    when: ({ state = {} } = {}) => Number(state?.counters?.totalToolFailures || 0) > 0,
  },
  {
    code: "runtime_error_observed",
    when: ({ ctx = {} } = {}) => Boolean(ctx?.error),
  },
]);

function resolveReviewStatus(point = "", ctx = {}) {
  const explicitStatus = String(ctx?.status || "").trim();
  if (explicitStatus) return explicitStatus;
  if (REVIEW_ERROR_POINTS.has(point)) return HARNESS_RUN_STATUS.ERROR;
  if (point === HARNESS_HOOK_POINTS.ON_ABORT) return HARNESS_RUN_STATUS.ABORT;
  return HARNESS_RUN_STATUS.REVIEWED;
}

function collectReviewIssues({ state = {}, acceptance = null, ctx = {} } = {}) {
  return collectRuleCodes(REVIEW_ISSUE_RULES, { state, acceptance, ctx });
}

export function buildReviewReport(point = "", ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return null;
  const { bucket, state } = holder;
  const acceptance = bucket.lastAcceptanceReport || null;
  const semanticValidation = acceptance?.semanticValidation || null;
  const status = resolveReviewStatus(point, ctx);
  const issues = collectReviewIssues({ state, acceptance, ctx });
  return {
    point,
    status,
    reviewedAt: nowIsoTimestamp(),
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
    event: REVIEW_EVENTS.reportGenerated,
    detail: { point, issues: report.summary.issues },
  });
  return true;
}
