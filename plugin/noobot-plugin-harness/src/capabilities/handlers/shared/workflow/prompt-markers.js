/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";

export function getPlanningPromptMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-bootstrap -->";
}

export function getPlanningToolContextMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-tools -->";
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

export function getGuidanceAnalysisMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-guidance-analysis -->";
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

export function getPlanningPromptToolsHeader(locale = LOCALE.ZH_CN) {
  return translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_PROMPT_TOOLS_HEADER,
  );
}

export function getPlanningContextSummaryHeader(locale = LOCALE.ZH_CN) {
  return translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_CONTEXT_SUMMARY_HEADER,
  );
}

export function getPlanningSeparateModelEmptyRelay(locale = LOCALE.ZH_CN) {
  return translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_SEPARATE_MODEL_EMPTY_RELAY,
  );
}
