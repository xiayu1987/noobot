/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { parsePlanDocumentFromText, renderPlanDocument } from "./text-protocol.js";
import { getPlanAcceptanceStatusMap } from "./acceptance-status.js";
import { text } from "@noobot/shared/value";

function appendAcceptanceStatusToPlanText(planText = "", bucket = {}) {
  const statusMap = getPlanAcceptanceStatusMap(bucket);
  if (!Object.keys(statusMap).length) return text(planText);
  return String(planText || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const textValue = String(line || "");
      const match = textValue.match(/^\s*(\d+(?:\.\d+)?)(?:\.|\s)\s+(.+?)\s*$/);
      if (!match) return textValue;
      const planId = text(match[1]);
      const acceptance =
        statusMap[planId] && typeof statusMap[planId] === "object" ? statusMap[planId] : null;
      if (!acceptance) return textValue;
      const taskStatus = text(acceptance.taskStatus) || "pending";
      const source = text(acceptance.source);
      const resetSuffix = text(acceptance.resetAt) ? ", reset" : "";
      return `${textValue} [acceptance:${taskStatus}${source ? `, source:${source}` : ""}${resetSuffix}]`;
    })
    .join("\n")
    .trim();
}

function hasRenderablePlanDocument(planDocument = null) {
  const doc = planDocument && typeof planDocument === "object" ? planDocument : null;
  if (!doc) return false;
  return Array.isArray(doc?.mainPlans) && doc.mainPlans.length > 0;
}

export function resolveCurrentTaskGoalText({ bucket = {}, currentTaskGoal = "" } = {}) {
  const explicit = text(currentTaskGoal);
  if (explicit) return explicit;
  return text(bucket?.currentTaskGoal);
}

function prependCurrentTaskGoalToPlanText({
  locale = LOCALE.ZH_CN,
  planText = "",
  currentTaskGoal = "",
} = {}) {
  const goal = text(currentTaskGoal);
  const plan = text(planText);
  if (!goal) return plan;
  const goalHeader = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLAN_CHECKLIST_CURRENT_TASK_GOAL_HEADER,
  );
  const tasksHeader = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLAN_CHECKLIST_TASKS_HEADER,
  );
  return [goalHeader, goal, plan ? "" : "", plan ? tasksHeader : "", plan]
    .filter((item) => String(item || "").length > 0)
    .join("\n")
    .trim();
}

function renderBucketPlanDocument(bucket = {}) {
  return hasRenderablePlanDocument(bucket?.planDocument)
    ? text(renderPlanDocument(bucket.planDocument))
    : "";
}

function renderNumberedPlanText(normalizedPlanText = "") {
  const parsed = parsePlanDocumentFromText(normalizedPlanText);
  const hasNumberedPlans = Array.isArray(parsed?.mainPlans) && parsed.mainPlans.length > 0;
  const rendered = hasNumberedPlans ? text(renderPlanDocument(parsed)) : "";
  return rendered || normalizedPlanText;
}

function resolveChecklistPlanText(planText = "", bucket = {}) {
  const renderedDocument = renderBucketPlanDocument(bucket);
  if (renderedDocument) return renderedDocument;
  const normalizedPlanText = text(planText || bucket?.planText);
  return normalizedPlanText ? renderNumberedPlanText(normalizedPlanText) : "";
}

export function resolveCompletePlanChecklistText({
  planText = "",
  bucket = {},
  currentTaskGoal = "",
  locale = LOCALE.ZH_CN,
} = {}) {
  const taskGoal = resolveCurrentTaskGoalText({ bucket, currentTaskGoal });
  return prependCurrentTaskGoalToPlanText({
    locale,
    planText: resolveChecklistPlanText(planText, bucket),
    currentTaskGoal: taskGoal,
  });
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
