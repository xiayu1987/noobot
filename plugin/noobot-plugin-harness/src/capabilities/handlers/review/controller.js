/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendReviewReport, buildReviewReport } from "./report-builder.js";
import { attachReviewReportToFinalOutput } from "./output-finalizer.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { CAPABILITY_DOMAIN } from "../shared/constants.js";
import {
  resolveWorkflowMode,
  runWorkflowLifecycle,
} from "../shared/workflow/pattern.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";

const REVIEW_DECISION = WORKFLOW_PARAMS.review.decisions;

export function createReviewHandler() {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    const hook = String(point || "").trim();
    const mode = resolveWorkflowMode(meta);
    enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.REVIEW });
    const reviewOptions = meta?.harness?.review && typeof meta.harness.review === "object"
      ? meta.harness.review
      : {};
    const attachToFinalOutput = hook === "before_final_output" && reviewOptions.attachToFinalOutput !== false;
    const lifecycle = await runWorkflowLifecycle(ctx, {
      domain: CAPABILITY_DOMAIN.REVIEW,
      point: hook,
      mode,
      resolveDecision: () => ({
        chosenAction: REVIEW_DECISION.action.reviewReport,
        chosenReason: REVIEW_DECISION.reason.hookReview,
        pending: { attachToFinalOutput },
      }),
      execute: async () => {
        const report = buildReviewReport(point, ctx);
        const appended = appendReviewReport(point, ctx, report);
        const attached = attachToFinalOutput ? attachReviewReportToFinalOutput(ctx, report) : false;
        return {
          requestedAction: attachToFinalOutput
            ? REVIEW_DECISION.requestedAction.reportAttachOutput
            : REVIEW_DECISION.requestedAction.reportInternal,
          executedPrimary: appended === true,
          executedFollowup: attached === true,
          changed: appended || attached,
        };
      },
    });
    return { capability, point, status: "active", changed: lifecycle.execution.changed };
  };
}
