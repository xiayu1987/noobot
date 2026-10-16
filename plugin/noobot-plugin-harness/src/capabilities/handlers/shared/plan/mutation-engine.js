/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applyPatchCommandsToPlanDocument,
  parsePatchCommands,
  parsePlanDocumentFromText,
  renderPlanDocument,
} from "./text-protocol.js";
import { normalizePlanMutationStage } from "./mutation-policy.js";
import { text } from "@noobot/shared/value";

function classifyPlanMutation(stage = "", mutationText = "") {
  if (stage === "planning_capture") {
    const parsedDocument = parsePlanDocumentFromText(mutationText);
    return {
      stage,
      type: parsedDocument.mainPlans.length > 0 ? "full_main_plan" : "invalid",
      parsedDocument,
    };
  }
  const expectsSubPlan = stage === "refinement";
  const hasStageCommand = parsePatchCommands(mutationText).some(
    (item = {}) => item.target.isSub === expectsSubPlan,
  );
  return { stage, type: hasStageCommand ? "patch" : "invalid" };
}

function appliedMutation({ stage, mode, classification, nextDocument }) {
  return {
    applied: true,
    stage,
    mode,
    classification: { stage, type: classification.type },
    nextDocument,
    nextPlanText: text(renderPlanDocument(nextDocument)),
  };
}

export function runPlanMutationEngine({
  stage = "revision",
  currentPlanText = "",
  mutationText = "",
  targetMainStepIndexes = [],
} = {}) {
  const normalizedStage = normalizePlanMutationStage(stage);
  const normalizedText = text(mutationText);
  const classification = classifyPlanMutation(normalizedStage, normalizedText);
  const rejected = (reason) => ({
    applied: false,
    stage: normalizedStage,
    classification: { stage: normalizedStage, type: classification.type },
    rejectedReason: reason,
  });

  if (!normalizedText) return rejected("empty_mutation_text");
  if (classification.type === "invalid") return rejected("invalid_mutation_type");

  if (normalizedStage === "planning_capture") {
    if (!text(renderPlanDocument(classification.parsedDocument))) {
      return rejected("empty_rendered_plan");
    }
    return appliedMutation({
      stage: normalizedStage,
      mode: "replace_full_main_plan",
      classification,
      nextDocument: classification.parsedDocument,
    });
  }

  const nextDocument = parsePlanDocumentFromText(currentPlanText);
  const patchResult = applyPatchCommandsToPlanDocument(nextDocument, normalizedText, {
    stage: normalizedStage,
    targetMainStepIndexes,
  });
  const isRefinement = normalizedStage === "refinement";
  if (!patchResult.changed) {
    return rejected(isRefinement ? "refinement_patch_not_applied" : "revision_not_applied");
  }
  return appliedMutation({
    stage: normalizedStage,
    mode: isRefinement ? "patch_refinement" : "patch_revision",
    classification,
    nextDocument,
  });
}
