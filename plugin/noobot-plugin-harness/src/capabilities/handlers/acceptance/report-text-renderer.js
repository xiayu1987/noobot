/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ACCEPTANCE_MODE, HARNESS_I18N_KEYSET, LOCALE, translateI18nText } from "./deps.js";
import { text } from "@noobot/shared/value";

const ALLOWED_STATUS = new Set(["completed", "in_progress", "pending"]);

function hasRecognitionFailure(report = {}) {
  if (!report || typeof report !== "object") return true;
  if ("finalPlanChecklist" in report && !Array.isArray(report.finalPlanChecklist)) return true;
  if (
    "summary" in report &&
    (report.summary === null || typeof report.summary !== "object" || Array.isArray(report.summary))
  )
    return true;
  if (
    "semanticValidation" in report &&
    report.semanticValidation &&
    typeof report.semanticValidation !== "object"
  )
    return true;
  if (
    "modelAcceptance" in report &&
    report.modelAcceptance &&
    typeof report.modelAcceptance !== "object"
  )
    return true;

  const checklist = Array.isArray(report.finalPlanChecklist) ? report.finalPlanChecklist : [];
  for (const item of checklist) {
    const index = String(item?.index ?? "").trim();
    const task = text(item?.task);
    const status = text(item?.status) || "pending";
    if (!index || !task || !ALLOWED_STATUS.has(status)) return true;
  }

  if (
    report?.semanticValidation?.content !== undefined &&
    typeof report.semanticValidation.content !== "string"
  ) {
    return true;
  }
  if (
    report?.modelAcceptance?.rawContent !== undefined &&
    typeof report.modelAcceptance.rawContent !== "string"
  ) {
    return true;
  }
  return false;
}

function extractAcceptanceReportFields(report = {}) {
  const data = report && typeof report === "object" ? report : {};
  return {
    mode: text(data.mode) || "active",
    forcedReason: text(data.forcedReason),
    acceptedAt: text(data.acceptedAt),
    planText: text(data.planText || data?.plan?.planText),
    checklist: Array.isArray(data.finalPlanChecklist) ? data.finalPlanChecklist : [],
    summary: data?.summary && typeof data.summary === "object" ? data.summary : {},
    semanticValidation:
      data?.semanticValidation && typeof data.semanticValidation === "object"
        ? data.semanticValidation
        : null,
    modelAcceptance:
      data?.modelAcceptance && typeof data.modelAcceptance === "object"
        ? data.modelAcceptance
        : null,
  };
}

function renderRawAcceptanceReportText(report = {}, locale = LOCALE.ZH_CN) {
  const {
    mode,
    forcedReason,
    acceptedAt,
    planText,
    checklist,
    summary,
    semanticValidation,
    modelAcceptance,
  } = extractAcceptanceReportFields(report);
  const title = translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.RAW_TITLE);
  const forcedReasonField = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.RAW_FORCED_REASON_FIELD,
  );
  const planTextField = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.RAW_PLAN_TEXT_FIELD,
  );
  const checklistHeader = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.RAW_CHECKLIST_HEADER,
  );
  const summaryField = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.RAW_SUMMARY_FIELD,
  );
  const semanticField = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.RAW_SEMANTIC_FIELD,
  );
  const modelField = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.RAW_MODEL_FIELD,
  );
  const lines = [
    title,
    `mode: ${mode}`,
    mode === ACCEPTANCE_MODE.FORCED && forcedReason ? `${forcedReasonField}: ${forcedReason}` : "",
    acceptedAt ? `acceptedAt: ${acceptedAt}` : "",
    planText ? `${planTextField}:\n${planText}` : "",
    checklistHeader,
    ...checklist.map((item = {}) => {
      const index = String(item?.index ?? "").trim();
      const task = text(item?.task);
      const status = text(item?.status) || "pending";
      return `${index}. [${status}] ${task}`;
    }),
    Object.keys(summary).length ? `${summaryField}: ${JSON.stringify(summary)}` : "",
    semanticValidation?.content ? `${semanticField}:\n${String(semanticValidation.content)}` : "",
    modelAcceptance?.rawContent ? `${modelField}:\n${String(modelAcceptance.rawContent)}` : "",
  ].filter(Boolean);
  return lines.join("\n").trim();
}

function renderBeautifiedAcceptanceReportText(report = {}, locale = LOCALE.ZH_CN) {
  const {
    mode,
    forcedReason,
    acceptedAt,
    planText,
    checklist,
    summary,
    semanticValidation,
    modelAcceptance,
  } = extractAcceptanceReportFields(report);
  const title = translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.RAW_TITLE);
  const modeLabel = translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.MODE_LABEL);
  const forcedReasonLabel = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.FORCED_REASON_LABEL,
  );
  const acceptedAtLabel = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.ACCEPTED_AT_LABEL,
  );
  const planTextLabel = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.PLAN_TEXT_LABEL,
  );
  const checklistLabel = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.CHECKLIST_LABEL,
  );
  const summaryLabel = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.SUMMARY_LABEL,
  );
  const semanticLabel = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.SEMANTIC_VALIDATION_LABEL,
  );
  const modelAcceptanceLabel = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.MODEL_ACCEPTANCE_LABEL,
  );
  const emptyLine = translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_REPORT.EMPTY_LINE);

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
    planText ? ["", `## ${planTextLabel}`, "```text", planText, "```"].join("\n") : "",
    `## ${checklistLabel}`,
    ...(checklist.length
      ? checklist.map((item = {}) => {
          const index = String(item?.index ?? "").trim();
          const task = text(item?.task);
          const status = text(item?.status) || "pending";
          return `- ${index}. [${status}] ${task}`;
        })
      : [emptyLine]),
    Object.keys(summary).length
      ? [
          "",
          `## ${summaryLabel}`,
          `- total: ${summaryTotal}`,
          `- completed: ${summaryCompleted}`,
          `- inProgress: ${summaryInProgress}`,
          `- pending: ${summaryPending}`,
        ].join("\n")
      : "",
    semanticValidation?.content
      ? ["", `## ${semanticLabel}`, String(semanticValidation.content)].join("\n")
      : "",
    modelAcceptance?.rawContent
      ? ["", `## ${modelAcceptanceLabel}`, String(modelAcceptance.rawContent)].join("\n")
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
