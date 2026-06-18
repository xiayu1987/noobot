/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  HARNESS_I18N_KEYSET,
  translateI18nText,
} from "../capabilities/handlers/shared/i18n.js";
import {
  HARNESS_SCENARIO,
  HARNESS_WORKFLOW_MODE,
  resolveHarnessScenarioFromContext,
  resolveHarnessWorkflowModeFromOptions,
} from "../capabilities/handlers/shared/workflow/matrix-resolver.js";

export const POLICY_PROMPT_SCENARIO = HARNESS_SCENARIO;
export const POLICY_PROMPT_WORKFLOW_MODE = HARNESS_WORKFLOW_MODE;

export const POLICY_PROMPT_KEY_BY_SCENARIO_MODE = Object.freeze({
  [HARNESS_SCENARIO.GENERAL]: Object.freeze({
    [HARNESS_WORKFLOW_MODE.BASE]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_GENERAL_BASE,
    [HARNESS_WORKFLOW_MODE.EXECUTION_FIRST]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_GENERAL_EXECUTION_FIRST,
    [HARNESS_WORKFLOW_MODE.RISK_FIRST]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_GENERAL_RISK_FIRST,
  }),
  [HARNESS_SCENARIO.TEXT]: Object.freeze({
    [HARNESS_WORKFLOW_MODE.BASE]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_TEXT_BASE,
    [HARNESS_WORKFLOW_MODE.EXECUTION_FIRST]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_TEXT_EXECUTION_FIRST,
    [HARNESS_WORKFLOW_MODE.RISK_FIRST]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_TEXT_RISK_FIRST,
  }),
  [HARNESS_SCENARIO.PROGRAMMING]: Object.freeze({
    [HARNESS_WORKFLOW_MODE.EXECUTION_FIRST]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_PROGRAMMING_EXECUTION_FIRST,
  }),
});

export function resolvePolicyPromptSelection(ctx = {}, options = {}) {
  const scenario = resolveHarnessScenarioFromContext(ctx, options);
  const workflowMode = resolveHarnessWorkflowModeFromOptions(options, { scenario });
  const scenarioMatrix = POLICY_PROMPT_KEY_BY_SCENARIO_MODE[scenario] ||
    POLICY_PROMPT_KEY_BY_SCENARIO_MODE[HARNESS_SCENARIO.GENERAL];
  const i18nKey = scenarioMatrix?.[workflowMode] ||
    scenarioMatrix?.[HARNESS_WORKFLOW_MODE.BASE] ||
    scenarioMatrix?.[HARNESS_WORKFLOW_MODE.EXECUTION_FIRST] ||
    HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_GENERAL_BASE;
  return Object.freeze({
    scenario,
    workflowMode,
    policyPromptId: `harness_policy/${scenario}/${workflowMode}`,
    i18nKey,
  });
}

export function buildPolicyPromptSelectionProfileText(selection = {}) {
  return [
    "[HARNESS_POLICY_SELECTION]",
    `scenario = ${selection.scenario || HARNESS_SCENARIO.GENERAL}`,
    `workflow_mode = ${selection.workflowMode || HARNESS_WORKFLOW_MODE.BASE}`,
    `policy_prompt = ${selection.policyPromptId || "harness_policy/general/base"}`,
    `i18n_key = ${selection.i18nKey || HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_GENERAL_BASE}`,
    "[/HARNESS_POLICY_SELECTION]",
  ].join("\n");
}

export function buildDefaultPolicyPrompt(locale = "", ctx = {}, options = {}) {
  const selection = resolvePolicyPromptSelection(ctx, options);
  const body = translateI18nText(locale, selection.i18nKey);
  return [buildPolicyPromptSelectionProfileText(selection), body].filter(Boolean).join("\n");
}
