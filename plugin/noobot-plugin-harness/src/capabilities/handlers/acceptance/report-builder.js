/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ACCEPTANCE_MODE,
  LOCALE,
  buildPlanSnapshot,
  createChecklistItem,
  defaultTaskChecklist,
  translateI18nText,
} from "./deps.js";
import { resolveFirstMatchedRuleResult } from "../shared/rule-table-utils.js";
import { buildStatusSummary, nowIsoTimestamp } from "../shared/report-utils.js";
import { parsePlanDocumentFromText } from "../shared/plan/text-protocol.js";
import { renderAcceptanceReportText } from "./report-text-renderer.js";
import {
  getPlanAcceptanceStatusMap,
  mapPlanAcceptanceStatusToTaskStatus,
  parseAcceptanceItemsFromText,
  parsePlanAcceptanceItemsFromText,
  resolvePlanAcceptanceForChecklistItem,
} from "../shared/plan/acceptance-status.js";
import { text } from "@noobot/shared/value";

const TASK_STATUS = Object.freeze({
  COMPLETED: "completed",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
});

function resolveKeywordSet(i18nKey = "") {
  const values = [LOCALE.ZH_CN, LOCALE.EN_US]
    .map((locale) => translateI18nText(locale, i18nKey))
    .flatMap((line) => String(line || "").split("|"))
    .map((item) => text(item).toLowerCase())
    .filter(Boolean);
  return [...new Set(values)];
}

const ACCEPTANCE_SIGNAL_ATTACHMENT_KEYWORDS = resolveKeywordSet(
  "acceptanceSignalAttachmentKeywords",
);

function includesAnyKeyword(inputText = "", keywords = []) {
  const source = String(inputText || "").toLowerCase();
  return keywords.some((token) => source.includes(token));
}

function parseModelAcceptanceItemsFromText(sourceText = "") {
  return parseAcceptanceItemsFromText(sourceText, {
    normalizePlanId: (value = "") => text(value),
    normalizeStatus: (value = "") => text(value).toLowerCase(),
  });
}

function parseSemanticAcceptanceItemsFromText(inputText = "") {
  return parsePlanAcceptanceItemsFromText(inputText);
}

function mapModelAcceptanceStatusToTaskStatus(status = "") {
  const normalized = text(status).toLowerCase();
  return mapPlanAcceptanceStatusToTaskStatus(normalized);
}

function resolveAcceptanceStatusForChecklistItem(item = {}, byPlan = {}) {
  const map = byPlan && typeof byPlan === "object" ? byPlan : {};
  const exactKey = text(item?.index);
  if (exactKey && map[exactKey]) return map[exactKey];
  const isMainStep = item?.isMainStep !== false;
  if (isMainStep) return null;
  const parentKey = text(item?.mainStepIndex);
  if (parentKey && map[parentKey]) return map[parentKey];
  return null;
}

function resolveLatestModelAcceptance(bucket = {}) {
  const reports = Array.isArray(bucket?.phaseAcceptanceReports)
    ? bucket.phaseAcceptanceReports
    : [];
  const latest = reports.length ? reports[reports.length - 1] : null;
  const content = text(latest?.content);
  const items = parseModelAcceptanceItemsFromText(content);
  const byPlan = {};
  for (const item of items) {
    const key = text(item?.planId);
    if (!key) continue;
    byPlan[key] = item;
  }
  return {
    source: latest ? "phase_acceptance" : "",
    acceptedAt: text(latest?.acceptedAt),
    rawContent: content,
    items,
    byPlan,
  };
}

const ACCEPTANCE_TASK_STATUS_RULES = Object.freeze([
  {
    matches: ({ text: inputText = "" } = {}) =>
      includesAnyKeyword(inputText, ACCEPTANCE_SIGNAL_ATTACHMENT_KEYWORDS),
    resolve: ({ signals = {} } = {}) =>
      signals.parsedAttachment ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING,
  },
]);

function evaluateTaskStatus(task = {}, state = {}) {
  const inputText = String(task?.task || "").toLowerCase();
  const signals = state?.signals || {};
  return resolveFirstMatchedRuleResult(
    ACCEPTANCE_TASK_STATUS_RULES,
    { signals, task, state, text: inputText },
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

function buildAcceptanceValidationState(report = null) {
  const source = report && typeof report === "object" ? report : null;
  if (!source) return null;
  return {
    mode: text(source.mode),
    forcedReason: text(source.forcedReason),
    acceptedAt: text(source.acceptedAt),
    summary: source.summary && typeof source.summary === "object" ? source.summary : {},
    planAcceptanceStatusByPlanId:
      source.planAcceptanceStatusByPlanId && typeof source.planAcceptanceStatusByPlanId === "object"
        ? source.planAcceptanceStatusByPlanId
        : {},
  };
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
    const mainTask = text(main?.content);
    if (!Number.isFinite(mainId) || !mainTask) continue;
    checklist.push(createChecklistItem({ mainId, task: mainTask }));
    const subPlans = Array.isArray(subPlansByMainId[String(mainId)])
      ? subPlansByMainId[String(mainId)]
      : [];
    for (const sub of subPlans) {
      const subIndex = Number(sub?.subIndex);
      const subTask = text(sub?.content);
      if (!Number.isFinite(subIndex) || !subTask) continue;
      checklist.push(createChecklistItem({ mainId, subIndex, task: subTask }));
    }
  }
  return checklist;
}

export function buildAcceptanceReport({
  bucket = {},
  state = {},
  ctx = {},
  mode = ACCEPTANCE_MODE.ACTIVE,
  forcedReason = "",
} = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  const planText = text(bucket?.planText);
  const parsedPlan = parsePlanDocumentFromText(planText);
  const checklistFromPlanText = buildChecklistFromParsedPlan(parsedPlan);
  const checklist = checklistFromPlanText.length
    ? checklistFromPlanText
    : defaultTaskChecklist(locale);
  const latestModelAcceptance = resolveLatestModelAcceptance(bucket);
  const modelAcceptanceByPlan =
    latestModelAcceptance?.byPlan && typeof latestModelAcceptance.byPlan === "object"
      ? latestModelAcceptance.byPlan
      : {};
  const items = checklist.map((item) => {
    const persistedAcceptance = resolvePlanAcceptanceForChecklistItem(bucket, item);
    const modelAcceptance = resolveAcceptanceStatusForChecklistItem(item, modelAcceptanceByPlan);
    const persistedMappedStatus =
      text(persistedAcceptance?.taskStatus) ||
      mapModelAcceptanceStatusToTaskStatus(persistedAcceptance?.status);
    const modelMappedStatus = mapModelAcceptanceStatusToTaskStatus(modelAcceptance?.status);
    const baseStatus = evaluateTaskStatus(item, state);
    const status = persistedMappedStatus || modelMappedStatus || baseStatus;
    const statusSource = persistedMappedStatus
      ? "plan_acceptance_status"
      : modelMappedStatus
        ? "phase_acceptance_report"
        : "signal";
    return {
      ...item,
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
  const normalizedForcedReason = text(forcedReason);
  return {
    mode,
    forcedReason: mode === ACCEPTANCE_MODE.FORCED ? normalizedForcedReason : "",
    acceptedAt: nowIsoTimestamp(),
    planText,
    summary: buildAcceptanceSummary(items),
    finalPlanChecklist: items,
    plan,
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

export function applySemanticAcceptanceToReport(report = {}) {
  const data = report && typeof report === "object" ? report : null;
  if (!data) return false;
  const semanticValidation =
    data.semanticValidation && typeof data.semanticValidation === "object"
      ? data.semanticValidation
      : null;
  const semanticRaw = text(semanticValidation?.content);
  if (!semanticRaw) return false;
  const semanticItems = parseSemanticAcceptanceItemsFromText(semanticRaw);
  if (!semanticItems.length) return false;
  const semanticByPlan = {};
  for (const item of semanticItems) {
    const key = text(item?.planId);
    if (!key) continue;
    semanticByPlan[key] = item;
  }
  if (!Object.keys(semanticByPlan).length) return false;

  const checklist = Array.isArray(data.finalPlanChecklist) ? data.finalPlanChecklist : [];
  if (!checklist.length) return false;

  const nextChecklist = checklist.map((item = {}) => {
    const semanticAcceptance = resolveAcceptanceStatusForChecklistItem(item, semanticByPlan);
    const semanticMappedStatus = mapModelAcceptanceStatusToTaskStatus(semanticAcceptance?.status);
    const phaseMappedStatus = mapModelAcceptanceStatusToTaskStatus(item?.modelAcceptance?.status);
    const phaseStatus = text(item?.phaseStatus) || phaseMappedStatus || "";
    const fallbackStatus = text(item?.status) || "pending";
    const effectiveStatus = semanticMappedStatus || phaseStatus || fallbackStatus;
    const statusSource = semanticMappedStatus ? "semantic" : phaseStatus ? "phase" : "signal";
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
  data.summary = buildAcceptanceSummary(nextChecklist);
  data.semanticAcceptance = {
    source: "acceptance_semantic_validation",
    acceptedAt: text(data?.acceptedAt),
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
} = {}) {
  const planText = text(bucket?.planText);
  return {
    expectedSchema: {
      status: "pass|warn|fail",
      consistent: true,
      missingItems: [],
      unsupportedClaims: [],
      checklistCoverage: planText
        ? []
        : [{ index: 1, task: "...", covered: true, evidence: "...", risk: "low|medium|high" }],
      suggestions: [],
    },
    planText,
    acceptanceState: buildAcceptanceValidationState(baseReport),
    toolSignals: state.signals || {},
    finalOutput,
  };
}

export { renderAcceptanceReportText };
