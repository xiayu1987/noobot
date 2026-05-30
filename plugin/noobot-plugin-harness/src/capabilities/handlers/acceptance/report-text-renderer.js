/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ACCEPTANCE_MODE, LOCALE } from "./deps.js";

const ALLOWED_STATUS = new Set(["completed", "in_progress", "pending"]);

function hasRecognitionFailure(report = {}) {
  if (!report || typeof report !== "object") return true;
  if ("finalPlanChecklist" in report && !Array.isArray(report.finalPlanChecklist)) return true;
  if ("summaryDetailPaths" in report && !Array.isArray(report.summaryDetailPaths)) return true;
  if ("summary" in report && (report.summary === null || typeof report.summary !== "object" || Array.isArray(report.summary))) return true;
  if ("semanticValidation" in report && report.semanticValidation && typeof report.semanticValidation !== "object") return true;

  const checklist = Array.isArray(report.finalPlanChecklist) ? report.finalPlanChecklist : [];
  for (const item of checklist) {
    const index = String(item?.index ?? "").trim();
    const task = String(item?.task || "").trim();
    const status = String(item?.status || "").trim() || "pending";
    if (!index || !task || !ALLOWED_STATUS.has(status)) return true;
  }

  const summaryDetailPaths = Array.isArray(report.summaryDetailPaths) ? report.summaryDetailPaths : [];
  for (const p of summaryDetailPaths) {
    if (!String(p || "").trim()) return true;
  }

  if (report?.semanticValidation?.content !== undefined && typeof report.semanticValidation.content !== "string") {
    return true;
  }
  return false;
}

function renderRawAcceptanceReportText(report = {}, locale = LOCALE.ZH_CN) {
  const data = report && typeof report === "object" ? report : {};
  const mode = String(data.mode || "").trim() || "active";
  const forcedReason = String(data.forcedReason || "").trim();
  const acceptedAt = String(data.acceptedAt || "").trim() || "";
  const planText = String(data.planText || data?.plan?.planText || "").trim();
  const checklist = Array.isArray(data.finalPlanChecklist) ? data.finalPlanChecklist : [];
  const summary = data?.summary && typeof data.summary === "object" ? data.summary : {};
  const semanticValidation = data?.semanticValidation && typeof data.semanticValidation === "object"
    ? data.semanticValidation
    : null;
  const summaryDetailPaths = Array.isArray(data?.summaryDetailPaths) ? data.summaryDetailPaths : [];
  const lines = [
    locale === LOCALE.EN_US ? "[Harness-Acceptance]" : "[Harness-验收]",
    `mode: ${mode}`,
    mode === ACCEPTANCE_MODE.FORCED && forcedReason
      ? `${locale === LOCALE.EN_US ? "forcedReason" : "强制原因"}: ${forcedReason}`
      : "",
    acceptedAt ? `acceptedAt: ${acceptedAt}` : "",
    planText
      ? `${locale === LOCALE.EN_US ? "planText" : "计划文本"}:\n${planText}`
      : "",
    locale === LOCALE.EN_US ? "Acceptance Checklist:" : "验收清单：",
    ...checklist.map((item = {}) => {
      const index = String(item?.index ?? "").trim();
      const task = String(item?.task || "").trim();
      const status = String(item?.status || "").trim() || "pending";
      return `${index}. [${status}] ${task}`;
    }),
    Object.keys(summary).length
      ? `${locale === LOCALE.EN_US ? "summary" : "汇总"}: ${JSON.stringify(summary)}`
      : "",
    semanticValidation?.content
      ? `${locale === LOCALE.EN_US ? "semanticValidation" : "语义验收"}:\n${String(semanticValidation.content)}`
      : "",
    summaryDetailPaths.length
      ? `${
        locale === LOCALE.EN_US ? "summaryDetailPaths" : "小结明细路径"
      }:\n${summaryDetailPaths.map((item) => `- ${String(item || "").trim()}`).join("\n")}`
      : "",
  ].filter(Boolean);
  return lines.join("\n").trim();
}

function renderBeautifiedAcceptanceReportText(report = {}, locale = LOCALE.ZH_CN) {
  const data = report && typeof report === "object" ? report : {};
  const mode = String(data.mode || "").trim() || "active";
  const forcedReason = String(data.forcedReason || "").trim();
  const acceptedAt = String(data.acceptedAt || "").trim() || "";
  const planText = String(data.planText || data?.plan?.planText || "").trim();
  const checklist = Array.isArray(data.finalPlanChecklist) ? data.finalPlanChecklist : [];
  const summary = data?.summary && typeof data.summary === "object" ? data.summary : {};
  const semanticValidation = data?.semanticValidation && typeof data.semanticValidation === "object"
    ? data.semanticValidation
    : null;
  const summaryDetailPaths = Array.isArray(data?.summaryDetailPaths) ? data.summaryDetailPaths : [];
  const title = locale === LOCALE.EN_US ? "[Harness-Acceptance]" : "[Harness-验收]";
  const modeLabel = locale === LOCALE.EN_US ? "Mode" : "模式";
  const forcedReasonLabel = locale === LOCALE.EN_US ? "Forced reason" : "强制原因";
  const acceptedAtLabel = locale === LOCALE.EN_US ? "Accepted at" : "验收时间";
  const planTextLabel = locale === LOCALE.EN_US ? "Plan text" : "计划文本";
  const checklistLabel = locale === LOCALE.EN_US ? "Acceptance checklist" : "验收清单";
  const summaryLabel = locale === LOCALE.EN_US ? "Summary" : "汇总";
  const semanticLabel = locale === LOCALE.EN_US ? "Semantic validation" : "语义验收";
  const detailPathLabel = locale === LOCALE.EN_US ? "Summary detail paths" : "小结明细路径";

  const summaryCompleted = Number(summary?.completed || 0);
  const summaryInProgress = Number(summary?.inProgress || 0);
  const summaryPending = Number(summary?.pending || 0);
  const summaryTotal = Number(summary?.total || 0);

  const lines = [
    title,
    "",
    `## ${modeLabel}`,
    `- ${mode}`,
    mode === ACCEPTANCE_MODE.FORCED && forcedReason
      ? `- ${forcedReasonLabel}: ${forcedReason}`
      : "",
    acceptedAt ? `- ${acceptedAtLabel}: ${acceptedAt}` : "",
    planText
      ? ["", `## ${planTextLabel}`, "```text", planText, "```"].join("\n")
      : "",
    `## ${checklistLabel}`,
    ...(checklist.length
      ? checklist.map((item = {}) => {
        const index = String(item?.index ?? "").trim();
        const task = String(item?.task || "").trim();
        const status = String(item?.status || "").trim() || "pending";
        return `- ${index}. [${status}] ${task}`;
      })
      : [locale === LOCALE.EN_US ? "- (empty)" : "- （空）"]),
    Object.keys(summary).length
      ? ["", `## ${summaryLabel}`, `- total: ${summaryTotal}`, `- completed: ${summaryCompleted}`, `- inProgress: ${summaryInProgress}`, `- pending: ${summaryPending}`].join("\n")
      : "",
    semanticValidation?.content
      ? ["", `## ${semanticLabel}`, String(semanticValidation.content)].join("\n")
      : "",
    summaryDetailPaths.length
      ? ["", `## ${detailPathLabel}`, ...summaryDetailPaths.map((item) => `- ${String(item || "").trim()}`)].join("\n")
      : "",
  ].filter(Boolean);
  return lines.join("\n").trim();
}

export function renderAcceptanceReportText(report = {}, locale = LOCALE.ZH_CN) {
  if (hasRecognitionFailure(report)) {
    return renderRawAcceptanceReportText(report, locale);
  }
  return renderBeautifiedAcceptanceReportText(report, locale);
}

export { renderBeautifiedAcceptanceReportText, renderRawAcceptanceReportText };

