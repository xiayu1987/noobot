/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendReviewReport, buildReviewReport } from "./report-builder.js";
import { attachReviewReportToFinalOutput } from "./output-finalizer.js";
import { CAPABILITY_DOMAIN } from "../shared/constants.js";
import {
  appendWorkflowExecutionResult,
  appendWorkflowPriorityDecision,
  captureWorkflowLogCursor,
  resolveWorkflowExecutionMetrics,
  resolveWorkflowMode,
} from "../shared/workflow/pattern.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";

export function createReviewHandler() {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    const hook = String(point || "").trim();
    const mode = resolveWorkflowMode(meta);
    const startedAt = Date.now();
    const logCursor = captureWorkflowLogCursor(ctx, CAPABILITY_DOMAIN.REVIEW);
    enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.REVIEW });
    const reviewOptions = meta?.harness?.review && typeof meta.harness.review === "object"
      ? meta.harness.review
      : {};
    const attachToFinalOutput = hook === "before_final_output" && reviewOptions.attachToFinalOutput !== false;
    appendWorkflowPriorityDecision(ctx, {
      domain: CAPABILITY_DOMAIN.REVIEW,
      point: hook,
      mode,
      chosenAction: "review_report",
      chosenReason: "hook_review",
      pending: { attachToFinalOutput },
    });
    const report = buildReviewReport(point, ctx);
    const appended = appendReviewReport(point, ctx, report);
    const attached = attachToFinalOutput ? attachReviewReportToFinalOutput(ctx, report) : false;
    const metrics = resolveWorkflowExecutionMetrics(ctx, {
      domain: CAPABILITY_DOMAIN.REVIEW,
      startCursor: logCursor,
    });
    appendWorkflowExecutionResult(ctx, {
      domain: CAPABILITY_DOMAIN.REVIEW,
      point: hook,
      mode,
      chosenAction: "review_report",
      chosenReason: "hook_review",
      requestedAction: attachToFinalOutput ? "review_report_attach_output" : "review_report_internal",
      executedPrimary: appended === true,
      executedFollowup: attached === true,
      changed: appended || attached,
      durationMs: Date.now() - startedAt,
      retryCount: metrics.retryCount,
      errorCode: metrics.errorCode,
    });
    return { capability, point, status: "active", changed: appended || attached };
  };
}
