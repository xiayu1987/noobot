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
import { isSyntheticMainPlanPlaceholder, normalizePlanMutationStage } from "./mutation-policy.js";
import { text } from "@noobot/shared/value";

function cloneSubPlansForMainId(subPlans = [], mainId = 0) {
  return (Array.isArray(subPlans) ? subPlans : [])
    .map((item = {}) => {
      const subIndex = Number(item?.subIndex);
      const content = text(item?.content);
      if (!Number.isFinite(subIndex) || subIndex <= 0 || !content) return null;
      return {
        id: `${mainId}.${subIndex}`,
        mainId: Number(mainId),
        subIndex,
        content,
      };
    })
    .filter(Boolean);
}

function parsePlanMutation(sourceText = "") {
  const normalizedText = text(sourceText);
  const commands = parsePatchCommands(normalizedText);
  const parsedDocument = parsePlanDocumentFromText(normalizedText);
  const mainPlans = Array.isArray(parsedDocument?.mainPlans) ? parsedDocument.mainPlans : [];
  const subPatchCommands = commands.filter((item = {}) => item?.target?.isSub === true);
  const mainPatchCommands = commands.filter((item = {}) => item?.target?.isSub !== true);
  return {
    text: normalizedText,
    commands,
    mainPatchCommands,
    subPatchCommands,
    parsedDocument,
    mainPlans,
    hasCommands: commands.length > 0,
    hasMainPlans: mainPlans.length > 0,
    hasSubPatchCommands: subPatchCommands.length > 0,
    hasMainPatchCommands: mainPatchCommands.length > 0,
  };
}

function classifyPlanMutation(stage = "", parsed = {}) {
  if (stage === "planning_capture") {
    return { stage, type: parsed.hasMainPlans ? "full_main_plan" : "invalid" };
  }
  if (stage === "refinement") {
    return { stage, type: parsed.hasSubPatchCommands ? "patch" : "invalid" };
  }
  if (parsed.hasMainPatchCommands) return { stage, type: "patch" };
  if (parsed.hasMainPlans) return { stage, type: "full_main_plan" };
  return { stage, type: "invalid" };
}

function validatePlanInvariants({ beforeDocument = {}, afterDocument = {} } = {}) {
  const beforeMainPlans = Array.isArray(beforeDocument?.mainPlans) ? beforeDocument.mainPlans : [];
  const afterMainPlans = Array.isArray(afterDocument?.mainPlans) ? afterDocument.mainPlans : [];
  if (beforeMainPlans.length > 1 && afterMainPlans.length === 1) {
    const content = text(afterMainPlans[0]?.content);
    if (isSyntheticMainPlanPlaceholder(content)) {
      return { ok: false, reason: "synthetic_main_placeholder_collapse" };
    }
  }
  return { ok: true };
}

function appliedMutation({ stage, mode, classification, nextDocument }) {
  return {
    applied: true,
    stage,
    mode,
    classification,
    nextDocument,
    nextPlanText: text(renderPlanDocument(nextDocument)),
  };
}

function replaceMainPlansKeepingSubPlans(currentDocument = {}, mainPlans = []) {
  const replaced = parsePlanDocumentFromText(
    mainPlans.map((item = {}) => `${item.id}. ${item.content}`).join("\n"),
  );
  for (const mainPlan of replaced.mainPlans) {
    const key = String(mainPlan.id);
    const copiedSubPlans = cloneSubPlansForMainId(
      currentDocument.subPlansByMainId[key],
      mainPlan.id,
    );
    if (copiedSubPlans.length) replaced.subPlansByMainId[key] = copiedSubPlans;
  }
  return replaced;
}

export function runPlanMutationEngine({
  stage = "revision",
  currentPlanText = "",
  mutationText = "",
} = {}) {
  const normalizedStage = normalizePlanMutationStage(stage);
  const parsedMutation = parsePlanMutation(mutationText);
  const classification = classifyPlanMutation(normalizedStage, parsedMutation);
  const rejected = (reason) => ({
    applied: false,
    stage: normalizedStage,
    classification,
    rejectedReason: reason,
  });

  if (!parsedMutation.text) return rejected("empty_mutation_text");
  if (classification.type === "invalid") return rejected("invalid_mutation_type");

  if (normalizedStage === "planning_capture") {
    if (!text(renderPlanDocument(parsedMutation.parsedDocument))) {
      return rejected("empty_rendered_plan");
    }
    return appliedMutation({
      stage: normalizedStage,
      mode: "replace_full_main_plan",
      classification,
      nextDocument: parsedMutation.parsedDocument,
    });
  }

  const currentDocument = parsePlanDocumentFromText(currentPlanText);
  let nextDocument = null;
  let mode = "replace_full_main_plan";
  if (classification.type === "patch") {
    nextDocument = parsePlanDocumentFromText(currentPlanText);
    const patchResult = applyPatchCommandsToPlanDocument(nextDocument, parsedMutation.text, {
      stage: normalizedStage,
    });
    if (!patchResult.changed) {
      return rejected(
        normalizedStage === "refinement" ? "refinement_patch_not_applied" : "revision_not_applied",
      );
    }
    mode = normalizedStage === "refinement" ? "patch_refinement" : "patch_revision";
  } else {
    nextDocument = replaceMainPlansKeepingSubPlans(currentDocument, parsedMutation.mainPlans);
  }
  const invariant = validatePlanInvariants({
    beforeDocument: currentDocument,
    afterDocument: nextDocument,
  });
  if (!invariant.ok) return rejected(invariant.reason);
  return appliedMutation({ stage: normalizedStage, mode, classification, nextDocument });
}
