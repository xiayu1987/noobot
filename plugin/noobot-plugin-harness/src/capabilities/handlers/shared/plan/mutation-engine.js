/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applyPatchCommandsToPlanDocument,
  parseMainPlansFromPlanText,
  parsePatchCommands,
  parsePlanDocumentFromText,
  renderPlanDocument,
} from "./text-protocol.js";
import {
  isSyntheticMainPlanPlaceholder,
  resolvePlanMutationPolicy,
} from "./mutation-policy.js";

function normalizeStage(stage = "") {
  const value = String(stage || "").trim().toLowerCase();
  if (value === "planning_capture" || value === "capture" || value === "planning") {
    return "planning_capture";
  }
  if (value === "refinement") return "refinement";
  return "revision";
}

function cloneSubPlansForMainId(subPlans = [], mainId = 0) {
  return (Array.isArray(subPlans) ? subPlans : [])
    .map((item = {}) => {
      const subIndex = Number(item?.subIndex);
      const content = String(item?.content || "").trim();
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

function parsePlanMutation(text = "") {
  const normalizedText = String(text || "").trim();
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
  const normalizedStage = normalizeStage(stage);
  const hasCommands = parsed?.hasCommands === true;
  const hasMainPlans = parsed?.hasMainPlans === true;
  const hasSubPatchCommands = parsed?.hasSubPatchCommands === true;
  const hasMainPatchCommands = parsed?.hasMainPatchCommands === true;

  if (normalizedStage === "planning_capture") {
    if (hasMainPlans) return { stage: normalizedStage, type: "full_main_plan" };
    return { stage: normalizedStage, type: "invalid" };
  }
  if (normalizedStage === "refinement") {
    if (hasMainPatchCommands || hasSubPatchCommands) {
      return { stage: normalizedStage, type: "patch" };
    }
    return { stage: normalizedStage, type: "invalid" };
  }

  // revision
  if (hasMainPatchCommands || hasSubPatchCommands) return { stage: normalizedStage, type: "patch" };
  if (hasMainPlans) return { stage: normalizedStage, type: "full_main_plan" };
  return { stage: normalizedStage, type: "invalid" };
}

function validatePlanInvariants({
  beforeDocument = {},
  afterDocument = {},
  policy = {},
} = {}) {
  if (!policy?.rejectSyntheticMainPlaceholderCollapse) return { ok: true };
  const beforeMainPlans = Array.isArray(beforeDocument?.mainPlans) ? beforeDocument.mainPlans : [];
  const afterMainPlans = Array.isArray(afterDocument?.mainPlans) ? afterDocument.mainPlans : [];
  if (beforeMainPlans.length > 1 && afterMainPlans.length === 1) {
    const content = String(afterMainPlans[0]?.content || "").trim();
    if (isSyntheticMainPlanPlaceholder(content)) {
      return { ok: false, reason: "synthetic_main_placeholder_collapse" };
    }
  }
  return { ok: true };
}

export function runPlanMutationEngine({
  stage = "revision",
  currentPlanText = "",
  mutationText = "",
  policy: policyInput = {},
} = {}) {
  const normalizedStage = normalizeStage(stage);
  const policy = resolvePlanMutationPolicy(normalizedStage, policyInput);
  const parsedMutation = parsePlanMutation(mutationText);
  const classification = classifyPlanMutation(normalizedStage, parsedMutation);
  const currentDocument = parsePlanDocumentFromText(currentPlanText);
  const nextDocument = parsePlanDocumentFromText(currentPlanText);

  const rejected = (reason = "invalid_mutation") => ({
    applied: false,
    stage: normalizedStage,
    classification,
    rejectedReason: reason,
    shouldRawAppendFallback:
      policy.allowRawAppendFallback &&
      parsedMutation.hasCommands !== true &&
      parsedMutation.hasMainPlans !== true,
    currentDocument,
    nextDocument: currentDocument,
    nextPlanText: String(currentPlanText || "").trim(),
  });

  if (!parsedMutation.text) return rejected("empty_mutation_text");
  if (classification.type === "invalid" || classification.type === "wrong_patch_type") {
    return rejected("invalid_mutation_type");
  }

  if (normalizedStage === "planning_capture") {
    const rendered = String(renderPlanDocument(parsedMutation.parsedDocument) || "").trim();
    if (!rendered) return rejected("empty_rendered_plan");
    return {
      applied: true,
      stage: normalizedStage,
      mode: "replace_full_main_plan",
      classification,
      currentDocument,
      nextDocument: parsedMutation.parsedDocument,
      nextPlanText: rendered,
    };
  }

  if (normalizedStage === "refinement") {
    const refinementPatchApplied = applyPatchCommandsToPlanDocument(nextDocument, parsedMutation.text, { stage: "refinement" });
    const revisionPatchApplied = applyPatchCommandsToPlanDocument(nextDocument, parsedMutation.text, { stage: "revision" });
    if (!refinementPatchApplied.changed && !revisionPatchApplied.changed) {
      return rejected("refinement_patch_not_applied");
    }
    const invariant = validatePlanInvariants({ beforeDocument: currentDocument, afterDocument: nextDocument, policy });
    if (!invariant.ok) return rejected(invariant.reason || "invariant_blocked");
    return {
      applied: true,
      stage: normalizedStage,
      mode: "patch_refinement",
      classification,
      currentDocument,
      nextDocument,
      nextPlanText: String(renderPlanDocument(nextDocument) || "").trim(),
      patchApplied: {
        changed: refinementPatchApplied.changed || revisionPatchApplied.changed,
      },
      refinementPatchApplied,
      revisionPatchApplied,
    };
  }

  // revision
  if (classification.type === "patch") {
    const revisionPatchApplied = applyPatchCommandsToPlanDocument(nextDocument, parsedMutation.text, { stage: "revision" });
    let refinementPatchApplied = { changed: false };
    if (policy.allowRevisionSubPatchCompatibility && parsedMutation.hasSubPatchCommands) {
      refinementPatchApplied = applyPatchCommandsToPlanDocument(nextDocument, parsedMutation.text, { stage: "refinement" });
    }
    if (revisionPatchApplied.changed || refinementPatchApplied.changed) {
      const invariant = validatePlanInvariants({ beforeDocument: currentDocument, afterDocument: nextDocument, policy });
      if (!invariant.ok) return rejected(invariant.reason || "invariant_blocked");
      return {
        applied: true,
        stage: normalizedStage,
        mode: "patch_revision",
        classification,
        currentDocument,
        nextDocument,
        nextPlanText: String(renderPlanDocument(nextDocument) || "").trim(),
        revisionPatchApplied,
        refinementPatchApplied,
      };
    }
  }

  const fullMainPlans = parseMainPlansFromPlanText(parsedMutation.text);
  if (fullMainPlans.length) {
    const replaced = parsePlanDocumentFromText(
      fullMainPlans.map((item = {}) => `${item.id}. ${item.content}`).join("\n"),
    );
    const previousSubPlansByMainId =
      currentDocument?.subPlansByMainId && typeof currentDocument.subPlansByMainId === "object"
        ? currentDocument.subPlansByMainId
        : {};
    for (const mainPlan of replaced.mainPlans) {
      const mainId = Number(mainPlan?.id);
      if (!Number.isFinite(mainId) || mainId <= 0) continue;
      const key = String(mainId);
      const copiedSubPlans = cloneSubPlansForMainId(previousSubPlansByMainId[key], mainId);
      if (copiedSubPlans.length) replaced.subPlansByMainId[key] = copiedSubPlans;
    }
    const invariant = validatePlanInvariants({ beforeDocument: currentDocument, afterDocument: replaced, policy });
    if (!invariant.ok) return rejected(invariant.reason || "invariant_blocked");
    return {
      applied: true,
      stage: normalizedStage,
      mode: "replace_full_main_plan",
      classification,
      currentDocument,
      nextDocument: replaced,
      nextPlanText: String(renderPlanDocument(replaced) || "").trim(),
    };
  }

  return rejected("revision_not_applied");
}
