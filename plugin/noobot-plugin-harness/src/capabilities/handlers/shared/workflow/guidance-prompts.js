/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { buildSummaryPatchProtocolText as buildSummaryPatchProtocolCoreText } from "./protocols.js";
import {
  buildGuidanceSummarySelectionProfileText,
  resolveGuidanceSummaryInstructionSelection,
} from "./summary-matrix.js";
import { normalizePromptOptions } from "./prompt-options.js";
import { HARNESS_SCENARIO } from "./matrix-resolver.js";
import { buildScenarioPolicyPromptText } from "./scenario-policy-prompts.js";
import { text } from "@noobot/shared/value";

export function buildGuidanceAnalysisPromptText({ locale = LOCALE.ZH_CN, marker = "" } = {}) {
  return [
    text(marker),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_ANALYSIS_PROMPT_GOAL),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGuidanceFailurePromptText({
  locale = LOCALE.ZH_CN,
  marker = "",
  reason = "",
  scenario,
  dynamicPolicyPrompt = "",
  includeWorkflowPolicy = false,
} = {}) {
  const message = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_FAILURE_PROMPT_TEMPLATE,
    {
      reason: text(reason),
    },
  );
  return [
    text(marker),
    message,
    includeWorkflowPolicy === false
      ? ""
      : buildScenarioPolicyPromptText(locale, {
          scenario,
          dynamicPolicyPrompt,
        }),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGuidanceSummaryInstructionPromptText(options = {}) {
  const { locale, marker, scenario, dynamicPolicyPrompt } = normalizePromptOptions(options);
  const includeWorkflowPolicy = options?.includeWorkflowPolicy === true;
  const selection = resolveGuidanceSummaryInstructionSelection({ scenario });
  const isProgramming = scenario === HARNESS_SCENARIO.PROGRAMMING;
  const isText = scenario === HARNESS_SCENARIO.TEXT;
  const isGeneral = scenario === HARNESS_SCENARIO.GENERAL;
  const overviewSample = isProgramming
    ? "1. [plan=2][status=done][evidence=...][file=src/example.js][method=handleRequest][line=10-20,35,48-52] ..."
    : isText
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_OVERVIEW_SAMPLE,
        )
      : "1. [plan=2][status=done][evidence=...][file=-][line=-] ...";
  const nextSuggestionSample = translateI18nText(
    locale,
    isProgramming
      ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROGRAMMING_NEXT_ACTION_SAMPLE
      : isText
        ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_NEXT_ACTION_SAMPLE
        : HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_ACTION_NEXT_ACTION_SAMPLE,
  );
  const riskSampleKey = isProgramming
    ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_SAMPLE_RISK_HIGH_PROGRAMMING
    : HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_SAMPLE_RISK_HIGH;
  const riskSample = isText
    ? translateI18nText(
        locale,
        HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_RISK_SAMPLE,
      )
    : translateI18nText(locale, riskSampleKey);
  return [
    text(marker),
    "[HARNESS_SUMMARY_INSTRUCTION]",
    `instruction_prompt = ${selection.promptId}`,
    `instruction_parts = ${[...selection.parts].join(",")}`,
    "[/HARNESS_SUMMARY_INSTRUCTION]",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROMPT_GOAL),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROTOCOL_HINT),
    "[SUMMARY_OVERVIEW]",
    overviewSample,
    riskSample,
    "[SUMMARY_DETAIL]",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_DETAIL_HEADER),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_DETAIL_SAMPLE),
    "[NEXT_EXECUTION_SUGGESTION]",
    nextSuggestionSample,
    "[SUMMARY_END]",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_RULES),
    isProgramming
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROGRAMMING_RULES,
        )
      : "",
    isText
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_SCENARIO_RULES,
        )
      : "",
    isProgramming
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROGRAMMING_NEXT_ACTION_RULES,
        )
      : "",
    isText
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_NEXT_ACTION_RULES,
        )
      : "",
    isGeneral
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_ACTION_NEXT_ACTION_RULES,
        )
      : "",
    includeWorkflowPolicy
      ? buildScenarioPolicyPromptText(locale, { scenario, dynamicPolicyPrompt })
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGuidanceSummaryProtocolPromptText(options = {}) {
  const { locale, scenario } = normalizePromptOptions(options);
  return [
    buildGuidanceSummarySelectionProfileText(options),
    buildSummaryPatchProtocolCoreText({ locale, scenario }),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGuidanceSummaryPromptText(options = {}) {
  const { locale, scenario } = normalizePromptOptions(options);
  return [
    buildGuidanceSummarySelectionProfileText(options),
    buildGuidanceSummaryInstructionPromptText(options),
    buildSummaryPatchProtocolCoreText({ locale, scenario }),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPreviousSummaryContextContent({
  locale = LOCALE.ZH_CN,
  previousSummaryContent = "",
} = {}) {
  const normalizedText = text(previousSummaryContent);
  if (!normalizedText) return "";
  const header = `<!-- harness-previous-summary-context -->\n${translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PREVIOUS_SUMMARY_CONTEXT_HEADER,
  )}`;
  return `${header}\n${normalizedText}`;
}

export function buildPreviousSummaryContextMessages(options = {}) {
  const content = buildPreviousSummaryContextContent(options);
  if (!content) return [];
  return [{ role: "system", content }];
}
