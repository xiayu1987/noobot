/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendReviewReport, buildReviewReport } from "./report-builder.js";
import { attachReviewReportToFinalOutput } from "./output-finalizer.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { CAPABILITY_DOMAIN } from "../shared/constants.js";
import { ensureHarnessBucket } from "../shared/bucket-utils.js";
import { translateI18nText } from "../shared/i18n.js";
import {
  resolveWorkflowMode,
  runWorkflowLifecycle,
} from "../shared/workflow/pattern.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";

const REVIEW_DECISION = WORKFLOW_PARAMS.review.decisions;
const REVIEW_HOOKS = new Set(
  Array.isArray(WORKFLOW_PARAMS.review?.hooks) ? WORKFLOW_PARAMS.review.hooks : ["before_final_output", "on_error", "on_abort"],
);
const REVIEW_REASON_LABEL_KEY = Object.freeze({
  [REVIEW_DECISION.reason.hookReview]: "reviewReasonHookReview",
});

function resolveReviewReasonLabel(locale = "zh-CN", reason = "") {
  const key = REVIEW_REASON_LABEL_KEY[String(reason || "").trim()];
  if (!key) return String(reason || "").trim();
  return translateI18nText(locale, key) || String(reason || "").trim();
}

export function createReviewHandler() {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    const hook = String(point || "").trim();
    if (!REVIEW_HOOKS.has(hook)) {
      return { capability, point, status: "active", changed: false };
    }
    const mode = resolveWorkflowMode(meta);
    enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.REVIEW });
    const locale = String(ensureHarnessBucket(ctx)?.state?.locale || "zh-CN").trim() || "zh-CN";
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
        chosenReasonLabel: resolveReviewReasonLabel(locale, REVIEW_DECISION.reason.hookReview),
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
