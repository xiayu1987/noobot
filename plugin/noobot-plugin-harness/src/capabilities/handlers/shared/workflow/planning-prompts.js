/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import {
  buildPlanningMainPatchProtocolText as buildPlanningMainPatchProtocolCoreText,
  buildPlanningRefinementPatchProtocolText as buildPlanningRefinementPatchProtocolCoreText,
  buildPlanningRevisionPatchProtocolText as buildPlanningRevisionPatchProtocolCoreText,
} from "./protocols.js";
import { buildDynamicPolicyPromptProtocolInstruction } from "./dynamic-policy-prompt.js";
import { normalizePromptOptions } from "./prompt-options.js";
import { buildScenarioPolicyPromptText } from "./scenario-policy-prompts.js";

const PLAN_UPDATE_POLICY = Object.freeze({
  MAX_ATTEMPTS_REVISION: WORKFLOW_PARAMS.planning.planUpdate.revisionMaxAttempts,
});

export function buildPostPlanUserFollowupPrompt(locale = LOCALE.ZH_CN, stage = "planning") {
  const normalizedStage = String(stage || "planning")
    .trim()
    .toLowerCase();
  const stageKey = normalizedStage.includes("refinement")
    ? "refinement"
    : normalizedStage.includes("revision")
      ? "revision"
      : "planning";
  const keysByStage = {
    refinement: HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.POST_PLAN_FOLLOWUP_REFINEMENT,
    revision: HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.POST_PLAN_FOLLOWUP_REVISION,
    planning: HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.POST_PLAN_FOLLOWUP_PLANNING,
  };
  return translateI18nText(locale, keysByStage[stageKey]);
}

export function buildPlanningMainPrompt(options = {}) {
  const { locale, marker, data, programmingMode, textMode, dynamicPolicyPrompt } =
    normalizePromptOptions(options);
  const includeWorkflowPolicy = options?.includeWorkflowPolicy === true;
  const userGoal = String(data.userGoal || options?.userGoal || "").trim();
  const goal =
    String(userGoal || "").trim() ||
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_LATEST_USER_GOAL_FALLBACK,
    );
  const currentTaskGoalProtocol = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_CURRENT_TASK_GOAL_PROTOCOL,
  );
  const goalPromptKey = programmingMode
    ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_PROMPT_GOAL_PROGRAMMING_FAST
    : textMode
      ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_PROMPT_GOAL_TEXT
      : HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_PROMPT_GOAL_ACTION;
  return [
    String(marker || "").trim(),
    translateI18nText(locale, goalPromptKey),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_USER_GOAL_HEADER),
    goal,
    "",
    buildPlanningMainPatchProtocolCoreText({ locale, actions: ["ADD"] }),
    "",
    currentTaskGoalProtocol,
    "",
    includeWorkflowPolicy
      ? buildScenarioPolicyPromptText(locale, { programmingMode, textMode, dynamicPolicyPrompt })
      : "",
    "",
    buildDynamicPolicyPromptProtocolInstruction(locale),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_CONSTRAINT),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_EXAMPLE_HEADER),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_EXAMPLE_ADD),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPlanningRevisionPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const globalRevisionCount = data.globalRevisionCount ?? options?.globalRevisionCount ?? 0;
  const currentMainPlansText = data.currentMainPlansText ?? options?.currentMainPlansText ?? "";
  const includeCurrentMainPlans =
    data.includeCurrentMainPlans ?? options?.includeCurrentMainPlans ?? true;
  const mainPlansText =
    String(currentMainPlansText || "").trim() ||
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT);
  const revisionCount = Number.isFinite(Number(globalRevisionCount))
    ? Number(globalRevisionCount)
    : 0;
  const currentPlanSection =
    includeCurrentMainPlans === false
      ? []
      : [
          translateI18nText(
            locale,
            HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_CURRENT_PLAN_LABEL,
          ),
          mainPlansText,
        ];
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
    buildDynamicPolicyPromptProtocolInstruction(locale),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_CONSTRAINT),
    "",
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_EXAMPLE_HEADER,
    ),
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_EXAMPLE_UPDATE,
    ),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_EXAMPLE_ADD),
  ]
    .filter(Boolean)
    .join("\n");
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
  const subPlans =
    String(existingSubPlansText || "").trim() ||
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT);
  return [
    String(marker || "").trim(),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_PROMPT_GOAL),
    "",
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_TARGETS_HEADER,
    ),
    targetPlans ||
      translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT),
    "",
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_TARGET_IDS_HEADER,
    ),
    targetIdListText,
    "",
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_TARGET_ONLY_CONSTRAINT,
    ),
    "",
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_EXISTING_SUBSTEPS_LABEL,
    ),
    subPlans,
    "",
    buildPlanningRefinementPatchProtocolCoreText(locale),
    "",
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_EXAMPLE_HEADER,
    ),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_EXAMPLE_ADD),
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REFINEMENT_EXAMPLE_UPDATE,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}
