/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  ensureHarnessBucket,
  extractJsonObjectFromText,
  extractRawTextContent,
  getDefaultTaskOwner,
  parseRefinementChecklistFromModelOutput,
  parseTaskChecklistFromModelOutput,
  relaySeparateModelOutputAsUserMessage,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelName,
  resolveCapabilityModelMessages,
  resolveCapabilityToolAllowlist,
  translateI18nText,
} from "./deps.js";
import { extractPlanMetadataFromText, isPlanPayloadComplete } from "../model-response-parser.js";

function ensurePlanRefinementState(state = {}) {
  if (!state || typeof state !== "object") return { byMainStep: {} };
  if (!state.planRefinementState || typeof state.planRefinementState !== "object") {
    state.planRefinementState = { byMainStep: {} };
  }
  if (!state.planRefinementState.byMainStep || typeof state.planRefinementState.byMainStep !== "object") {
    state.planRefinementState.byMainStep = {};
  }
  return state.planRefinementState;
}

function isMainChecklistStep(item = {}) {
  const index = Number(item?.index);
  const mainStepIndex = Number(item?.mainStepIndex);
  if (!Number.isFinite(index)) return false;
  if (item?.isMainStep === true) return true;
  if (!Number.isFinite(mainStepIndex)) return true;
  return mainStepIndex === index;
}

function buildMainStepSnapshotMap(checklist = []) {
  const map = new Map();
  for (const item of Array.isArray(checklist) ? checklist : []) {
    const index = Number(item?.index);
    if (!Number.isFinite(index) || !isMainChecklistStep(item)) continue;
    const normalized = {
      index,
      task: String(item?.task || "").trim(),
      input: String(item?.input || "").trim(),
      output: String(item?.output || "").trim(),
      files: item?.files && typeof item.files === "object" ? item.files : { create: [], modify: [], delete: [] },
    };
    map.set(index, JSON.stringify(normalized));
  }
  return map;
}

function resetRefinementStateByRevision(state = {}, previousChecklist = [], nextChecklist = []) {
  const refinementState = ensurePlanRefinementState(state);
  const previousMap = buildMainStepSnapshotMap(previousChecklist);
  const nextMap = buildMainStepSnapshotMap(nextChecklist);
  for (const [index, currentSnapshot] of nextMap.entries()) {
    const previousSnapshot = previousMap.get(index);
    if (!previousSnapshot || previousSnapshot !== currentSnapshot) {
      refinementState.byMainStep[String(index)] = false;
    }
  }
  for (const index of previousMap.keys()) {
    if (!nextMap.has(index)) {
      delete refinementState.byMainStep[String(index)];
    }
  }
}

function markRefinementConsumed(state = {}, mainStepIndexes = []) {
  const refinementState = ensurePlanRefinementState(state);
  for (const index of Array.isArray(mainStepIndexes) ? mainStepIndexes : []) {
    const normalized = Number(index);
    if (!Number.isFinite(normalized)) continue;
    refinementState.byMainStep[String(normalized)] = true;
  }
}

function resolveRefinementTargetMainSteps(bucket = {}, state = {}) {
  const checklist = Array.isArray(bucket?.taskChecklist) ? bucket.taskChecklist : [];
  const mainSteps = checklist
    .filter((item = {}) => isMainChecklistStep(item))
    .map((item = {}) => ({
      index: Number(item.index),
      task: String(item.task || "").trim(),
    }))
    .filter((item) => Number.isFinite(item.index));
  const refinementState = ensurePlanRefinementState(state);
  const unrefined = mainSteps.filter((step) => refinementState.byMainStep[String(step.index)] !== true);
  if (!unrefined.length) return [];
  const nextIndexes = Array.isArray(bucket?.nextPhase?.checklistIndexes)
    ? bucket.nextPhase.checklistIndexes.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : [];
  const preferred = nextIndexes.length
    ? unrefined.filter((item) => nextIndexes.includes(item.index))
    : [];
  return (preferred.length ? preferred : unrefined).slice(0, 1);
}

function normalizeRefinementChecklist(checklist = [], targetMainStepIndexes = []) {
  const targetSet = new Set(
    (Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item)),
  );
  if (!targetSet.size) return [];
  const normalized = [];
  for (const [index, item] of (Array.isArray(checklist) ? checklist : []).entries()) {
    const source = item && typeof item === "object" ? item : {};
    const mainStepIndex = Number(source.mainStepIndex);
    if (!Number.isFinite(mainStepIndex) || !targetSet.has(mainStepIndex) || source.isMainStep === true) {
      continue;
    }
    normalized.push({
      ...source,
      index: Number(source.index) || index + 1,
      mainStepIndex,
      isMainStep: false,
    });
  }
  return normalized;
}

function applyRevisedPlanFromText(
  ctx = {},
  text = "",
  { summary = "", source = "planning_revision", stage = "revision", targetMainStepIndexes = [] } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  const previousChecklist = Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist : [];
  const normalizedStage =
    String(stage || source || "revision").toLowerCase().includes("refinement") ? "refinement" : "revision";
  const checklist =
    normalizedStage === "refinement"
      ? parseRefinementChecklistFromModelOutput(text, locale)
      : parseTaskChecklistFromModelOutput(text, locale);
  if (!checklist.length) return false;
  if (!isPlanPayloadComplete(text, checklist)) return false;
  if (normalizedStage === "refinement") {
    const payloadObject = extractJsonObjectFromText(text);
    const payloadStage = String(payloadObject?.stage || "").trim().toLowerCase();
    if (payloadStage !== "refinement") {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_refinement_rejected_invalid_stage",
        detail: { stage: payloadStage || "missing" },
      });
      return false;
    }
    if (Array.isArray(payloadObject?.taskChecklist)) {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_refinement_rejected_forbidden_task_checklist",
      });
      return false;
    }
  }
  const normalizedChecklistForRevision =
    normalizedStage === "revision"
      ? checklist.map((item = {}, index) => ({
          ...item,
          index: Number(item?.index) || index + 1,
          mainStepIndex: Number(item?.index) || index + 1,
          isMainStep: true,
        }))
      : [];
  const normalizedChecklistForRefinement =
    normalizedStage === "refinement"
      ? normalizeRefinementChecklist(checklist, targetMainStepIndexes)
      : [];
  if (normalizedStage === "refinement" && !normalizedChecklistForRefinement.length) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_rejected_invalid_target_main_step",
      detail: { targetMainStepIndexes: Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [] },
    });
    return false;
  }
  const previousMainPlanVersion = Number.isFinite(Number(bucket.mainPlanVersion))
    ? Number(bucket.mainPlanVersion)
    : 0;
  const mainPlanVersion =
    normalizedStage === "revision"
      ? previousMainPlanVersion + 1 || 1
      : previousMainPlanVersion || 1;
  const payload = extractPlanMetadataFromText(text);
  if (normalizedStage === "revision") {
    bucket.taskChecklist = normalizedChecklistForRevision;
    bucket.taskChecklistSource = source;
  }
  bucket.mainPlanVersion = mainPlanVersion;
  bucket.currentMainPlanVersion = mainPlanVersion;
  if (normalizedStage === "revision") {
    bucket.totalGoal = String(payload.totalGoal ?? bucket.totalGoal ?? "").trim();
    bucket.taskOwner =
      String(payload.taskOwner ?? bucket.taskOwner ?? getDefaultTaskOwner(locale)).trim() ||
      getDefaultTaskOwner(locale);
    const nextPhase = payload.nextPhase && typeof payload.nextPhase === "object" ? payload.nextPhase : {};
    if (nextPhase.objective || nextPhase.content || nextPhase.checklistIndexes.length) {
      bucket.nextPhase = nextPhase;
    }
  }
  bucket.planRefinementIncrementPlan = {
    source,
    stage: normalizedStage,
    mainPlanVersion,
    refinedAt: new Date().toISOString(),
    summary: String(summary || "").trim() || undefined,
    totalGoal: bucket.totalGoal || "",
    taskOwner: bucket.taskOwner || getDefaultTaskOwner(locale),
    nextPhase: bucket.nextPhase || null,
    taskChecklist:
      normalizedStage === "revision"
        ? Array.isArray(bucket.taskChecklist)
          ? bucket.taskChecklist
          : []
        : normalizedChecklistForRefinement,
    incrementalSource: "planning_checklist",
    targetMainStepIndexes: Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [],
  };
  if (normalizedStage === "revision") {
    resetRefinementStateByRevision(state, previousChecklist, bucket.taskChecklist);
  } else {
    markRefinementConsumed(state, targetMainStepIndexes);
    if (!Array.isArray(bucket.planRefinementRecords)) bucket.planRefinementRecords = [];
    bucket.planRefinementRecords.push({
      source,
      stage: "refinement",
      mainPlanVersion,
      refinedAt: new Date().toISOString(),
      targetMainStepIndexes: Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [],
      taskChecklist: normalizedChecklistForRefinement,
    });
    if (bucket.planRefinementRecords.length > 30) {
      bucket.planRefinementRecords.splice(0, bucket.planRefinementRecords.length - 30);
    }
  }
  if (!Array.isArray(bucket.planRevisions)) bucket.planRevisions = [];
  bucket.planRevisions.push({
    source,
    stage: normalizedStage,
    mainPlanVersion,
    revisedAt: new Date().toISOString(),
    summary: String(summary || "").trim() || undefined,
    totalGoal: bucket.totalGoal || "",
    nextPhase: bucket.nextPhase || null,
    taskChecklist:
      normalizedStage === "revision"
        ? Array.isArray(bucket.taskChecklist)
          ? [...bucket.taskChecklist]
          : []
        : normalizedChecklistForRefinement,
    checklistCount:
      normalizedStage === "revision"
        ? Array.isArray(bucket.taskChecklist)
          ? bucket.taskChecklist.length
          : 0
        : normalizedChecklistForRefinement.length,
  });
  if (bucket.planRevisions.length > 20) bucket.planRevisions.splice(0, bucket.planRevisions.length - 20);
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event:
      normalizedStage === "revision"
        ? "planning_checklist_revised_after_summary"
        : "planning_checklist_refined_after_revision",
    detail: {
      checklistCount:
        normalizedStage === "revision"
          ? Array.isArray(bucket.taskChecklist)
            ? bucket.taskChecklist.length
            : 0
          : normalizedChecklistForRefinement.length,
      hasNextPhase: Boolean(bucket.nextPhase),
      targetMainStepIndexes: Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [],
    },
  });
  return true;
}

function buildPlanningRefinementPrompt(locale = LOCALE.ZH_CN, bucket = {}, state = {}, summaryText = "") {
  const targetMainSteps = resolveRefinementTargetMainSteps(bucket, state);
  const planJsonExample =
    '{"stage":"refinement","totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"refinementChecklist":[{"index":101,"mainStepIndex":1,"isMainStep":false,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}';
  return [
    translateI18nText(locale, "planningRefinementMarker"),
    translateI18nText(locale, "planningRefinementPromptBody", {
      example: planJsonExample,
    }),
    JSON.stringify({
      currentSummary: String(summaryText || "").trim(),
      currentPlan: {
        totalGoal: bucket.totalGoal || "",
        taskOwner: bucket.taskOwner || getDefaultTaskOwner(locale),
        taskChecklist: bucket.taskChecklist || [],
        nextPhase: bucket.nextPhase || null,
      },
      harnessState: {
        signals: state.signals || {},
        counters: state.counters || {},
      },
      targetMainSteps,
      refinementRules: {
        oneRefinementPerMainStep: true,
        returnItemsMustBelongToTargetMainSteps: true,
      },
    }, null, 2),
  ].join("\n");
}

function buildNextPhaseRelayContent(bucket = {}, locale = LOCALE.ZH_CN, stage = "revision") {
  const nextPhase = bucket?.nextPhase && typeof bucket.nextPhase === "object" ? bucket.nextPhase : null;
  const normalizedStage = String(stage || "revision").trim().toLowerCase() === "refinement" ? "refinement" : "revision";
  const refinementPlan =
    bucket?.planRefinementIncrementPlan &&
    typeof bucket.planRefinementIncrementPlan === "object" &&
    bucket.planRefinementIncrementPlan.stage === "refinement"
      ? bucket.planRefinementIncrementPlan
      : null;
  const selected =
    normalizedStage === "refinement"
      ? Array.isArray(refinementPlan?.taskChecklist)
        ? refinementPlan.taskChecklist
        : []
      : nextPhase?.checklistIndexes?.length
        ? (bucket.taskChecklist || []).filter((item) => nextPhase.checklistIndexes.includes(Number(item.index)))
        : [];
  const payload = {
    totalGoal: bucket.totalGoal || "",
    nextPhase: nextPhase || {},
    taskChecklist:
      selected.length
        ? selected
        : normalizedStage === "refinement"
          ? []
          : bucket.taskChecklist || [],
  };
  const title =
    normalizedStage === "refinement"
      ? locale === LOCALE.EN_US
        ? "Refined next phase substeps:"
        : "细化后的下一阶段子步骤："
      : locale === LOCALE.EN_US
        ? "Next phase plan checklist:"
        : "下一阶段计划清单：";
  return `${title}
${JSON.stringify(payload, null, 2)}`;
}

export async function runPlanningRefinementBySeparateModel(
  ctx = {},
  meta = {},
  { summaryText = "", source = "planning_refinement", baseMessages = null } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return { applied: false, status: "missing_harness_bucket" };
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_invoker_missing",
    });
    return { applied: false, status: "invoker_missing" };
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const refinementTargetMainSteps = resolveRefinementTargetMainSteps(bucket, state);
  if (!refinementTargetMainSteps.length) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_converged_no_target_main_step",
    });
    return { applied: false, status: "converged" };
  }

  const modelMessages = Array.isArray(baseMessages)
    ? baseMessages
    : resolveCapabilityModelMessages(meta, {
        ctx,
        purpose: "planning_refinement",
        messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
      });
  const refinementMessages = [...modelMessages];
  refinementMessages.push({
    role: "user",
    content: buildPlanningRefinementPrompt(
      locale,
      bucket,
      state,
      String(summaryText || "").trim(),
    ),
  });

  let refinementResponse = null;
  try {
    refinementResponse = await invoker({
      purpose: "planning_refinement",
      domain: CAPABILITY_DOMAIN.PLANNING,
      model: resolveCapabilityModelName(meta, {
        purpose: "planning_refinement",
        domain: CAPABILITY_DOMAIN.PLANNING,
      }),
      locale,
      prompt: "",
      messages: refinementMessages,
      ctx,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, "planning_refinement"),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_model_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return {
      applied: false,
      status: "model_failed",
      error: String(error?.message || error || ""),
    };
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    purpose: "planning_refinement",
    response: refinementResponse,
  });
  const refinementText =
    extractRawTextContent(refinementResponse?.content) ||
    String(refinementResponse?.text || refinementResponse?.output || "").trim();
  const refinementApplied = applyRevisedPlanFromText(ctx, refinementText, {
    summary: String(summaryText || "").trim(),
    source,
    stage: "refinement",
    targetMainStepIndexes: refinementTargetMainSteps.map((item) => item.index),
  });
  if (refinementApplied) {
    relaySeparateModelOutputAsUserMessage(ctx, {
      locale,
      purpose: "next_phase_plan_refinement",
      content: buildNextPhaseRelayContent(bucket, locale, "refinement"),
      dedupe: true,
    });
    return {
      applied: true,
      status: "completed",
      targetMainStepIndexes: refinementTargetMainSteps.map((item) => item.index),
    };
  }
  return {
    applied: false,
    status: "invalid_refinement_payload",
    targetMainStepIndexes: refinementTargetMainSteps.map((item) => item.index),
  };
}

