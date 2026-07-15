/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parsePlanDocumentFromText } from "./text-protocol.js";

const MODEL_ACCEPTANCE_LINE_RE = /^\s*(ADD|UPDATE)\s+A([A-Za-z0-9._-]+)\s+(.+?)\s*$/i;

const PLAN_ACCEPTANCE_STATUS = Object.freeze({
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail",
});

export const TASK_ACCEPTANCE_STATUS = Object.freeze({
  COMPLETED: "completed",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
});

function nowIsoTimestamp() {
  return new Date().toISOString();
}

function normalizePlanId(value = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return "";
  const parts = raw.split(".").map((item) => Number(item));
  if (parts.some((item) => !Number.isFinite(item) || item <= 0)) return "";
  return parts.join(".");
}

function normalizeAcceptanceStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === PLAN_ACCEPTANCE_STATUS.PASS) return PLAN_ACCEPTANCE_STATUS.PASS;
  if (normalized === PLAN_ACCEPTANCE_STATUS.WARN) return PLAN_ACCEPTANCE_STATUS.WARN;
  if (normalized === PLAN_ACCEPTANCE_STATUS.FAIL) return PLAN_ACCEPTANCE_STATUS.FAIL;
  return "";
}

export function mapPlanAcceptanceStatusToTaskStatus(status = "") {
  const normalized = normalizeAcceptanceStatus(status);
  if (normalized === PLAN_ACCEPTANCE_STATUS.PASS) return TASK_ACCEPTANCE_STATUS.COMPLETED;
  if (normalized === PLAN_ACCEPTANCE_STATUS.WARN) return TASK_ACCEPTANCE_STATUS.IN_PROGRESS;
  if (normalized === PLAN_ACCEPTANCE_STATUS.FAIL) return TASK_ACCEPTANCE_STATUS.PENDING;
  return "";
}

export function parseAcceptanceItemsFromText(text = "", {
  normalizePlanId: normalizePlanIdValue = normalizePlanId,
  normalizeStatus: normalizeStatusValue = normalizeAcceptanceStatus,
} = {}) {
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
    const planId = normalizePlanIdValue(planMatch?.[1]);
    const status = normalizeStatusValue(statusMatch?.[1]);
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

export function parsePlanAcceptanceItemsFromText(text = "") {
  return parseAcceptanceItemsFromText(text);
}

function flattenPlanDocument(planDocument = {}) {
  const doc = planDocument && typeof planDocument === "object" ? planDocument : {};
  const mainPlans = Array.isArray(doc?.mainPlans) ? doc.mainPlans : [];
  const subPlansByMainId = doc?.subPlansByMainId && typeof doc.subPlansByMainId === "object"
    ? doc.subPlansByMainId
    : {};
  const rows = [];
  for (const main of mainPlans) {
    const mainId = normalizePlanId(main?.id);
    const mainContent = String(main?.content || "").trim();
    if (!mainId || !mainContent) continue;
    rows.push({ planId: mainId, mainId, isMainStep: true, content: mainContent });
    const subPlans = Array.isArray(subPlansByMainId[String(mainId)]) ? subPlansByMainId[String(mainId)] : [];
    for (const sub of subPlans) {
      const subIndex = Number(sub?.subIndex);
      const subId = normalizePlanId(sub?.id || `${mainId}.${subIndex}`);
      const subContent = String(sub?.content || "").trim();
      if (!subId || !subContent) continue;
      rows.push({ planId: subId, mainId, isMainStep: false, content: subContent });
    }
  }
  return rows;
}

function buildPlanContentMapFromText(planText = "") {
  return new Map(
    flattenPlanDocument(parsePlanDocumentFromText(planText))
      .map((item = {}) => [item.planId, item.content]),
  );
}

function ensureStatusMap(bucket = {}) {
  if (!bucket || typeof bucket !== "object") return {};
  if (!bucket.planAcceptanceStatusByPlanId || typeof bucket.planAcceptanceStatusByPlanId !== "object" || Array.isArray(bucket.planAcceptanceStatusByPlanId)) {
    bucket.planAcceptanceStatusByPlanId = {};
  }
  return bucket.planAcceptanceStatusByPlanId;
}

export function getPlanAcceptanceStatusMap(bucket = {}) {
  const source = bucket?.planAcceptanceStatusByPlanId && typeof bucket.planAcceptanceStatusByPlanId === "object"
    ? bucket.planAcceptanceStatusByPlanId
    : {};
  return source;
}

export function applyPhaseAcceptanceReportToPlanStatus(bucket = {}, report = null) {
  if (!bucket || typeof bucket !== "object" || !report) return { applied: false, count: 0 };
  const items = parsePlanAcceptanceItemsFromText(report?.content);
  if (!items.length) return { applied: false, count: 0 };
  const map = ensureStatusMap(bucket);
  const planContentById = buildPlanContentMapFromText(report?.planText || bucket?.planText || "");
  const acceptedAt = String(report?.acceptedAt || "").trim() || nowIsoTimestamp();
  let count = 0;
  for (const item of items) {
    const planId = normalizePlanId(item?.planId);
    if (!planId) continue;
    map[planId] = {
      ...(map[planId] && typeof map[planId] === "object" ? map[planId] : {}),
      planId,
      status: item.status,
      taskStatus: mapPlanAcceptanceStatusToTaskStatus(item.status) || TASK_ACCEPTANCE_STATUS.PENDING,
      risk: item.risk || "",
      evidence: item.evidence || "",
      conclusion: item.conclusion || "",
      acceptanceId: item.acceptanceId || "",
      source: "phase_acceptance",
      acceptedAt,
      resetAt: "",
      resetReason: "",
      planContent: planContentById.get(planId) || String(map[planId]?.planContent || "").trim(),
    };
    count += 1;
  }
  return { applied: count > 0, count };
}

export function resetPlanAcceptanceStatusForPlanChange(bucket = {}, previousPlanText = "", nextPlanText = "", {
  stage = "revision",
  reason = "plan_changed",
} = {}) {
  if (!bucket || typeof bucket !== "object") return { resetCount: 0, removedCount: 0 };
  const map = ensureStatusMap(bucket);
  const keys = Object.keys(map);
  if (!keys.length) return { resetCount: 0, removedCount: 0 };
  const before = buildPlanContentMapFromText(previousPlanText);
  const after = buildPlanContentMapFromText(nextPlanText);
  const resetAt = nowIsoTimestamp();
  let resetCount = 0;
  let removedCount = 0;
  for (const planId of keys) {
    const normalizedPlanId = normalizePlanId(planId);
    if (!normalizedPlanId || !after.has(normalizedPlanId)) {
      delete map[planId];
      removedCount += 1;
      continue;
    }
    const previousContent = before.get(normalizedPlanId) || "";
    const nextContent = after.get(normalizedPlanId) || "";
    if (previousContent && previousContent === nextContent) continue;
    const previous = map[planId] && typeof map[planId] === "object" ? map[planId] : {};
    map[planId] = {
      ...previous,
      planId: normalizedPlanId,
      previousStatus: previous.status || previous.previousStatus || "",
      status: PLAN_ACCEPTANCE_STATUS.FAIL,
      taskStatus: TASK_ACCEPTANCE_STATUS.PENDING,
      source: "plan_change_reset",
      resetAt,
      resetReason: String(reason || "plan_changed").trim() || "plan_changed",
      resetStage: String(stage || "revision").trim() || "revision",
      planContent: nextContent,
    };
    resetCount += 1;
  }
  return { resetCount, removedCount };
}

export function resolvePlanAcceptanceForPlanId(bucket = {}, planId = "") {
  const normalizedPlanId = normalizePlanId(planId);
  if (!normalizedPlanId) return null;
  const map = getPlanAcceptanceStatusMap(bucket);
  return map[normalizedPlanId] && typeof map[normalizedPlanId] === "object" ? map[normalizedPlanId] : null;
}

export function resolvePlanAcceptanceForChecklistItem(bucket = {}, item = {}) {
  const exactId = normalizePlanId(item?.index ?? item?.id);
  if (exactId) {
    const exact = resolvePlanAcceptanceForPlanId(bucket, exactId);
    if (exact) return exact;
  }
  if (item?.isMainStep !== false) return null;
  const parentId = normalizePlanId(item?.mainStepIndex ?? item?.parentIndex);
  if (!parentId) return null;
  return resolvePlanAcceptanceForPlanId(bucket, parentId);
}
