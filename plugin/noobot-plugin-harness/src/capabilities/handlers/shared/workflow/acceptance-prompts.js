/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { resolveCompletePlanChecklistText } from "../plan/checklist-context.js";
import { buildAcceptancePatchProtocolText as buildAcceptancePatchProtocolCoreText } from "./protocols.js";
import { normalizePromptOptions } from "./prompt-options.js";
import { buildScenarioPolicyPromptText } from "./scenario-policy-prompts.js";

export function buildAcceptancePatchProtocolText(options = {}) {
  const { locale, data } = normalizePromptOptions(options);
  const mode = String(data.mode || options?.mode || "final")
    .trim()
    .toLowerCase();
  return buildAcceptancePatchProtocolCoreText({
    locale,
    mode,
  });
}

export function buildAcceptanceMainPlanContextPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const payload = data.mainPlanContext ?? options?.mainPlanContext ?? null;
  const source = payload && typeof payload === "object" ? payload : {};
  const planTextFromPayload = String(source?.planText || "").trim();
  const currentTaskGoal = String(source?.currentTaskGoal || "").trim();
  const plansInOrder = Array.isArray(source?.plansInOrder) ? source.plansInOrder : [];
  const checklist = Array.isArray(source?.taskChecklist) ? source.taskChecklist : [];
  const planChecklistText = (() => {
    const mergedPlanTextFromOrderedPlans = plansInOrder
      .map((item = {}) => String(item?.planText || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const resolved = resolveCompletePlanChecklistText({
      planText: planTextFromPayload || mergedPlanTextFromOrderedPlans,
      bucket: { taskChecklist: checklist },
      currentTaskGoal,
      locale,
    });
    if (resolved) return resolved;
    return translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT);
  })();
  return [
    String(marker || "").trim(),
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.ACCEPTANCE_MAIN_PLAN_CONTEXT_HEADER,
    ),
    planChecklistText,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAllPhaseAcceptanceReportSystemContents(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const reports = Array.isArray(data.phaseAcceptanceReports)
    ? data.phaseAcceptanceReports
    : Array.isArray(options?.phaseAcceptanceReports)
      ? options.phaseAcceptanceReports
      : [];
  if (!reports.length) return [];
  return reports.map((item = {}, index) => {
    const acceptedAt = String(item?.acceptedAt || item?.timestamp || "").trim();
    const content = String(item?.content || item?.text || "").trim();
    const total = reports.length;
    return [
      String(marker || "").trim(),
      translateI18nText(
        locale,
        HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PHASE_ACCEPTANCE_CHECKLIST_TITLE,
        {
          index: index + 1,
          total,
        },
      ),
      `#${index + 1}${acceptedAt ? ` @ ${acceptedAt}` : ""}`,
      content ||
        translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT),
    ]
      .filter(Boolean)
      .join("\n");
  });
}

export function buildAllSummaryReportSystemContents(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const reportText = String(
    data.latestCompleteSummaryText ??
      options?.latestCompleteSummaryText ??
      data.latestSummaryOverview ??
      options?.latestSummaryOverview ??
      "",
  ).trim();
  if (!reportText) return [];
  return [
    [
      String(marker || "").trim(),
      translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.SUMMARY_CHECKLIST_TITLE, {
        index: 1,
        total: 1,
      }),
      "#1",
      reportText,
    ]
      .filter(Boolean)
      .join("\n"),
  ];
}

export function buildPhaseAcceptanceRequestPromptText(options = {}) {
  const { locale, marker, data, programmingMode, textMode, dynamicPolicyPrompt } =
    normalizePromptOptions(options);
  const payload =
    data.requestPayload ?? data.payload ?? options?.requestPayload ?? options?.payload ?? {};
  const payloadText = JSON.stringify(payload || {}, null, 2);
  const includeWorkflowPolicy = options?.includeWorkflowPolicy === true;
  const includeProtocol = options?.includeProtocol !== false;
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PHASE_ACCEPTANCE_REQUEST_GOAL),
    includeWorkflowPolicy
      ? buildScenarioPolicyPromptText(locale, { programmingMode, textMode, dynamicPolicyPrompt })
      : "",
    includeProtocol ? buildAcceptancePatchProtocolText({ locale, mode: "phase" }) : "",
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PHASE_ACCEPTANCE_REQUEST_CONSTRAINT,
    ),
    payloadText,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAcceptanceValidationRequestPromptText(options = {}) {
  const { locale, marker, data, programmingMode, textMode, dynamicPolicyPrompt } =
    normalizePromptOptions(options);
  const payload =
    data.requestPayload ?? data.payload ?? options?.requestPayload ?? options?.payload ?? null;
  const payloadText = JSON.stringify(payload || {}, null, 2);
  const includeWorkflowPolicy = options?.includeWorkflowPolicy === true;
  const includeProtocol = options?.includeProtocol !== false;
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.FINAL_ACCEPTANCE_REQUEST_GOAL),
    includeWorkflowPolicy
      ? buildScenarioPolicyPromptText(locale, { programmingMode, textMode, dynamicPolicyPrompt })
      : "",
    includeProtocol ? buildAcceptancePatchProtocolText({ locale, mode: "final" }) : "",
    payloadText,
  ]
    .filter(Boolean)
    .join("\n");
}
