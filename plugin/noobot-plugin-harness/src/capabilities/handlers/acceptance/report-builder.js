/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ACCEPTANCE_MODE,
  LOCALE,
  buildPlanSnapshot,
  defaultTaskChecklist,
  getDefaultTaskOwner,
  normalizeChecklistItem,
} from "./deps.js";

const TASK_STATUS = Object.freeze({
  COMPLETED: "completed",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
});

function evaluateTaskStatus(task = {}, state = {}) {
  const text = String(task?.task || "").toLowerCase();
  const signals = state?.signals || {};
  if (text.includes("附件") || text.includes("attachment")) {
    return signals.parsedAttachment ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING;
  }
  if ((text.includes("子任务") && text.includes("开启")) || (text.includes("subtask") && text.includes("start"))) {
    return signals.subtaskStarted ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING;
  }
  if ((text.includes("等待") && text.includes("子任务")) || (text.includes("wait") && text.includes("subtask"))) {
    return signals.subtaskWaited ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING;
  }
  return signals.successfulToolCount > 0 ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.PENDING;
}

export function buildAcceptanceReport({ bucket = {}, state = {}, mode = ACCEPTANCE_MODE.ACTIVE } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  const checklist = Array.isArray(bucket.taskChecklist) && bucket.taskChecklist.length
    ? bucket.taskChecklist
    : defaultTaskChecklist(locale);
  const items = checklist.map((task, index) => {
    const normalized = normalizeChecklistItem(task, index, locale);
    return {
      ...normalized,
      status: evaluateTaskStatus(normalized, state),
    };
  });
  const plan = buildPlanSnapshot(bucket, locale);
  return {
    mode,
    acceptedAt: new Date().toISOString(),
    summary: {
      total: items.length,
      completed: items.filter((item) => item.status === TASK_STATUS.COMPLETED).length,
      inProgress: items.filter((item) => item.status === TASK_STATUS.IN_PROGRESS).length,
      pending: items.filter((item) => item.status === TASK_STATUS.PENDING).length,
    },
    taskChecklist: items,
    finalPlanChecklist: items,
    plan,
  };
}

function resolveCurrentMainPlanVersion(bucket = {}) {
  if (Number.isFinite(Number(bucket?.currentMainPlanVersion))) return Number(bucket.currentMainPlanVersion);
  if (Number.isFinite(Number(bucket?.mainPlanVersion))) return Number(bucket.mainPlanVersion);
  return 1;
}

function buildFallbackMainPlan(bucket = {}, locale = LOCALE.ZH_CN) {
  return {
    source: String(bucket.taskChecklistSource || "current_plan").trim(),
    revisedAt: undefined,
    totalGoal: String(bucket.totalGoal || "").trim(),
    taskOwner: String(bucket.taskOwner || getDefaultTaskOwner(locale)).trim() || getDefaultTaskOwner(locale),
    nextPhase: bucket?.nextPhase && typeof bucket.nextPhase === "object" ? bucket.nextPhase : null,
    taskChecklist: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist : [],
    mainPlanVersion: resolveCurrentMainPlanVersion(bucket),
    stage: "main_plan",
  };
}

function normalizeMainPlanRecord(plan = {}, bucket = {}, locale = LOCALE.ZH_CN) {
  return {
    source: String(plan?.source || "").trim() || "unknown",
    revisedAt: String(plan?.revisedAt || "").trim() || undefined,
    totalGoal: String(plan?.totalGoal || "").trim(),
    taskOwner:
      String(plan?.taskOwner || bucket.taskOwner || getDefaultTaskOwner(locale)).trim() ||
      getDefaultTaskOwner(locale),
    nextPhase: plan?.nextPhase && typeof plan.nextPhase === "object" ? plan.nextPhase : null,
    taskChecklist: Array.isArray(plan?.taskChecklist) ? plan.taskChecklist : [],
    mainPlanVersion: Number.isFinite(Number(plan?.mainPlanVersion))
      ? Number(plan.mainPlanVersion)
      : resolveCurrentMainPlanVersion(bucket),
    stage: String(plan?.stage || "main_plan").trim() || "main_plan",
  };
}

function resolveFinalMainPlan(bucket = {}, locale = LOCALE.ZH_CN) {
  const revisions = Array.isArray(bucket.planRevisions) ? bucket.planRevisions : [];
  const mainCandidates = revisions.filter((plan = {}) => String(plan?.stage || "").trim() !== "refinement");
  const selected = (mainCandidates.length ? mainCandidates[mainCandidates.length - 1] : null) || buildFallbackMainPlan(bucket, locale);
  return normalizeMainPlanRecord(selected, bucket, locale);
}

function collectRefinementsForMainPlanVersion(bucket = {}, mainPlanVersion = 1) {
  return (Array.isArray(bucket.planRefinementRecords) ? bucket.planRefinementRecords : [])
    .filter((item = {}) => {
      const version = Number(item?.mainPlanVersion);
      return Number.isFinite(version) && version === Number(mainPlanVersion);
    })
    .map((item = {}, index) => ({
      order: index + 1,
      source: String(item?.source || "").trim() || "planning_refinement",
      refinedAt: String(item?.refinedAt || "").trim() || undefined,
      mainPlanVersion: Number(mainPlanVersion),
      targetMainStepIndexes: Array.isArray(item?.targetMainStepIndexes) ? item.targetMainStepIndexes : [],
      taskChecklist: Array.isArray(item?.taskChecklist) ? item.taskChecklist : [],
    }));
}

function buildPlansInOrder(bucket = {}, locale = LOCALE.ZH_CN) {
  const revisions = Array.isArray(bucket.planRevisions) ? bucket.planRevisions : [];
  if (!revisions.length) {
    return [
      {
        order: 1,
        source: String(bucket.taskChecklistSource || "current_plan").trim(),
        revisedAt: undefined,
        totalGoal: String(bucket.totalGoal || "").trim(),
        taskOwner: String(bucket.taskOwner || getDefaultTaskOwner(locale)).trim() || getDefaultTaskOwner(locale),
        nextPhase: bucket?.nextPhase && typeof bucket.nextPhase === "object" ? bucket.nextPhase : null,
        taskChecklist: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist : [],
      },
    ];
  }
  return revisions.map((plan = {}, index) => ({
    order: index + 1,
    source: String(plan?.source || "").trim() || "unknown",
    revisedAt: String(plan?.revisedAt || "").trim() || undefined,
    totalGoal: String(plan?.totalGoal || "").trim(),
    taskOwner: String(plan?.taskOwner || bucket.taskOwner || getDefaultTaskOwner(locale)).trim() ||
      getDefaultTaskOwner(locale),
    nextPhase: plan?.nextPhase && typeof plan.nextPhase === "object" ? plan.nextPhase : null,
    taskChecklist: Array.isArray(plan?.taskChecklist) ? plan.taskChecklist : [],
  }));
}

export function buildSemanticValidationPromptPayload({
  bucket = {},
  state = {},
  baseReport = null,
  finalOutput = "",
  locale = LOCALE.ZH_CN,
} = {}) {
  const finalMainPlan = resolveFinalMainPlan(bucket, locale);
  const refinementPlansForFinalMainPlan = collectRefinementsForMainPlanVersion(
    bucket,
    finalMainPlan.mainPlanVersion,
  );
  const finalMainPlanChecklist = Array.isArray(finalMainPlan.taskChecklist) ? finalMainPlan.taskChecklist : [];
  const finalRefinementChecklist = refinementPlansForFinalMainPlan.flatMap((item = {}) =>
    Array.isArray(item?.taskChecklist) ? item.taskChecklist : [],
  );
  const validationChecklist = [...finalMainPlanChecklist, ...finalRefinementChecklist];
  const plansInOrder = buildPlansInOrder(bucket, locale);
  return {
    expectedSchema: {
      status: "pass|warn|fail",
      consistent: true,
      missingItems: [],
      unsupportedClaims: [],
      checklistCoverage: [
        { index: 1, task: "...", covered: true, evidence: "...", risk: "low|medium|high" },
      ],
      suggestions: [],
    },
    finalPlanChecklist: validationChecklist,
    taskChecklist: validationChecklist,
    plan: buildPlanSnapshot(bucket, locale),
    finalMainPlan,
    refinementPlansForFinalMainPlan,
    plansInOrder,
    acceptanceReport: baseReport,
    toolSignals: state.signals || {},
    finalOutput,
  };
}
