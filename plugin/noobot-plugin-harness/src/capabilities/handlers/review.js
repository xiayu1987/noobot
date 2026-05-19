import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
  t,
} from "./shared.js";

function buildReviewReport(point = "", ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return null;
  const { bucket, state } = holder;
  const acceptance = bucket.lastAcceptanceReport || null;
  const status = String(ctx?.status || "").trim() ||
    (["on_error", "context_build_error", "llm_call_error", "tool_call_error"].includes(point)
      ? "error"
      : point === "on_abort"
        ? "abort"
        : "reviewed");
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

function appendReviewReport(point = "", ctx = {}, { attachToFinalOutput = false } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const report = buildReviewReport(point, ctx);
  if (!report) return false;
  bucket.lastReviewReport = report;
  bucket.reviewReports.push(report);
  if (attachToFinalOutput && ctx?.result && typeof ctx.result === "object") {
    const locale = state?.locale || LOCALE.ZH_CN;
    const original = String(ctx.result.output || "").trim();
    ctx.result.output = [original, "", t(locale, "reviewHeader"), JSON.stringify(report, null, 2)]
      .filter(Boolean)
      .join("\n");
  }
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.REVIEW,
    event: "review_report_generated",
    detail: { point, issues: report.summary.issues },
  });
  return true;
}

export function createReviewHandler() {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    const hook = String(point || "").trim();
    const reviewOptions = meta?.harness?.review && typeof meta.harness.review === "object"
      ? meta.harness.review
      : {};
    const attachToFinalOutput = hook === "before_final_output" && reviewOptions.attachToFinalOutput !== false;
    const changed = appendReviewReport(point, ctx, { attachToFinalOutput });
    return { capability, point, status: "active", changed };
  };
}
