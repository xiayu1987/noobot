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
  HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS,
  LOCALE,
} from "../i18n.js";
import {
  HARNESS_SCENARIO,
  resolveHarnessScenarioFromContext,
} from "../capabilities/handlers/shared/workflow/matrix-resolver.js";
import {
  resolveActiveDynamicPolicyPromptFromContext,
} from "../capabilities/handlers/shared/workflow/dynamic-policy-prompt.js";

export const POLICY_PROMPT_SCENARIO = HARNESS_SCENARIO;

export const POLICY_PROMPT_KEY_BY_SCENARIO = Object.freeze({
  [HARNESS_SCENARIO.GENERAL]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_GENERAL,
  [HARNESS_SCENARIO.TEXT]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_TEXT,
  [HARNESS_SCENARIO.PROGRAMMING]: HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_PROGRAMMING,
});

export function resolvePolicyPromptSelection(ctx = {}, options = {}) {
  const scenario = resolveHarnessScenarioFromContext(ctx, options);
  const i18nKey = POLICY_PROMPT_KEY_BY_SCENARIO[scenario] ||
    HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_GENERAL;
  return Object.freeze({
    scenario,
    policyPromptId: `harness_policy/${scenario}`,
    i18nKey,
  });
}

export function buildPolicyPromptSelectionProfileText(selection = {}) {
  return [
    "[HARNESS_POLICY_SELECTION]",
    `scenario = ${selection.scenario || HARNESS_SCENARIO.GENERAL}`,
    `policy_prompt = ${selection.policyPromptId || "harness_policy/general"}`,
    `i18n_key = ${selection.i18nKey || HARNESS_I18N_KEYSET.SYSTEM_PROMPT.POLICY_GENERAL}`,
    `policy_source = ${selection.policySource || "default"}`,
    "[/HARNESS_POLICY_SELECTION]",
  ].join("\n");
}

function buildDynamicPolicyPromptSelection(dynamicPolicyPrompt = {}) {
  const scenario = String(dynamicPolicyPrompt?.scenario || HARNESS_SCENARIO.GENERAL).trim() || HARNESS_SCENARIO.GENERAL;
  return Object.freeze({
    scenario,
    policyPromptId: `harness_policy/dynamic/${scenario}`,
    i18nKey: "dynamic_policy_prompt",
    policySource: "dynamic",
  });
}

function resolvePolicyLocale(locale = "") {
  return String(locale || "").toLowerCase().startsWith("en") ? LOCALE.EN_US : LOCALE.ZH_CN;
}

function resolveDefaultScenarioPolicyText(locale = "", scenario = HARNESS_SCENARIO.GENERAL) {
  const resolvedLocale = resolvePolicyLocale(locale);
  const policyByScenario = HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS[resolvedLocale] ||
    HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS[LOCALE.ZH_CN] || {};
  return String(policyByScenario?.[scenario] || policyByScenario?.[HARNESS_SCENARIO.GENERAL] || "").trim();
}

export function buildDefaultPolicyPrompt(locale = "", ctx = {}, options = {}) {
  const dynamicPolicyPrompt = resolveActiveDynamicPolicyPromptFromContext(ctx);
  if (dynamicPolicyPrompt) {
    return [
      buildPolicyPromptSelectionProfileText(buildDynamicPolicyPromptSelection(dynamicPolicyPrompt)),
      dynamicPolicyPrompt.prompt,
    ].filter(Boolean).join("\n");
  }
  const selection = resolvePolicyPromptSelection(ctx, options);
  const basePolicyBody = translateI18nText(locale, selection.i18nKey);
  const scenarioPolicyBody = resolveDefaultScenarioPolicyText(locale, selection.scenario);
  return [
    buildPolicyPromptSelectionProfileText(selection),
    basePolicyBody,
    scenarioPolicyBody,
  ].filter(Boolean).join("\n\n");
}
