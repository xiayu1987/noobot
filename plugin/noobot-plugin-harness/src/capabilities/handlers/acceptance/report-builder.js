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
import { resolveFirstMatchedRuleResult } from "../shared/rule-table-utils.js";
import { buildStatusSummary, nowIsoTimestamp } from "../shared/report-utils.js";
import { parsePlanDocumentFromText } from "../shared/plan-text-protocol.js";

const TASK_STATUS = Object.freeze({
  COMPLETED: "completed",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
});

const ACCEPTANCE_TASK_STATUS_RULES = Object.freeze([
  {
    matches: ({ text = "" } = {}) => text.includes("附件") || text.includes("attachment"),
    resolve: ({ signals = {} } = {}) =>
      signals.parsedAttachment ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING,
  },
  {
    matches: ({ text = "" } = {}) =>
      (text.includes("子任务") && text.includes("开启")) ||
      (text.includes("subtask") && text.includes("start")),
    resolve: ({ signals = {} } = {}) =>
      signals.subtaskStarted ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING,
  },
  {
    matches: ({ text = "" } = {}) =>
      (text.includes("等待") && text.includes("子任务")) ||
      (text.includes("wait") && text.includes("subtask")),
    resolve: ({ signals = {} } = {}) =>
      signals.subtaskWaited ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING,
  },
]);

function evaluateTaskStatus(task = {}, state = {}) {
  const text = String(task?.task || "").toLowerCase();
  const signals = state?.signals || {};
  return resolveFirstMatchedRuleResult(
    ACCEPTANCE_TASK_STATUS_RULES,
    { signals, task, state, text },
    signals.successfulToolCount > 0 ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.PENDING,
  );
}

function buildAcceptanceSummary(items = []) {
  return buildStatusSummary(items, {
    statusAccessor: (item = {}) => item?.status,
    fields: [
      { key: "completed", value: TASK_STATUS.COMPLETED },
      { key: "inProgress", value: TASK_STATUS.IN_PROGRESS },
      { key: "pending", value: TASK_STATUS.PENDING },
    ],
  });
}

export function buildAcceptanceReport({ bucket = {}, state = {}, mode = ACCEPTANCE_MODE.ACTIVE } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  const planText = String(bucket?.planText || "").trim();
  const parsedPlan = parsePlanDocumentFromText(planText);
  const checklistFromPlanText = [
    ...(Array.isArray(parsedPlan?.mainPlans) ? parsedPlan.mainPlans : []).map((item = {}) => ({
      index: Number(item?.id),
      task: String(item?.content || "").trim(),
    })),
  ];
  const checklist =
    checklistFromPlanText.length
      ? checklistFromPlanText
      : Array.isArray(bucket.taskChecklist) && bucket.taskChecklist.length
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
    acceptedAt: nowIsoTimestamp(),
    planText,
    summary: buildAcceptanceSummary(items),
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

function buildBasePlanRecord({
  source = "",
  revisedAt = "",
  totalGoal = "",
  taskOwner = "",
  nextPhase = null,
  taskChecklist = [],
} = {}) {
  return {
    source: String(source || "").trim(),
    revisedAt: String(revisedAt || "").trim() || undefined,
    totalGoal: String(totalGoal || "").trim(),
    taskOwner: String(taskOwner || "").trim(),
    nextPhase: nextPhase && typeof nextPhase === "object" ? nextPhase : null,
    taskChecklist: Array.isArray(taskChecklist) ? taskChecklist : [],
  };
}

function buildFallbackMainPlan(bucket = {}, locale = LOCALE.ZH_CN) {
  return {
    ...buildBasePlanRecord({
      source: bucket.taskChecklistSource || "current_plan",
      revisedAt: undefined,
      totalGoal: bucket.totalGoal || "",
      taskOwner: bucket.taskOwner || getDefaultTaskOwner(locale),
      nextPhase: bucket?.nextPhase,
      taskChecklist: bucket.taskChecklist,
    }),
    taskOwner: String(bucket.taskOwner || getDefaultTaskOwner(locale)).trim() || getDefaultTaskOwner(locale),
    mainPlanVersion: resolveCurrentMainPlanVersion(bucket),
    stage: "main_plan",
  };
}

function resolveTaskOwner(taskOwner = "", fallbackTaskOwner = "", locale = LOCALE.ZH_CN) {
  return String(taskOwner || fallbackTaskOwner || getDefaultTaskOwner(locale)).trim() ||
    getDefaultTaskOwner(locale);
}

function normalizeMainPlanRecord(plan = {}, bucket = {}, locale = LOCALE.ZH_CN) {
  return {
    ...buildBasePlanRecord({
      source: String(plan?.source || "").trim() || "unknown",
      revisedAt: plan?.revisedAt,
      totalGoal: plan?.totalGoal,
      taskOwner: resolveTaskOwner(plan?.taskOwner, bucket.taskOwner, locale),
      nextPhase: plan?.nextPhase,
      taskChecklist: plan?.taskChecklist,
    }),
    mainPlanVersion: Number.isFinite(Number(plan?.mainPlanVersion))
      ? Number(plan.mainPlanVersion)
      : resolveCurrentMainPlanVersion(bucket),
    stage: String(plan?.stage || "main_plan").trim() || "main_plan",
  };
}

function buildOrderedPlanRecord(plan = {}, bucket = {}, locale = LOCALE.ZH_CN) {
  return {
    ...buildBasePlanRecord({
      source: String(plan?.source || "").trim() || "unknown",
      revisedAt: plan?.revisedAt,
      totalGoal: plan?.totalGoal,
      taskOwner: resolveTaskOwner(plan?.taskOwner, bucket.taskOwner, locale),
      nextPhase: plan?.nextPhase,
      taskChecklist: plan?.taskChecklist,
    }),
  };
}

function buildOrderedFallbackPlanRecord(bucket = {}, locale = LOCALE.ZH_CN) {
  return {
    ...buildBasePlanRecord({
      source: bucket.taskChecklistSource || "current_plan",
      revisedAt: undefined,
      totalGoal: bucket.totalGoal || "",
      taskOwner: resolveTaskOwner(bucket.taskOwner, "", locale),
      nextPhase: bucket?.nextPhase,
      taskChecklist: bucket?.taskChecklist,
    }),
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
        ...buildOrderedFallbackPlanRecord(bucket, locale),
      },
    ];
  }
  return revisions.map((plan = {}, index) => ({
    order: index + 1,
    ...buildOrderedPlanRecord(plan, bucket, locale),
  }));
}

export function buildSemanticValidationPromptPayload({
  bucket = {},
  state = {},
  baseReport = null,
  finalOutput = "",
  locale = LOCALE.ZH_CN,
} = {}) {
  const planText = String(bucket?.planText || "").trim();
  if (planText) {
    return {
      expectedSchema: {
        status: "pass|warn|fail",
        consistent: true,
        missingItems: [],
        unsupportedClaims: [],
        checklistCoverage: [],
        suggestions: [],
      },
      planText,
      taskChecklist: [],
      finalPlanChecklist: [],
      plan: buildPlanSnapshot(bucket, locale),
      acceptanceReport: baseReport,
      toolSignals: state.signals || {},
      finalOutput,
    };
  }
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

export function renderAcceptanceReportText(report = {}, locale = LOCALE.ZH_CN) {
  const data = report && typeof report === "object" ? report : {};
  const mode = String(data.mode || "").trim() || "active";
  const acceptedAt = String(data.acceptedAt || "").trim() || "";
  const planText = String(data.planText || data?.plan?.planText || "").trim();
  const checklist = Array.isArray(data.finalPlanChecklist) ? data.finalPlanChecklist : [];
  const summary = data?.summary && typeof data.summary === "object" ? data.summary : {};
  const semanticValidation = data?.semanticValidation && typeof data.semanticValidation === "object"
    ? data.semanticValidation
    : null;
  const lines = [
    locale === LOCALE.EN_US ? "[Harness-Acceptance]" : "[Harness-验收]",
    `mode: ${mode}`,
    acceptedAt ? `acceptedAt: ${acceptedAt}` : "",
    planText
      ? `${locale === LOCALE.EN_US ? "planText" : "计划文本"}:\n${planText}`
      : "",
    locale === LOCALE.EN_US ? "Acceptance Checklist:" : "验收清单：",
    ...checklist.map((item = {}) => {
      const index = String(item?.index ?? "").trim();
      const task = String(item?.task || "").trim();
      const status = String(item?.status || "").trim() || "pending";
      return `${index}. [${status}] ${task}`;
    }),
    Object.keys(summary).length
      ? `${locale === LOCALE.EN_US ? "summary" : "汇总"}: ${JSON.stringify(summary)}`
      : "",
    semanticValidation?.content
      ? `${locale === LOCALE.EN_US ? "semanticValidation" : "语义验收"}:\n${String(semanticValidation.content)}`
      : "",
  ].filter(Boolean);
  return lines.join("\n").trim();
}
