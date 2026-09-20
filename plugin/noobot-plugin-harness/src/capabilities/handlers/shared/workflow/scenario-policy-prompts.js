/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { DYNAMIC_POLICY_PROMPT_BLOCK } from "./dynamic-policy-prompt.js";

const SCENARIO_POLICY_I18N_KEY_BY_SCENARIO = Object.freeze({
  general: HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.SCENARIO_POLICY_GENERAL,
  text: HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.SCENARIO_POLICY_TEXT,
  programming: HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.SCENARIO_POLICY_PROGRAMMING,
});

function resolveScenarioPolicyScenario({ programmingMode = false, textMode = false } = {}) {
  if (programmingMode === true) return "programming";
  if (textMode === true) return "text";
  return "general";
}

export function buildDefaultScenarioPolicyText(locale = LOCALE.ZH_CN, options = {}) {
  const scenario = resolveScenarioPolicyScenario(options);
  const key =
    SCENARIO_POLICY_I18N_KEY_BY_SCENARIO[scenario] || SCENARIO_POLICY_I18N_KEY_BY_SCENARIO.general;
  return translateI18nText(locale, key);
}

export function buildScenarioPolicyPromptText(
  locale = LOCALE.ZH_CN,
  { programmingMode = false, textMode = false, dynamicPolicyPrompt = "" } = {},
) {
  const scenario = resolveScenarioPolicyScenario({ programmingMode, textMode });
  const dynamicPrompt = String(dynamicPolicyPrompt || "").trim();
  const body =
    dynamicPrompt || buildDefaultScenarioPolicyText(locale, { programmingMode, textMode });
  if (!body) return "";
  return [
    "[HARNESS_SCENARIO_POLICY]",
    `scenario = ${scenario}`,
    `source = ${dynamicPrompt ? "dynamic" : "default"}`,
    "[/HARNESS_SCENARIO_POLICY]",
    body,
  ]
    .filter(Boolean)
    .join("\n");
}

function shouldIncludeScenarioMismatchProtocol(stage = "") {
  const normalized = String(stage || "")
    .trim()
    .toLowerCase();
  return normalized === "planning" || normalized.includes("revision");
}

function buildScenarioMismatchResponsibilityText(locale = LOCALE.ZH_CN) {
  return translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_SCENARIO_MISMATCH_PROTOCOL,
    { block: DYNAMIC_POLICY_PROMPT_BLOCK },
  );
}

export function buildWorkflowResponsibilityConstraintUserPrompt(
  locale = LOCALE.ZH_CN,
  stage = "planning",
  options = {},
) {
  const normalizedStage = String(stage || "planning")
    .trim()
    .toLowerCase();
  let stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_PLANNING;
  if (normalizedStage.includes("revision"))
    stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_REVISION;
  else if (normalizedStage.includes("refinement"))
    stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_REFINEMENT;
  else if (normalizedStage.includes("summary"))
    stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_SUMMARY;
  else if (normalizedStage.includes("analysis"))
    stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_ANALYSIS;
  else if (normalizedStage.includes("phase_acceptance"))
    stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_PHASE_ACCEPTANCE;
  else if (
    normalizedStage.includes("acceptance_semantic_validation") ||
    normalizedStage.includes("final_acceptance")
  )
    stageKey = HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_STAGE_FINAL_ACCEPTANCE;
  const stageLabel = translateI18nText(locale, stageKey);
  const baseParts = [
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.RESPONSIBILITY_CONSTRAINT_TEMPLATE,
      { stage: stageLabel },
    ),
    shouldIncludeScenarioMismatchProtocol(normalizedStage)
      ? buildScenarioMismatchResponsibilityText(locale)
      : "",
  ].filter(Boolean);
  const base = baseParts.join("\n");
  const programmingMode = options?.programmingMode === true || options?.isProgrammingMode === true;
  const textMode = !programmingMode && (options?.textMode === true || options?.isTextMode === true);
  if (options?.includeWorkflowPolicy !== true) return base;
  const policy = buildScenarioPolicyPromptText(locale, {
    programmingMode,
    textMode,
    dynamicPolicyPrompt: options?.dynamicPolicyPrompt,
  });
  if (!policy) return base;
  return [base, "", policy].filter(Boolean).join("\n");
}
