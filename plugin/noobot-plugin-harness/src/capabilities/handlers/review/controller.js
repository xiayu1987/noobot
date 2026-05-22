/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendReviewReport, buildReviewReport } from "./report-builder.js";
import { attachReviewReportToFinalOutput } from "./output-finalizer.js";

export function createReviewHandler() {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    const hook = String(point || "").trim();
    const reviewOptions = meta?.harness?.review && typeof meta.harness.review === "object"
      ? meta.harness.review
      : {};
    const attachToFinalOutput = hook === "before_final_output" && reviewOptions.attachToFinalOutput !== false;
    const report = buildReviewReport(point, ctx);
    const appended = appendReviewReport(point, ctx, report);
    const attached = attachToFinalOutput ? attachReviewReportToFinalOutput(ctx, report) : false;
    return { capability, point, status: "active", changed: appended || attached };
  };
}
