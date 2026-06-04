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
import { parsePlanDocumentFromText } from "../shared/plan/text-protocol.js";
import { renderAcceptanceReportText } from "./report-text-renderer.js";
import { resolveAttachmentDisplayPath } from "../shared/sandbox-path.js";

const TASK_STATUS = Object.freeze({
  COMPLETED: "completed",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
});

const MODEL_ACCEPTANCE_LINE_RE = /^\s*(ADD|UPDATE)\s+A([A-Za-z0-9._-]+)\s+(.+?)\s*$/i;

function parseModelAcceptanceItemsFromText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const items = [];
  for (const line of lines) {
    const match = String(line || "").trim().match(MODEL_ACCEPTANCE_LINE_RE);
    if (!match) continue;
    const tail = String(match[3] || "").trim();
    const planMatch = tail.match(/(?:^|\s)plan=\[?([0-9]+(?:\.[0-9]+)?)\]?/i);
    const statusMatch = tail.match(/(?:^|\s)status=(pass|warn|fail)/i);
    const riskMatch = tail.match(/(?:^|\s)risk=(low|medium|high)/i);
    const evidencePos = tail.search(/(?:^|\s)evidence=/i);
    let evidence = "";
    if (evidencePos >= 0) {
      const evidenceStart = tail.slice(0, evidencePos).length + (tail.slice(evidencePos).startsWith("evidence=") ? 9 : 10);
      const evidenceTail = tail.slice(evidenceStart).trim();
      const conclusionStart = evidenceTail.search(/\s+\[[^\]]+\]\s*$/);
      evidence = (conclusionStart >= 0 ? evidenceTail.slice(0, conclusionStart) : evidenceTail).trim();
    }
    const conclusionMatch = tail.match(/\[([^\]]+)\]\s*$/);
    const planId = String(planMatch?.[1] || "").trim();
    const status = String(statusMatch?.[1] || "").trim().toLowerCase();
    if (!planId || !status) continue;
    items.push({
      action: String(match[1] || "").trim().toUpperCase(),
      acceptanceId: `A${String(match[2] || "").trim()}`,
      planId,
      status,
      risk: String(riskMatch?.[1] || "").trim().toLowerCase(),
      evidence,
      conclusion: String(conclusionMatch?.[1] || "").trim(),
      raw: String(line || "").trim(),
    });
  }
  return items;
}

function parseSemanticAcceptanceItemsFromText(text = "") {
  return parseModelAcceptanceItemsFromText(text);
}

function mapModelAcceptanceStatusToTaskStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "pass") return TASK_STATUS.COMPLETED;
  if (normalized === "warn") return TASK_STATUS.IN_PROGRESS;
  if (normalized === "fail") return TASK_STATUS.PENDING;
  return "";
}

function resolveAcceptanceStatusForChecklistItem(item = {}, byPlan = {}) {
  const map = byPlan && typeof byPlan === "object" ? byPlan : {};
  const exactKey = String(item?.index ?? "").trim();
  if (exactKey && map[exactKey]) return map[exactKey];
  const isMainStep = item?.isMainStep !== false;
  if (isMainStep) return null;
  const parentKey = String(item?.mainStepIndex ?? "").trim();
  if (parentKey && map[parentKey]) return map[parentKey];
  return null;
}

function resolveModelAcceptanceForChecklistItem(normalized = {}, modelAcceptanceByPlan = {}) {
  const byPlan = modelAcceptanceByPlan && typeof modelAcceptanceByPlan === "object"
    ? modelAcceptanceByPlan
    : {};
  const exactKey = String(normalized?.index ?? "").trim();
  if (exactKey && byPlan[exactKey]) return byPlan[exactKey];
  const isMainStep = normalized?.isMainStep !== false;
  if (isMainStep) return null;
  const parentKey = String(normalized?.mainStepIndex ?? "").trim();
  if (parentKey && byPlan[parentKey]) return byPlan[parentKey];
  return null;
}

function resolveLatestModelAcceptance(bucket = {}) {
  const reports = Array.isArray(bucket?.phaseAcceptanceReports) ? bucket.phaseAcceptanceReports : [];
  const latest = reports.length ? reports[reports.length - 1] : null;
  const content = String(latest?.content || "").trim();
  const items = parseModelAcceptanceItemsFromText(content);
  const byPlan = {};
  for (const item of items) {
    const key = String(item?.planId || "").trim();
    if (!key) continue;
    byPlan[key] = item;
  }
  return {
    source: latest ? "phase_acceptance" : "",
    acceptedAt: String(latest?.acceptedAt || "").trim(),
    rawContent: content,
    items,
    byPlan,
  };
}

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

function buildChecklistFromParsedPlan(parsedPlan = null) {
  const source = parsedPlan && typeof parsedPlan === "object" ? parsedPlan : {};
  const mainPlans = Array.isArray(source?.mainPlans) ? source.mainPlans : [];
  const subPlansByMainId =
    source?.subPlansByMainId && typeof source.subPlansByMainId === "object"
      ? source.subPlansByMainId
      : {};
  const checklist = [];
  for (const main of mainPlans) {
    const mainId = Number(main?.id);
    const mainTask = String(main?.content || "").trim();
    if (!Number.isFinite(mainId) || !mainTask) continue;
    checklist.push({
      index: mainId,
      mainStepIndex: mainId,
      isMainStep: true,
      task: mainTask,
    });
    const subPlans = Array.isArray(subPlansByMainId[String(mainId)]) ? subPlansByMainId[String(mainId)] : [];
    for (const sub of subPlans) {
      const subIndex = Number(sub?.subIndex);
      const subTask = String(sub?.content || "").trim();
      if (!Number.isFinite(subIndex) || !subTask) continue;
      checklist.push({
        index: Number(`${mainId}.${subIndex}`),
        mainStepIndex: mainId,
        isMainStep: false,
        task: subTask,
      });
    }
  }
  return checklist;
}

function buildSummaryDetailPaths(bucket = {}, ctx = {}) {
  const directPaths = Array.isArray(bucket?.summaryDetailPaths) ? bucket.summaryDetailPaths : [];
  const metas = Array.isArray(bucket?.summaryDetailAttachmentMetas) ? bucket.summaryDetailAttachmentMetas : [];
  const metaPaths = metas
    .map((item = {}) => resolveAttachmentDisplayPath(item, ctx))
    .filter(Boolean);
  const merged = [...directPaths, ...metaPaths].map((item) => String(item || "").trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const item of merged) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function buildAcceptanceReport({
  bucket = {},
  state = {},
  ctx = {},
  mode = ACCEPTANCE_MODE.ACTIVE,
  forcedReason = "",
} = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  const planText = String(bucket?.planText || "").trim();
  const parsedPlan = parsePlanDocumentFromText(planText);
  const checklistFromPlanText = buildChecklistFromParsedPlan(parsedPlan);
  const checklist =
    checklistFromPlanText.length
      ? checklistFromPlanText
      : Array.isArray(bucket.taskChecklist) && bucket.taskChecklist.length
        ? bucket.taskChecklist
        : defaultTaskChecklist(locale);
  const latestModelAcceptance = resolveLatestModelAcceptance(bucket);
  const modelAcceptanceByPlan =
    latestModelAcceptance?.byPlan && typeof latestModelAcceptance.byPlan === "object"
      ? latestModelAcceptance.byPlan
      : {};
  const items = checklist.map((task, index) => {
    const normalized = normalizeChecklistItem(task, index, locale);
    const modelAcceptance = resolveModelAcceptanceForChecklistItem(normalized, modelAcceptanceByPlan);
    const modelMappedStatus = mapModelAcceptanceStatusToTaskStatus(modelAcceptance?.status);
    const baseStatus = evaluateTaskStatus(normalized, state);
    return {
      ...normalized,
      status: modelMappedStatus || baseStatus,
      modelAcceptance: modelAcceptance
        ? {
          acceptanceId: modelAcceptance.acceptanceId,
          status: modelAcceptance.status,
          risk: modelAcceptance.risk,
          evidence: modelAcceptance.evidence,
          conclusion: modelAcceptance.conclusion,
        }
        : undefined,
    };
  });
  const plan = buildPlanSnapshot(bucket, locale);
  const normalizedForcedReason = String(forcedReason || "").trim();
  return {
    mode,
    forcedReason: mode === ACCEPTANCE_MODE.FORCED ? normalizedForcedReason : "",
    acceptedAt: nowIsoTimestamp(),
    planText,
    summary: buildAcceptanceSummary(items),
    taskChecklist: items,
    finalPlanChecklist: items,
    plan,
    summaryDetailPaths: buildSummaryDetailPaths(bucket, ctx),
    modelAcceptance: latestModelAcceptance.items.length
      ? {
        source: latestModelAcceptance.source,
        acceptedAt: latestModelAcceptance.acceptedAt,
        rawContent: latestModelAcceptance.rawContent,
      }
      : null,
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

export function applySemanticAcceptanceToReport(report = {}) {
  const data = report && typeof report === "object" ? report : null;
  if (!data) return false;
  const semanticValidation =
    data.semanticValidation && typeof data.semanticValidation === "object"
      ? data.semanticValidation
      : null;
  const semanticRaw = String(semanticValidation?.content || "").trim();
  if (!semanticRaw) return false;
  const semanticItems = parseSemanticAcceptanceItemsFromText(semanticRaw);
  if (!semanticItems.length) return false;
  const semanticByPlan = {};
  for (const item of semanticItems) {
    const key = String(item?.planId || "").trim();
    if (!key) continue;
    semanticByPlan[key] = item;
  }
  if (!Object.keys(semanticByPlan).length) return false;

  const checklist = Array.isArray(data.finalPlanChecklist)
    ? data.finalPlanChecklist
    : Array.isArray(data.taskChecklist)
      ? data.taskChecklist
      : [];
  if (!checklist.length) return false;

  const nextChecklist = checklist.map((item = {}) => {
    const semanticAcceptance = resolveAcceptanceStatusForChecklistItem(item, semanticByPlan);
    const semanticMappedStatus = mapModelAcceptanceStatusToTaskStatus(semanticAcceptance?.status);
    const phaseMappedStatus = mapModelAcceptanceStatusToTaskStatus(item?.modelAcceptance?.status);
    const phaseStatus = String(item?.phaseStatus || "").trim() || phaseMappedStatus || "";
    const fallbackStatus = String(item?.status || "").trim() || "pending";
    const effectiveStatus = semanticMappedStatus || phaseStatus || fallbackStatus;
    const statusSource = semanticMappedStatus
      ? "semantic"
      : phaseStatus
        ? "phase"
        : "signal";
    return {
      ...item,
      phaseStatus: phaseStatus || "",
      semanticStatus: semanticMappedStatus || "",
      effectiveStatus,
      statusSource,
      status: effectiveStatus,
      semanticAcceptance: semanticAcceptance
        ? {
          acceptanceId: semanticAcceptance.acceptanceId,
          status: semanticAcceptance.status,
          risk: semanticAcceptance.risk,
          evidence: semanticAcceptance.evidence,
          conclusion: semanticAcceptance.conclusion,
        }
        : item?.semanticAcceptance,
    };
  });

  data.finalPlanChecklist = nextChecklist;
  data.taskChecklist = nextChecklist;
  data.summary = buildAcceptanceSummary(nextChecklist);
  data.semanticAcceptance = {
    source: "acceptance_semantic_validation",
    acceptedAt: String(data?.acceptedAt || "").trim(),
    rawContent: semanticRaw,
  };
  data.statusAuthority = "semantic_over_phase_over_signal";
  return true;
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
      phaseAcceptanceReports: Array.isArray(bucket?.phaseAcceptanceReports)
        ? bucket.phaseAcceptanceReports
        : [],
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
    phaseAcceptanceReports: Array.isArray(bucket?.phaseAcceptanceReports)
      ? bucket.phaseAcceptanceReports
      : [],
    toolSignals: state.signals || {},
    finalOutput,
  };
}

export { renderAcceptanceReportText };
