/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { parsePlanDocumentFromText, renderPlanDocument } from "./text-protocol.js";
import { getPlanAcceptanceStatusMap } from "./acceptance-status.js";


function appendAcceptanceStatusToPlanText(planText = "", bucket = {}) {
  const statusMap = getPlanAcceptanceStatusMap(bucket);
  if (!Object.keys(statusMap).length) return String(planText || "").trim();
  return String(planText || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const text = String(line || "");
      const match = text.match(/^\s*(\d+(?:\.\d+)?)(?:\.|\s)\s+(.+?)\s*$/);
      if (!match) return text;
      const planId = String(match[1] || "").trim();
      const acceptance = statusMap[planId] && typeof statusMap[planId] === "object" ? statusMap[planId] : null;
      if (!acceptance) return text;
      const taskStatus = String(acceptance.taskStatus || "").trim() || "pending";
      const source = String(acceptance.source || "").trim();
      const resetSuffix = String(acceptance.resetAt || "").trim() ? ", reset" : "";
      return `${text} [acceptance:${taskStatus}${source ? `, source:${source}` : ""}${resetSuffix}]`;
    })
    .join("\n")
    .trim();
}

function hasRenderablePlanDocument(planDocument = null) {
  const doc = planDocument && typeof planDocument === "object" ? planDocument : null;
  if (!doc) return false;
  return Array.isArray(doc?.mainPlans) && doc.mainPlans.length > 0;
}

function normalizePlanIdText(value = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return "";
  const parts = raw.split(".").map((item) => Number(item));
  if (parts.some((item) => !Number.isFinite(item) || item <= 0)) return "";
  return parts.join(".");
}

function resolveChecklistMainId(item = {}) {
  const mainStepIndex = normalizePlanIdText(item?.mainStepIndex);
  if (mainStepIndex && !mainStepIndex.includes(".")) return mainStepIndex;
  const index = normalizePlanIdText(item?.index ?? item?.id);
  if (!index) return "";
  return index.split(".")[0] || "";
}

function isChecklistMainStep(item = {}) {
  if (item?.isMainStep === true) return true;
  if (item?.isMainStep === false) return false;
  const mainId = resolveChecklistMainId(item);
  const index = normalizePlanIdText(item?.index ?? item?.id);
  if (!mainId || !index) return false;
  return index === mainId;
}

function resolveChecklistSubId(item = {}, mainId = "", allocatedSubIndex = 1) {
  const explicitSubIndex = normalizePlanIdText(item?.subIndex);
  if (explicitSubIndex && !explicitSubIndex.includes(".")) return `${mainId}.${explicitSubIndex}`;
  const index = normalizePlanIdText(item?.index ?? item?.id);
  if (index && index.includes(".") && index.split(".")[0] === String(mainId)) return index;
  return `${mainId}.${allocatedSubIndex}`;
}

function buildCompletePlanTextFromChecklist(checklist = []) {
  const source = Array.isArray(checklist) ? checklist : [];
  if (!source.length) return "";
  const mainSteps = new Map();
  const subStepsByMainId = new Map();
  const allocatedSubCounts = new Map();

  for (const item of source) {
    const content = String(item?.task || "").trim();
    if (!content) continue;
    const mainId = resolveChecklistMainId(item);
    if (!mainId) continue;
    if (isChecklistMainStep(item)) {
      if (!mainSteps.has(mainId)) mainSteps.set(mainId, content);
      continue;
    }

    const nextSubIndex = Number(allocatedSubCounts.get(mainId) || 0) + 1;
    const subId = resolveChecklistSubId(item, mainId, nextSubIndex);
    allocatedSubCounts.set(mainId, nextSubIndex);
    if (!subStepsByMainId.has(mainId)) subStepsByMainId.set(mainId, new Map());
    const subSteps = subStepsByMainId.get(mainId);
    if (!subSteps.has(subId)) subSteps.set(subId, content);
    if (!mainSteps.has(mainId)) {
      const fallbackMainContent = String(item?.mainTask || item?.parentTask || "").trim();
      mainSteps.set(mainId, fallbackMainContent || `main plan ${mainId}`);
    }
  }

  const comparePlanId = (left, right) => {
    const a = String(left || "").split(".").map((item) => Number(item));
    const b = String(right || "").split(".").map((item) => Number(item));
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const delta = Number(a[index] || 0) - Number(b[index] || 0);
      if (delta !== 0) return delta;
    }
    return 0;
  };

  return [...mainSteps.entries()]
    .sort((a, b) => comparePlanId(a[0], b[0]))
    .flatMap(([id, content]) => {
      const lines = [`${id}. ${content}`];
      const subSteps = subStepsByMainId.get(id);
      if (subSteps) {
        for (const [subId, subContent] of [...subSteps.entries()].sort((a, b) => comparePlanId(a[0], b[0]))) {
          lines.push(`${subId} ${subContent}`);
        }
      }
      return lines;
    })
    .join("\n")
    .trim();
}

export function resolveCurrentTaskGoalText({
  bucket = {},
  currentTaskGoal = "",
} = {}) {
  const explicit = String(currentTaskGoal || "").trim();
  if (explicit) return explicit;
  return String(bucket?.currentTaskGoal || "").trim();
}

function prependCurrentTaskGoalToPlanText({
  locale = LOCALE.ZH_CN,
  planText = "",
  currentTaskGoal = "",
} = {}) {
  const goal = String(currentTaskGoal || "").trim();
  const plan = String(planText || "").trim();
  if (!goal) return plan;
  const goalHeader = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLAN_CHECKLIST_CURRENT_TASK_GOAL_HEADER,
  );
  const tasksHeader = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLAN_CHECKLIST_TASKS_HEADER,
  );
  return [
    goalHeader,
    goal,
    plan ? "" : "",
    plan ? tasksHeader : "",
    plan,
  ].filter((item) => String(item || "").length > 0).join("\n").trim();
}

export function resolveCompletePlanChecklistText({
  planText = "",
  bucket = {},
  currentTaskGoal = "",
  locale = LOCALE.ZH_CN,
} = {}) {
  const taskGoal = resolveCurrentTaskGoalText({ bucket, currentTaskGoal });
  const renderedDocument = hasRenderablePlanDocument(bucket?.planDocument)
    ? String(renderPlanDocument(bucket.planDocument) || "").trim()
    : "";
  if (renderedDocument) {
    return prependCurrentTaskGoalToPlanText({ locale, planText: renderedDocument, currentTaskGoal: taskGoal });
  }

  const normalizedPlanText = String(planText || bucket?.planText || "").trim();
  if (normalizedPlanText) {
    const parsed = parsePlanDocumentFromText(normalizedPlanText);
    const hasNumberedPlans = Array.isArray(parsed?.mainPlans) && parsed.mainPlans.length > 0;
    if (hasNumberedPlans) {
      const rendered = String(renderPlanDocument(parsed) || "").trim();
      if (rendered) {
        return prependCurrentTaskGoalToPlanText({ locale, planText: rendered, currentTaskGoal: taskGoal });
      }
    }
    return prependCurrentTaskGoalToPlanText({ locale, planText: normalizedPlanText, currentTaskGoal: taskGoal });
  }
  return prependCurrentTaskGoalToPlanText({
    locale,
    planText: buildCompletePlanTextFromChecklist(bucket?.taskChecklist || []),
    currentTaskGoal: taskGoal,
  });
}

export function resolvePlanChecklistText(options = {}) {
  return resolveCompletePlanChecklistText(options);
}

export function buildPlanChecklistSystemContent({
  locale = LOCALE.ZH_CN,
  planText = "",
  bucket = {},
  currentTaskGoal = "",
} = {}) {
  const resolvedPlanText = appendAcceptanceStatusToPlanText(
    resolveCompletePlanChecklistText({ planText, bucket, currentTaskGoal, locale }),
    bucket,
  );
  if (!resolvedPlanText) return "";
  const header = `<!-- harness-plan-checklist-context -->\n${translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLAN_CHECKLIST_CONTEXT_HEADER,
  )}`;
  return `${header}\n${resolvedPlanText}`;
}

export function buildPlanChecklistContextMessages(options = {}) {
  const content = buildPlanChecklistSystemContent(options);
  if (!content) return [];
  return [{ role: "system", content }];
}
