/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { requireHarnessRevisionCount } from "../../../../core/bucket-contract.js";
import {
  buildPlanningMainPatchProtocolText as buildPlanningMainPatchProtocolCoreText,
  buildPlanningRefinementPatchProtocolText as buildPlanningRefinementPatchProtocolCoreText,
  buildPlanningRevisionPatchProtocolText as buildPlanningRevisionPatchProtocolCoreText,
} from "./protocols.js";
import { buildDynamicPolicyPromptProtocolInstruction } from "./dynamic-policy-prompt.js";
import { normalizePromptOptions } from "./prompt-options.js";
import { HARNESS_SCENARIO } from "./matrix-resolver.js";
import { buildScenarioPolicyPromptText } from "./scenario-policy-prompts.js";
import { text } from "@noobot/shared/value";

export function buildPostPlanUserFollowupPrompt(locale = LOCALE.ZH_CN, stage = "planning") {
  const normalizedStage = (text(stage) || "planning").toLowerCase();
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
  const { locale, marker, data, scenario, dynamicPolicyPrompt } = normalizePromptOptions(options);
  const includeWorkflowPolicy = options?.includeWorkflowPolicy === true;
  const goal =
    text(data.userGoal) ||
    translateI18nText(
      locale,
      HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_LATEST_USER_GOAL_FALLBACK,
    );
  const currentTaskGoalProtocol = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_CURRENT_TASK_GOAL_PROTOCOL,
  );
  const goalPromptKey =
    scenario === HARNESS_SCENARIO.PROGRAMMING
      ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_PROMPT_GOAL_PROGRAMMING_FAST
      : scenario === HARNESS_SCENARIO.TEXT
        ? HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_PROMPT_GOAL_TEXT
        : HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_MAIN_PROMPT_GOAL_ACTION;
  return [
    text(marker),
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
      ? buildScenarioPolicyPromptText(locale, { scenario, dynamicPolicyPrompt })
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
  const revisionCount = requireHarnessRevisionCount(data.globalRevisionCount);
  const currentMainPlansText = data.currentMainPlansText ?? "";
  const includeCurrentMainPlans = data.includeCurrentMainPlans ?? true;
  const mainPlansText =
    text(currentMainPlansText) ||
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT);
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
    text(marker),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_PROMPT_GOAL),
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_STATUS_HEADER),
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_REVISION_COUNT_LINE, {
      revisionCount,
      maxAttempts: TURN_THRESHOLDS.harness.planning.planUpdateRevisionMaxAttempts,
    }),
    ...currentPlanSection,
    buildPlanningRevisionPatchProtocolCoreText(locale),
    "",
    buildDynamicPolicyPromptProtocolInstruction(locale),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPlanningRefinementPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const targetIdsRaw = Array.isArray(data.targetIds) ? data.targetIds : [];
  const targetIds = targetIdsRaw
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
  const targetPlansText = data.targetPlansText ?? "";
  const existingSubPlansText = data.existingSubPlansText ?? "";
  const firstTargetId = targetIds[0] ?? 1;
  const targetIdListText = targetIds.length ? `[${targetIds.join(",")}]` : `[${firstTargetId}]`;
  const targetPlans = text(targetPlansText) || `${firstTargetId}.`;
  const subPlans =
    text(existingSubPlansText) ||
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_EMPTY_TEXT);
  return [
    text(marker),
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
  ]
    .filter(Boolean)
    .join("\n");
}
