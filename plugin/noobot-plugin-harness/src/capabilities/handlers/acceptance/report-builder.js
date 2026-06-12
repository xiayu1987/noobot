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
  translateI18nText,
} from "./deps.js";
import { resolveFirstMatchedRuleResult } from "../shared/rule-table-utils.js";
import { buildStatusSummary, nowIsoTimestamp } from "../shared/report-utils.js";
import { parsePlanDocumentFromText } from "../shared/plan/text-protocol.js";
import { renderAcceptanceReportText } from "./report-text-renderer.js";
import { resolveAttachmentDisplayPath } from "../shared/sandbox-path.js";
import {
  getPlanAcceptanceStatusMap,
  mapPlanAcceptanceStatusToTaskStatus,
  parsePlanAcceptanceItemsFromText,
  resolvePlanAcceptanceForChecklistItem,
} from "../shared/plan/acceptance-status.js";

const TASK_STATUS = Object.freeze({
  COMPLETED: "completed",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
});

const MODEL_ACCEPTANCE_LINE_RE = /^\s*(ADD|UPDATE)\s+A([A-Za-z0-9._-]+)\s+(.+?)\s*$/i;

function resolveKeywordSet(i18nKey = "") {
  const values = [LOCALE.ZH_CN, LOCALE.EN_US]
    .map((locale) => translateI18nText(locale, i18nKey))
    .flatMap((line) => String(line || "").split("|"))
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(values)];
}

const ACCEPTANCE_SIGNAL_ATTACHMENT_KEYWORDS = resolveKeywordSet("acceptanceSignalAttachmentKeywords");
const ACCEPTANCE_SIGNAL_SUBTASK_KEYWORDS = resolveKeywordSet("acceptanceSignalSubtaskKeywords");
const ACCEPTANCE_SIGNAL_SUBTASK_START_KEYWORDS = resolveKeywordSet("acceptanceSignalSubtaskStartKeywords");
const ACCEPTANCE_SIGNAL_SUBTASK_WAIT_KEYWORDS = resolveKeywordSet("acceptanceSignalSubtaskWaitKeywords");

function includesAnyKeyword(text = "", keywords = []) {
  const source = String(text || "").toLowerCase();
  return keywords.some((token) => source.includes(token));
}

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
  return parsePlanAcceptanceItemsFromText(text);
}

function mapModelAcceptanceStatusToTaskStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  return mapPlanAcceptanceStatusToTaskStatus(normalized);
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
    matches: ({ text = "" } = {}) =>
      includesAnyKeyword(text, ACCEPTANCE_SIGNAL_ATTACHMENT_KEYWORDS),
    resolve: ({ signals = {} } = {}) =>
      signals.parsedAttachment ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING,
  },
  {
    matches: ({ text = "" } = {}) =>
      includesAnyKeyword(text, ACCEPTANCE_SIGNAL_SUBTASK_KEYWORDS) &&
      includesAnyKeyword(text, ACCEPTANCE_SIGNAL_SUBTASK_START_KEYWORDS),
    resolve: ({ signals = {} } = {}) =>
      signals.subtaskStarted ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING,
  },
  {
    matches: ({ text = "" } = {}) =>
      includesAnyKeyword(text, ACCEPTANCE_SIGNAL_SUBTASK_WAIT_KEYWORDS) &&
      includesAnyKeyword(text, ACCEPTANCE_SIGNAL_SUBTASK_KEYWORDS),
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
    const persistedAcceptance = resolvePlanAcceptanceForChecklistItem(bucket, normalized);
    const modelAcceptance = resolveModelAcceptanceForChecklistItem(normalized, modelAcceptanceByPlan);
    const persistedMappedStatus = String(persistedAcceptance?.taskStatus || "").trim() ||
      mapModelAcceptanceStatusToTaskStatus(persistedAcceptance?.status);
    const modelMappedStatus = mapModelAcceptanceStatusToTaskStatus(modelAcceptance?.status);
    const baseStatus = evaluateTaskStatus(normalized, state);
    const status = persistedMappedStatus || modelMappedStatus || baseStatus;
    const statusSource = persistedMappedStatus
      ? "plan_acceptance_status"
      : modelMappedStatus
        ? "phase_acceptance_report"
        : "signal";
    return {
      ...normalized,
      status,
      statusSource,
      planAcceptance: persistedAcceptance
        ? {
          acceptanceId: persistedAcceptance.acceptanceId,
          status: persistedAcceptance.status,
          taskStatus: persistedAcceptance.taskStatus,
          risk: persistedAcceptance.risk,
          evidence: persistedAcceptance.evidence,
          conclusion: persistedAcceptance.conclusion,
          source: persistedAcceptance.source,
          acceptedAt: persistedAcceptance.acceptedAt,
          resetAt: persistedAcceptance.resetAt,
          resetReason: persistedAcceptance.resetReason,
        }
        : undefined,
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
    planAcceptanceStatusByPlanId: getPlanAcceptanceStatusMap(bucket),
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
