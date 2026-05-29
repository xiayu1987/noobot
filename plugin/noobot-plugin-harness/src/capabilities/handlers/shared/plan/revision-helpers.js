/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applyPatchCommandsToPlanDocument,
  parseMainPlansFromPlanText,
  parsePlanDocumentFromText,
  parseSubPlansFromPlanText,
  renderPlanDocument,
} from "./text-protocol.js";
import {
  buildPlanningRefinementPromptText,
  getPlanningRefinementMarker,
} from "../workflow/prompts.js";

function formatMainPlansText(mainPlans = []) {
  if (!Array.isArray(mainPlans) || !mainPlans.length) return "（空）";
  return mainPlans
    .map((item = {}) => `${Number(item.id)}. ${String(item.content || "").trim()}`)
    .join("\n");
}

function formatSubPlansText(subPlans = [], targetId = 0) {
  if (!Array.isArray(subPlans) || !subPlans.length) return "（空）";
  return subPlans
    .filter((item = {}) => Number(item.mainId) === Number(targetId))
    .map((item = {}) => `${item.id} ${String(item.content || "").trim()}`)
    .join("\n") || "（空）";
}

function normalizeMainPlanText(text = "") {
  const plans = parseMainPlansFromPlanText(text);
  return plans.map((item = {}) => `${item.id}. ${item.content}`).join("\n").trim();
}

export function createPlanRevisionHelpers({
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
} = {}) {
  function ensurePlanTextBucket(bucket = {}) {
    if (!bucket || typeof bucket !== "object") return {};
    if (typeof bucket.planText !== "string") bucket.planText = "";
    if (!Number.isFinite(Number(bucket.globalRevisionCount))) bucket.globalRevisionCount = 0;
    if (typeof bucket.lastMainPlanRevisionChanged !== "boolean") {
      bucket.lastMainPlanRevisionChanged = false;
    }
    if (!bucket.planDocument || typeof bucket.planDocument !== "object") {
      bucket.planDocument = parsePlanDocumentFromText(bucket.planText);
    }
    return bucket;
  }

  function resolveRefinementTargetMainSteps(bucket = {}, _state = {}) {
    const normalizedBucket = ensurePlanTextBucket(bucket);
    const mainPlans = parseMainPlansFromPlanText(normalizedBucket.planText);
    if (!mainPlans.length) return [];
    const target = mainPlans[0] || null;
    if (!target) return [];
    return [{ index: Number(target.id), task: String(target.content || "").trim() }];
  }

  function appendRawPatchText(bucket = {}, patchText = "", source = "") {
    const text = String(patchText || "").trim();
    if (!text) return false;
    const header = source ? `# ${source}` : "# plan_patch";
    const existing = String(bucket.planText || "").trim();
    bucket.planText = [existing, header, text].filter(Boolean).join("\n");
    bucket.planDocument = parsePlanDocumentFromText(bucket.planText);
    return true;
  }

  function applyRevisedPlanFromText(
    ctx = {},
    text = "",
    { summary = "", source = "planning_revision", stage = "revision", targetMainStepIndexes = [] } = {},
  ) {
    const holder = ensureHarnessBucket?.(ctx);
    if (!holder) return false;
    const { bucket, state } = holder;
    ensurePlanTextBucket(bucket);
    const payloadText = String(text || "").trim();
    if (!payloadText) return false;

    const normalizedStage =
      String(stage || source || "revision").toLowerCase().includes("refinement")
        ? "refinement"
        : "revision";
    let applied = false;
    const previousMainPlanText = normalizeMainPlanText(bucket.planText);

    if (normalizedStage === "revision") {
      const nextDocument = parsePlanDocumentFromText(bucket.planText);
      const patchApplied = applyPatchCommandsToPlanDocument(nextDocument, payloadText, { stage: "revision" });
      if (patchApplied.changed) {
        bucket.planDocument = nextDocument;
        bucket.planText = renderPlanDocument(nextDocument);
        applied = true;
      } else {
        const fullMainPlans = parseMainPlansFromPlanText(payloadText);
        if (fullMainPlans.length) {
          const replaced = parsePlanDocumentFromText(
            fullMainPlans.map((item = {}) => `${item.id}. ${item.content}`).join("\n"),
          );
          bucket.planDocument = replaced;
          bucket.planText = renderPlanDocument(replaced);
          applied = true;
        }
      }
      if (!applied) applied = appendRawPatchText(bucket, payloadText, source);
      if (applied) bucket.globalRevisionCount = Number(bucket.globalRevisionCount || 0) + 1;
    } else {
      const nextDocument = parsePlanDocumentFromText(bucket.planText);
      const patchApplied = applyPatchCommandsToPlanDocument(nextDocument, payloadText, { stage: "refinement" });
      if (patchApplied.changed) {
        bucket.planDocument = nextDocument;
        bucket.planText = renderPlanDocument(nextDocument);
        applied = true;
      } else {
        applied = appendRawPatchText(bucket, payloadText, source);
      }
      if (!Array.isArray(bucket.planRefinementRecords)) bucket.planRefinementRecords = [];
      bucket.planRefinementRecords.push({
        source,
        stage: "refinement",
        refinedAt: new Date().toISOString(),
        summary: String(summary || "").trim() || undefined,
        targetMainStepIndexes: Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [],
        patchText: payloadText,
        planText: bucket.planText,
      });
      if (bucket.planRefinementRecords.length > 30) {
        bucket.planRefinementRecords.splice(0, bucket.planRefinementRecords.length - 30);
      }
    }

    if (!applied) return false;
    const nextMainPlanText = normalizeMainPlanText(bucket.planText);
    if (normalizedStage === "revision") {
      bucket.lastMainPlanRevisionChanged = nextMainPlanText !== previousMainPlanText;
    }
    state.flags.planningCaptured = String(bucket.planText || "").trim().length > 0;
    if (!Array.isArray(bucket.planRevisions)) bucket.planRevisions = [];
    bucket.planRevisions.push({
      source,
      stage: normalizedStage,
      revisedAt: new Date().toISOString(),
      summary: String(summary || "").trim() || undefined,
      planText: bucket.planText,
      checklistCount: parseMainPlansFromPlanText(bucket.planText).length,
    });
    if (bucket.planRevisions.length > 20) bucket.planRevisions.splice(0, bucket.planRevisions.length - 20);
    appendCapabilityLog?.(ctx, {
      domain: CAPABILITY_DOMAIN?.PLANNING,
      event:
        normalizedStage === "revision"
          ? "planning_checklist_revised_after_summary"
          : "planning_checklist_refined_after_revision",
      detail: {
        stage: normalizedStage,
        checklistCount: parseMainPlansFromPlanText(bucket.planText).length,
        mainPlanChanged: normalizedStage === "revision" ? bucket.lastMainPlanRevisionChanged === true : undefined,
      },
    });
    return true;
  }

  function buildPlanningRefinementPrompt(locale = LOCALE?.ZH_CN, bucket = {}, state = {}, summaryText = "") {
    const targets = resolveRefinementTargetMainSteps(bucket, state);
    const target = targets[0] || { index: 1, task: "" };
    const existingSubPlans = formatSubPlansText(
      parseSubPlansFromPlanText(bucket.planText, Number(target.index)),
      Number(target.index),
    );
    return buildPlanningRefinementPromptText({
      locale,
      marker: getPlanningRefinementMarker(locale),
      data: {
        targetId: Number(target.index),
        targetContent: String(target.task || "").trim(),
        existingSubPlansText: existingSubPlans,
        feedback: String(summaryText || "").trim(),
      },
    });
  }

  function buildNextPhaseRelayContent(bucket = {}, locale = LOCALE?.ZH_CN, stage = "revision") {
    const normalizedStage =
      String(stage || "revision").trim().toLowerCase() === "refinement" ? "refinement" : "revision";
    const title =
      normalizedStage === "refinement"
        ? locale === LOCALE?.EN_US
          ? "Refined plan text:"
          : "细化后的计划文本："
        : locale === LOCALE?.EN_US
          ? "Revised plan text:"
          : "修正后的计划文本：";
    return `${title}\n${String(bucket?.planText || "").trim() || (locale === LOCALE?.EN_US ? "N/A" : "（空）")}`;
  }

  return {
    resolveRefinementTargetMainSteps,
    applyRevisedPlanFromText,
    buildPlanningRefinementPrompt,
    buildNextPhaseRelayContent,
  };
}
