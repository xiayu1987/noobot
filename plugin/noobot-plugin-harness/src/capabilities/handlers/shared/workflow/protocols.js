/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import {
  HARNESS_SCENARIO,
  resolveHarnessScenarioFromOptions,
} from "./matrix-resolver.js";

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
      textMode: input.textMode === true || input.isTextMode === true,
      scenario: input.scenario,
      scenarioKey: input.scenarioKey,
      scenarioProfile: input.scenarioProfile,
      data: input.data,
    };
  }
  return {
    locale: resolveLocale(input),
    programmingMode: false,
    textMode: false,
  };
}

export const SUMMARY_PROTOCOL_SCENARIO = HARNESS_SCENARIO;
const SUMMARY_PROTOCOL_COMMAND_KEYS_BY_SCENARIO = Object.freeze({
  [SUMMARY_PROTOCOL_SCENARIO.GENERAL]: Object.freeze({
    addKey: HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_GENERAL_ADD_COMMAND,
    updateKey: HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_GENERAL_UPDATE_COMMAND,
    overviewFields: Object.freeze(["plan", "status", "evidence", "file", "line"]),
  }),
  [SUMMARY_PROTOCOL_SCENARIO.TEXT]: Object.freeze({
    addKey: HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_TEXT_ADD_COMMAND,
    updateKey: HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_TEXT_UPDATE_COMMAND,
    overviewFields: Object.freeze(["plan", "status", "evidence", "file", "line", "path", "text"]),
  }),
  [SUMMARY_PROTOCOL_SCENARIO.PROGRAMMING]: Object.freeze({
    addKey: HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_PROGRAMMING_ADD_COMMAND,
    updateKey: HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_PROGRAMMING_UPDATE_COMMAND,
    overviewFields: Object.freeze(["plan", "status", "evidence", "file", "method", "line"]),
  }),
});

function resolveSummaryProtocolRuleKeys({ scenario } = {}) {
  if (scenario === SUMMARY_PROTOCOL_SCENARIO.PROGRAMMING) {
    return [HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_PROGRAMMING_RULES];
  }
  if (scenario === SUMMARY_PROTOCOL_SCENARIO.TEXT) {
    return [
      HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_TEXT_DELIVERY_RULES,
      HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_TEXT_RULES,
    ];
  }
  return [HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_ACTION_RULES];
}

export function resolveSummaryPatchProtocolSelection(options = LOCALE.ZH_CN) {
  const normalized = resolveSummaryPatchProtocolOptions(options);
  const scenario = resolveHarnessScenarioFromOptions(normalized);
  const command = SUMMARY_PROTOCOL_COMMAND_KEYS_BY_SCENARIO[scenario] ||
    SUMMARY_PROTOCOL_COMMAND_KEYS_BY_SCENARIO[SUMMARY_PROTOCOL_SCENARIO.GENERAL];
  const ruleKeys = resolveSummaryProtocolRuleKeys({ scenario });
  return Object.freeze({
    scenario,
    protocolFamily: "summary_text_v2 + summary_patch_v1",
    protocolId: `summary_patch_v1/${scenario}`,
    nextActionProtocolId: scenario === SUMMARY_PROTOCOL_SCENARIO.TEXT
      ? "next_action/text"
      : "next_action/default",
    addCommandKey: command.addKey,
    updateCommandKey: command.updateKey,
    deleteCommandKey: HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_DELETE_COMMAND,
    ruleKeys: Object.freeze([...ruleKeys]),
    overviewFields: Object.freeze([...(command.overviewFields || [])]),
  });
}

export function buildSummaryPatchProtocolText(options = LOCALE.ZH_CN) {
  const { locale: normalizedLocale } = resolveSummaryPatchProtocolOptions(options);
  const selection = resolveSummaryPatchProtocolSelection(options);
  return [
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_TITLE),
    translateI18nText(normalizedLocale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.PROTOCOL_SUMMARY_SYNTAX_HEADER),
    translateI18nText(normalizedLocale, selection.addCommandKey),
    translateI18nText(normalizedLocale, selection.updateCommandKey),
    translateI18nText(normalizedLocale, selection.deleteCommandKey),
    ...selection.ruleKeys.map((key) => translateI18nText(normalizedLocale, key)),
  ].filter(Boolean).join("\n");
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
