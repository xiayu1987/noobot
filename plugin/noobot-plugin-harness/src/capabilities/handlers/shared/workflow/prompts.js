/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { resolveCompletePlanChecklistText } from "../plan/checklist-context.js";
import { parseSummaryItemsFromText } from "../plan/summary-text-protocol.js";
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import {
  buildAcceptancePatchProtocolText as buildAcceptancePatchProtocolCoreText,
  buildPlanningMainPatchProtocolText as buildPlanningMainPatchProtocolCoreText,
  buildPlanningRefinementPatchProtocolText as buildPlanningRefinementPatchProtocolCoreText,
  buildPlanningRevisionPatchProtocolText as buildPlanningRevisionPatchProtocolCoreText,
  buildSummaryPatchProtocolText as buildSummaryPatchProtocolCoreText,
} from "./protocols.js";

const PLAN_UPDATE_POLICY = Object.freeze({
  MAX_ATTEMPTS_REVISION: WORKFLOW_PARAMS.planning.planUpdate.revisionMaxAttempts,
});

function normalizePromptOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const data = source.data && typeof source.data === "object" ? source.data : {};
  return {
    locale: source.locale || LOCALE.ZH_CN,
    marker: String(source.marker || "").trim(),
    data,
    programmingMode: source.programmingMode === true || source.isProgrammingMode === true || data.programmingMode === true,
  };
}

function normalizeScenarioText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isProgrammingScenarioText(value = "") {
  const text = normalizeScenarioText(value);
  return text === "programming" || text === "coding" || text.includes("programming") || text.includes("coding") || text.includes("\u7f16\u7a0b");
}

export function resolveProgrammingModeFromContext(ctx = {}) {
  const runtime = ctx?.agentContext?.execution?.controllers?.runtime || ctx?.runtime || null;
  const candidates = [
    ctx?.runConfig,
    runtime?.runConfig,
    runtime?.systemRuntime?.runConfig,
    ctx?.agentContext?.runConfig,
  ].filter((item) => item && typeof item === "object");
  for (const runConfig of candidates) {
    if (isProgrammingScenarioText(runConfig?.scenario)) return true;
    if (isProgrammingScenarioText(runConfig?.scenarioProfile?.key)) return true;
    if (isProgrammingScenarioText(runConfig?.scenarioProfile?.name)) return true;
  }
  return false;
}

export function getPlanningPromptMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-bootstrap -->";
}

export function getPlanningToolContextMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-tools -->";
}

export function getPlanningPromptToolsHeader(locale = LOCALE.ZH_CN) {
  return translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_PROMPT_TOOLS_HEADER);
}

export function getPlanningContextSummaryHeader(locale = LOCALE.ZH_CN) {
  return translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_CONTEXT_SUMMARY_HEADER);
}

export function getPlanningSeparateModelEmptyRelay(locale = LOCALE.ZH_CN) {
  return translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_SEPARATE_MODEL_EMPTY_RELAY);
}

export function buildPostPlanUserFollowupPrompt(
  locale = LOCALE.ZH_CN,
  stage = "planning",
) {
  const normalizedStage = String(stage || "planning").trim().toLowerCase();
  const isRefinement = normalizedStage.includes("refinement");
  const isRevision = normalizedStage.includes("revision");
  if (isRefinement) return translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.POST_PLAN_FOLLOWUP_REFINEMENT);
  if (isRevision) return translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.POST_PLAN_FOLLOWUP_REVISION);
  return translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.POST_PLAN_FOLLOWUP_PLANNING);
}

export function buildWorkflowResponsibilityConstraintUserPrompt(
  locale = LOCALE.ZH_CN,
  stage = "planning",
) {
  const normalizedStage = String(stage || "planning").trim().toLowerCase();
  let stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_PLANNING;
  if (normalizedStage.includes("revision")) stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_REVISION;
  else if (normalizedStage.includes("refinement")) stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_REFINEMENT;
  else if (normalizedStage.includes("summary")) stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_SUMMARY;
  else if (normalizedStage.includes("phase_acceptance")) stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_PHASE_ACCEPTANCE;
  else if (
    normalizedStage.includes("acceptance_semantic_validation") ||
    normalizedStage.includes("final_acceptance")
  ) stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_FINAL_ACCEPTANCE;
  const stageLabel = translateI18nText(locale, stageKey);
  return translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_CONSTRAINT_TEMPLATE, { stage: stageLabel });
}

export function getPlanningRevisionMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-revision -->";
}

export function getPlanningRefinementMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-refinement -->";
}

export function getGuidanceSummaryMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-guidance-summary -->";
}

export function getGuidanceMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-guidance -->";
}

export function buildGuidanceFailurePromptText({
  locale = LOCALE.ZH_CN,
  marker = "",
  reason = "",
} = {}) {
  const message = translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_FAILURE_PROMPT_TEMPLATE, {
    reason: String(reason || "").trim(),
  });
  return [String(marker || "").trim(), message].filter(Boolean).join("\n");
}

export function getAcceptanceSemanticValidationMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-acceptance-semantic-validation -->";
}

export function getAcceptanceMainPlanContextMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-acceptance-main-plan -->";
}

export function getPhaseAcceptanceRequestMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-phase-acceptance-request -->";
}

export function getAllPhaseAcceptanceReportsMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-phase-acceptance-reports -->";
}

export function getAllSummaryReportsMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-summary-reports -->";
}

export function buildAcceptancePatchProtocolText(options = {}) {
  const { locale, data } = normalizePromptOptions(options);
  const mode = String(data.mode || options?.mode || "final").trim().toLowerCase();
  return buildAcceptancePatchProtocolCoreText({
    locale,
    mode,
  });
}

export function buildPlanningMainPrompt(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const userGoal = String(data.userGoal || options?.userGoal || "").trim();
  const goal = String(userGoal || "").trim() || translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_LATEST_USER_GOAL_FALLBACK);
  const currentTaskGoalProtocol = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_CURRENT_TASK_GOAL_PROTOCOL,
  );
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_PROMPT_GOAL),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_USER_GOAL_HEADER),
    goal,
    "",
    buildPlanningMainPatchProtocolCoreText({ locale, actions: ["ADD"] }),
    "",
    currentTaskGoalProtocol,
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_CONSTRAINT),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_EXAMPLE_HEADER),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_EXAMPLE_ADD),
  ].filter(Boolean).join("\n");
}

export function buildPlanningRevisionPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const globalRevisionCount = data.globalRevisionCount ?? options?.globalRevisionCount ?? 0;
  const currentMainPlansText = data.currentMainPlansText ?? options?.currentMainPlansText ?? "";
  const includeCurrentMainPlans = data.includeCurrentMainPlans ?? options?.includeCurrentMainPlans ?? true;
  const mainPlansText = String(currentMainPlansText || "").trim() || translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT);
  const revisionCount = Number.isFinite(Number(globalRevisionCount)) ? Number(globalRevisionCount) : 0;
  const currentPlanSection = includeCurrentMainPlans === false
    ? []
    : [translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_CURRENT_PLAN_LABEL), mainPlansText];
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_PROMPT_GOAL),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_STATUS_HEADER),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_COUNT_LINE, {
      revisionCount,
      maxAttempts: Number(PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REVISION),
    }),
    ...currentPlanSection,
    buildPlanningRevisionPatchProtocolCoreText(locale),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_CONSTRAINT),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_EXAMPLE_HEADER),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_EXAMPLE_UPDATE),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_EXAMPLE_ADD),
  ].filter(Boolean).join("\n");
}

export function buildPlanningRefinementPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const targetIdsRaw = Array.isArray(data.targetIds)
    ? data.targetIds
    : Array.isArray(options?.targetIds)
      ? options.targetIds
      : [];
  const targetIds = targetIdsRaw
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
  const targetPlansText = data.targetPlansText ?? options?.targetPlansText ?? "";
  const targetId = data.targetId ?? options?.targetId ?? targetIds[0] ?? 1;
  const targetContent = data.targetContent ?? options?.targetContent ?? "";
  const existingSubPlansText = data.existingSubPlansText ?? options?.existingSubPlansText ?? "";
  const id = Number.isFinite(Number(targetId)) ? Number(targetId) : 1;
  const content = String(targetContent || "").trim();
  const targetIdListText = targetIds.length ? `[${targetIds.join(",")}]` : `[${id}]`;
  const targetPlans = String(targetPlansText || "").trim() || `${id}. ${content}`.trim();
  const subPlans = String(existingSubPlansText || "").trim() || translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT);
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_PROMPT_GOAL),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_TARGETS_HEADER),
    targetPlans || translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_TARGET_IDS_HEADER),
    targetIdListText,
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_TARGET_ONLY_CONSTRAINT),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_EXISTING_SUBSTEPS_LABEL),
    subPlans,
    "",
    buildPlanningRefinementPatchProtocolCoreText(locale),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_EXAMPLE_HEADER),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_EXAMPLE_ADD),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_EXAMPLE_UPDATE),
  ].filter(Boolean).join("\n");
}

export function buildGuidanceSummaryPromptText(options = {}) {
  const { locale, marker, programmingMode } = normalizePromptOptions(options);
  const overviewSample = programmingMode
    ? "1. [plan=2][status=done][evidence=...][file=src/example.js][method=handleRequest][line=10-20,35,48-52] ..."
    : "1. [plan=2][status=done][evidence=...] ...";
  const nextSuggestionSample = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_NEXT_SUGGESTION_SAMPLE,
  );
  const riskSampleKey = programmingMode
    ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_SAMPLE_RISK_HIGH_PROGRAMMING
    : HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_SAMPLE_RISK_HIGH;
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROMPT_GOAL),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROTOCOL_HINT),
    "[SUMMARY_OVERVIEW]",
    overviewSample,
    translateI18nText(locale, riskSampleKey),
    "[SUMMARY_DETAIL]",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_DETAIL_HEADER),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_DETAIL_SAMPLE),
    "[NEXT_EXECUTION_SUGGESTION]",
    nextSuggestionSample,
    "[SUMMARY_END]",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_RULES),
    programmingMode ? translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROGRAMMING_RULES) : "",
    buildSummaryPatchProtocolCoreText({ locale, programmingMode }),
  ].filter(Boolean).join("\n");
}

export function buildPreviousSummaryContextContent({
  locale = LOCALE.ZH_CN,
  previousSummaryContent = "",
} = {}) {
  const text = String(previousSummaryContent || "").trim();
  if (!text) return "";
  const header = `<!-- harness-previous-summary-context -->\n${translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PREVIOUS_SUMMARY_CONTEXT_HEADER,
  )}`;
  return `${header}\n${text}`;
}

export function buildPreviousSummaryContextMessages(options = {}) {
  const content = buildPreviousSummaryContextContent(options);
  if (!content) return [];
  return [{ role: "system", content }];
}

export function buildAcceptanceValidationPromptText(options = {}) {
  return buildAcceptanceValidationRequestPromptText(options);
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
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.ACCEPTANCE_MAIN_PLAN_CONTEXT_HEADER),
    planChecklistText,
  ].filter(Boolean).join("\n");
}

export function buildPhaseAcceptanceRequestPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const payload = data.requestPayload ?? data.payload ?? options?.requestPayload ?? options?.payload ?? {};
  const payloadText = JSON.stringify(payload || {}, null, 2);
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PHASE_ACCEPTANCE_REQUEST_GOAL),
    buildAcceptancePatchProtocolText({ locale, mode: "phase" }),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PHASE_ACCEPTANCE_REQUEST_CONSTRAINT),
    payloadText,
  ].filter(Boolean).join("\n");
}

export function buildAllPhaseAcceptanceReportsPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const reports = Array.isArray(data.phaseAcceptanceReports)
    ? data.phaseAcceptanceReports
    : Array.isArray(options?.phaseAcceptanceReports)
      ? options.phaseAcceptanceReports
      : [];
  const parts = buildAllPhaseAcceptanceReportSystemContents({ locale, marker, data: { phaseAcceptanceReports: reports } });
  return parts.join("\n\n").trim();
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
      translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PHASE_ACCEPTANCE_CHECKLIST_TITLE, {
        index: index + 1,
        total,
      }),
      `#${index + 1}${acceptedAt ? ` @ ${acceptedAt}` : ""}`,
      content || translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT),
    ].filter(Boolean).join("\n");
  });
}

export function buildAllSummaryReportSystemContents(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const reportText = String(data.latestSummaryOverview ?? options?.latestSummaryOverview ?? "").trim();
  if (!reportText) return [];
  const items = parseSummaryItemsFromText(reportText);
  if (!items.length) {
    return [
      [
        String(marker || "").trim(),
        translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.SUMMARY_CHECKLIST_TITLE, { index: 1, total: 1 }),
        "#1",
        reportText,
      ].filter(Boolean).join("\n"),
    ];
  }
  return items.map((item = {}, index) => {
    const content = `${Number(item?.id)}. ${String(item?.content || "").trim()}`.trim();
    const total = items.length;
    return [
      String(marker || "").trim(),
      translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.SUMMARY_CHECKLIST_TITLE, {
        index: index + 1,
        total,
      }),
      `#${index + 1}`,
      content,
    ].filter(Boolean).join("\n");
  });
}

export function buildAcceptanceValidationRequestPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const payload = data.requestPayload ?? data.payload ?? options?.requestPayload ?? options?.payload ?? null;
  const payloadText = JSON.stringify(payload || {}, null, 2);
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.FINAL_ACCEPTANCE_REQUEST_GOAL),
    buildAcceptancePatchProtocolText({ locale, mode: "final" }),
    payloadText,
  ].filter(Boolean).join("\n");
}
