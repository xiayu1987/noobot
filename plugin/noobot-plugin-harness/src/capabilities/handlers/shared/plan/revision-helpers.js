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

function formatSubPlansText(subPlans = [], targetId = 0) {
  if (!Array.isArray(subPlans) || !subPlans.length) return "（空）";
  return subPlans
    .filter((item = {}) => Number(item.mainId) === Number(targetId))
    .map((item = {}) => `${item.id} ${String(item.content || "").trim()}`)
    .join("\n") || "（空）";
}

function normalizeMainStepIndexes(indexes = []) {
  return [...new Set(
    (Array.isArray(indexes) ? indexes : [])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0),
  )].sort((a, b) => a - b);
}

function extractChangedMainStepIndexes(previousDocument = {}, nextDocument = {}) {
  const previousMainPlans = Array.isArray(previousDocument?.mainPlans) ? previousDocument.mainPlans : [];
  const nextMainPlans = Array.isArray(nextDocument?.mainPlans) ? nextDocument.mainPlans : [];
  const previousMap = new Map(
    previousMainPlans
      .map((item = {}) => [Number(item.id), String(item.content || "").trim()])
      .filter(([id, content]) => Number.isFinite(id) && id > 0 && content),
  );
  const nextMap = new Map(
    nextMainPlans
      .map((item = {}) => [Number(item.id), String(item.content || "").trim()])
      .filter(([id, content]) => Number.isFinite(id) && id > 0 && content),
  );
  const changed = new Set();
  for (const id of previousMap.keys()) {
    if (!nextMap.has(id)) changed.add(id);
  }
  for (const [id, content] of nextMap.entries()) {
    if (!previousMap.has(id) || previousMap.get(id) !== content) changed.add(id);
  }
  return [...changed].sort((a, b) => a - b);
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
    if (!Array.isArray(bucket.lastRevisionChangedMainStepIndexes)) bucket.lastRevisionChangedMainStepIndexes = [];
    if (!bucket.planDocument || typeof bucket.planDocument !== "object") {
      bucket.planDocument = parsePlanDocumentFromText(bucket.planText);
    }
    return bucket;
  }

  function resolveRefinementTargetMainSteps(bucket = {}, state = {}, { preferredTargetMainStepIndexes = [] } = {}) {
    const normalizedBucket = ensurePlanTextBucket(bucket);
    const mainPlans = parseMainPlansFromPlanText(normalizedBucket.planText);
    if (!mainPlans.length) return [];
    const mainPlanMap = new Map(
      mainPlans.map((item = {}) => [Number(item.id), { index: Number(item.id), task: String(item.content || "").trim() }]),
    );
    const preferredTargets = Array.isArray(preferredTargetMainStepIndexes)
      ? preferredTargetMainStepIndexes
      : [];
    const normalizedPreferredTargets = preferredTargets
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && mainPlanMap.has(item));
    if (normalizedPreferredTargets.length) {
      return normalizedPreferredTargets.map((item) => mainPlanMap.get(item));
    }

    const pendingTargetIndexes = Array.isArray(state?.pending?.planRefinementContext?.targetMainStepIndexes)
      ? state.pending.planRefinementContext.targetMainStepIndexes
      : [];
    const normalizedPendingTargets = pendingTargetIndexes
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && mainPlanMap.has(item));
    if (normalizedPendingTargets.length) {
      return normalizedPendingTargets.map((item) => mainPlanMap.get(item));
    }

    const nextPhaseTargetIndexes = Array.isArray(normalizedBucket?.nextPhase?.checklistIndexes)
      ? normalizedBucket.nextPhase.checklistIndexes
      : [];
    const normalizedNextPhaseTargets = nextPhaseTargetIndexes
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && mainPlanMap.has(item));
    if (normalizedNextPhaseTargets.length) {
      return normalizedNextPhaseTargets.map((item) => mainPlanMap.get(item));
    }

    const doc = parsePlanDocumentFromText(normalizedBucket.planText);
    const targetsWithoutSubPlans = mainPlans
      .filter((item = {}) => {
        const id = Number(item?.id);
        const subPlans = Array.isArray(doc?.subPlansByMainId?.[String(id)]) ? doc.subPlansByMainId[String(id)] : [];
        return subPlans.length === 0;
      })
      .map((item = {}) => ({ index: Number(item.id), task: String(item.content || "").trim() }));
    if (targetsWithoutSubPlans.length) return targetsWithoutSubPlans;

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
    const normalizedTargetMainStepIndexes = normalizeMainStepIndexes(targetMainStepIndexes);
    let applied = false;
    const previousDocument = parsePlanDocumentFromText(bucket.planText);

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
          const previousSubPlansByMainId =
            previousDocument?.subPlansByMainId && typeof previousDocument.subPlansByMainId === "object"
              ? previousDocument.subPlansByMainId
              : {};
          for (const mainPlan of replaced.mainPlans) {
            const mainId = Number(mainPlan?.id);
            if (!Number.isFinite(mainId) || mainId <= 0) continue;
            const key = String(mainId);
            const copiedSubPlans = cloneSubPlansForMainId(previousSubPlansByMainId[key], mainId);
            if (copiedSubPlans.length) replaced.subPlansByMainId[key] = copiedSubPlans;
          }
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
        targetMainStepIndexes: normalizedTargetMainStepIndexes,
        patchText: payloadText,
        planText: bucket.planText,
      });
      if (bucket.planRefinementRecords.length > 30) {
        bucket.planRefinementRecords.splice(0, bucket.planRefinementRecords.length - 30);
      }
    }

    if (!applied) return false;
    const nextDocument = parsePlanDocumentFromText(bucket.planText);
    if (normalizedStage === "revision") {
      bucket.lastRevisionChangedMainStepIndexes = extractChangedMainStepIndexes(previousDocument, nextDocument);
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
        revisionChangedMainStepIndexes:
          normalizedStage === "revision"
            ? normalizeMainStepIndexes(bucket.lastRevisionChangedMainStepIndexes)
            : undefined,
        refinementTargetMainStepIndexes:
          normalizedStage === "refinement" ? normalizedTargetMainStepIndexes : undefined,
      },
    });
    return true;
  }

  function resolveRefinementTargetMainStepIndexesAfterRevision(bucket = {}, state = {}) {
    const normalizedBucket = ensurePlanTextBucket(bucket);
    const changedTargetMainStepIndexes = normalizeMainStepIndexes(
      normalizedBucket.lastRevisionChangedMainStepIndexes,
    );
    if (!changedTargetMainStepIndexes.length) return [];
    const existingMainPlanIds = new Set(
      parseMainPlansFromPlanText(normalizedBucket.planText)
        .map((item = {}) => Number(item?.id))
        .filter((item) => Number.isFinite(item) && item > 0),
    );
    void state;
    return changedTargetMainStepIndexes.filter((item) => existingMainPlanIds.has(Number(item)));
  }

  function buildPlanningRefinementPrompt(
    locale = LOCALE?.ZH_CN,
    bucket = {},
    state = {},
    summaryText = "",
    { targetMainStepIndexes = [] } = {},
  ) {
    const targets = resolveRefinementTargetMainSteps(bucket, state, {
      preferredTargetMainStepIndexes: targetMainStepIndexes,
    });
    const targetIds = targets
      .map((item = {}) => Number(item?.index))
      .filter((item) => Number.isFinite(item) && item > 0);
    const targetPlans = targets
      .map((item = {}) => `${Number(item?.index)}. ${String(item?.task || "").trim()}`.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const existingSubPlansSections = targetIds
      .map((id) => {
        const existingSubPlans = formatSubPlansText(parseSubPlansFromPlanText(bucket.planText, Number(id)), Number(id));
        return `主计划 ${id}:\n${existingSubPlans}`;
      })
      .join("\n\n")
      .trim();
    return buildPlanningRefinementPromptText({
      locale,
      marker: getPlanningRefinementMarker(locale),
      data: {
        targetIds,
        targetPlansText: targetPlans,
        existingSubPlansText: existingSubPlansSections,
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
    resolveRefinementTargetMainStepIndexesAfterRevision,
    applyRevisedPlanFromText,
    buildPlanningRefinementPrompt,
    buildNextPhaseRelayContent,
  };
}
