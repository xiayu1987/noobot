/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";

function resolveLocale(locale = LOCALE.ZH_CN) {
  return locale === LOCALE.EN_US ? LOCALE.EN_US : LOCALE.ZH_CN;
}

function normalizePatchActions(actions = []) {
  const allowed = ["ADD", "UPDATE", "DELETE"];
  const picked = [...new Set(
    (Array.isArray(actions) ? actions : [])
      .map((item) => String(item || "").trim().toUpperCase())
      .filter((item) => allowed.includes(item)),
  )];
  return picked.length ? picked : allowed;
}

function resolvePlanningMainPatchOptions(input = LOCALE.ZH_CN) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      locale: resolveLocale(input.locale),
      actions: normalizePatchActions(input.actions),
    };
  }
  return {
    locale: resolveLocale(input),
    actions: normalizePatchActions([]),
  };
}

export function buildPlanningMainPatchProtocolText(options = LOCALE.ZH_CN) {
  const { locale: normalizedLocale, actions } = resolvePlanningMainPatchOptions(options);
  const actionLines = [];
  if (actions.includes("ADD")) actionLines.push(translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_MAIN_ACTION_ADD));
  if (actions.includes("UPDATE")) actionLines.push(translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_MAIN_ACTION_UPDATE));
  if (actions.includes("DELETE")) actionLines.push(translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_MAIN_ACTION_DELETE));
  const canonical = actions
    .map((item) => translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_MAIN_CANONICAL_ITEM_TEMPLATE, { action: item }))
    .join(" / ");
  return [
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_MAIN_TITLE),
    ...actionLines,
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_MAIN_HARD_CONSTRAINT),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_MAIN_CANONICAL_TEMPLATE, { canonical }),
  ].join("\n");
}

export function buildPlanningRevisionPatchProtocolText(locale = LOCALE.ZH_CN) {
  return buildPlanningMainPatchProtocolText({
    locale,
    actions: ["ADD", "UPDATE", "DELETE"],
  });
}

export function buildPlanningRefinementPatchProtocolText(locale = LOCALE.ZH_CN) {
  const normalizedLocale = resolveLocale(locale);
  return [
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_REFINEMENT_TITLE),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_REFINEMENT_ACTION_ADD),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_REFINEMENT_ACTION_UPDATE),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_REFINEMENT_ACTION_DELETE),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_REFINEMENT_HARD_CONSTRAINT),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_REFINEMENT_ONE_LEVEL_CONSTRAINT),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_PLANNING_REFINEMENT_CANONICAL),
  ].join("\n");
}

function resolveSummaryPatchProtocolOptions(input = LOCALE.ZH_CN) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      locale: resolveLocale(input.locale),
      programmingMode: input.programmingMode === true || input.isProgrammingMode === true,
      executionFirstMode: input.executionFirstMode === true || input.isExecutionFirstMode === true,
      riskFirstMode: input.riskFirstMode === true || input.isRiskFirstMode === true,
    };
  }
  return {
    locale: resolveLocale(input),
    programmingMode: false,
    executionFirstMode: false,
    riskFirstMode: false,
  };
}

export function buildSummaryPatchProtocolText(options = LOCALE.ZH_CN) {
  const {
    locale: normalizedLocale,
    programmingMode,
    executionFirstMode,
    riskFirstMode,
  } = resolveSummaryPatchProtocolOptions(options);
  const summaryLine3 = programmingMode
    ? HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_PROGRAMMING_LINE3
    : HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_LINE3;
  const summaryLine4 = programmingMode
    ? HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_PROGRAMMING_LINE4
    : HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_LINE4;
  const summaryLine6 = programmingMode
    ? HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_PROGRAMMING_LINE6
    : executionFirstMode
      ? HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_EXECUTION_FIRST_LINE6
      : riskFirstMode
        ? HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_RISK_FIRST_LINE6
      : HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_LINE6;
  return [
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_LINE1),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_LINE2),
    translateI18nText(normalizedLocale, summaryLine3),
    translateI18nText(normalizedLocale, summaryLine4),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_LINE5),
    translateI18nText(normalizedLocale, summaryLine6),
  ].join("\n");
}

export function buildAcceptancePatchProtocolText({
  locale = LOCALE.ZH_CN,
  mode = "final",
} = {}) {
  const normalizedLocale = resolveLocale(locale);
  const normalizedMode = String(mode || "final").trim().toLowerCase() === "phase" ? "phase" : "final";
  const title =
    normalizedMode === "phase"
      ? translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_TITLE_PHASE)
      : translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_TITLE_FINAL);
  return [
    title,
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_OUTPUT_RULE),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_COMMANDS_HEADER),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_COMMAND_ADD),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_COMMAND_UPDATE),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_COMMAND_DELETE),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_ID_RULES_HEADER),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_ID_RULE1),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_ID_RULE2),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_STATUS_HEADER),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_STATUS_RULE),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_ACCEPTANCE_EVIDENCE_RULE),
  ].join("\n");
}
