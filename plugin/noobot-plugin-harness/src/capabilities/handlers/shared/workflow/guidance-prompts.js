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
import { buildScenarioPolicyPromptText } from "./scenario-policy-prompts.js";

export function buildGuidanceAnalysisPromptText({ locale = LOCALE.ZH_CN, marker = "" } = {}) {
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_ANALYSIS_PROMPT_GOAL),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGuidanceFailurePromptText({
  locale = LOCALE.ZH_CN,
  marker = "",
  reason = "",
  programmingMode = false,
  textMode = false,
  dynamicPolicyPrompt = "",
  includeWorkflowPolicy = false,
} = {}) {
  const message = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_FAILURE_PROMPT_TEMPLATE,
    {
      reason: String(reason || "").trim(),
    },
  );
  return [
    String(marker || "").trim(),
    message,
    includeWorkflowPolicy === false
      ? ""
      : buildScenarioPolicyPromptText(locale, {
          programmingMode,
          textMode,
          dynamicPolicyPrompt,
        }),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGuidanceSummaryInstructionPromptText(options = {}) {
  const { locale, marker, programmingMode, textMode, dynamicPolicyPrompt } =
    normalizePromptOptions(options);
  const includeWorkflowPolicy = options?.includeWorkflowPolicy === true;
  const selection = resolveGuidanceSummaryInstructionSelection({ programmingMode, textMode });
  const overviewSample = programmingMode
    ? "1. [plan=2][status=done][evidence=...][file=src/example.js][method=handleRequest][line=10-20,35,48-52] ..."
    : textMode
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_OVERVIEW_SAMPLE,
        )
      : "1. [plan=2][status=done][evidence=...][file=-][line=-] ...";
  const nextSuggestionSample = translateI18nText(
    locale,
    programmingMode
      ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROGRAMMING_NEXT_ACTION_SAMPLE
      : textMode
        ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_NEXT_ACTION_SAMPLE
        : HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_ACTION_NEXT_ACTION_SAMPLE,
  );
  const riskSampleKey = programmingMode
    ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_SAMPLE_RISK_HIGH_PROGRAMMING
    : HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_SAMPLE_RISK_HIGH;
  const riskSample =
    textMode && !programmingMode
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_RISK_SAMPLE,
        )
      : translateI18nText(locale, riskSampleKey);
  return [
    String(marker || "").trim(),
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
    programmingMode
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROGRAMMING_RULES,
        )
      : "",
    textMode
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_SCENARIO_RULES,
        )
      : "",
    programmingMode
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_PROGRAMMING_NEXT_ACTION_RULES,
        )
      : "",
    !programmingMode && textMode
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_TEXT_NEXT_ACTION_RULES,
        )
      : "",
    !programmingMode && !textMode
      ? translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.GUIDANCE_SUMMARY_ACTION_NEXT_ACTION_RULES,
        )
      : "",
    includeWorkflowPolicy
      ? buildScenarioPolicyPromptText(locale, { programmingMode, textMode, dynamicPolicyPrompt })
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGuidanceSummaryProtocolPromptText(options = {}) {
  const { locale, programmingMode, textMode } = normalizePromptOptions(options);
  return [
    buildGuidanceSummarySelectionProfileText(options),
    buildSummaryPatchProtocolCoreText({ locale, programmingMode, textMode }),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGuidanceSummaryPromptText(options = {}) {
  const { locale, programmingMode, textMode } = normalizePromptOptions(options);
  return [
    buildGuidanceSummarySelectionProfileText(options),
    buildGuidanceSummaryInstructionPromptText(options),
    buildSummaryPatchProtocolCoreText({ locale, programmingMode, textMode }),
  ]
    .filter(Boolean)
    .join("\n");
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
