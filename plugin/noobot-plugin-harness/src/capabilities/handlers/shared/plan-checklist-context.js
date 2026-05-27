/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "./constants.js";
import { parsePlanDocumentFromText, renderPlanDocument } from "./plan-text-protocol.js";

function buildMainPlanTextFromChecklist(checklist = []) {
  const source = Array.isArray(checklist) ? checklist : [];
  if (!source.length) return "";
  const mainSteps = new Map();
  for (const item of source) {
    const mainStepIndex = Number(item?.mainStepIndex);
    const index = Number(item?.index);
    const id = Number.isFinite(mainStepIndex) && mainStepIndex > 0
      ? mainStepIndex
      : Number.isFinite(index) && index > 0
        ? index
        : null;
    const content = String(item?.task || "").trim();
    if (!id || !content || mainSteps.has(id)) continue;
    mainSteps.set(id, content);
  }
  return [...mainSteps.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, content]) => `${id}. ${content}`)
    .join("\n")
    .trim();
}

export function resolvePlanChecklistText({
  planText = "",
  bucket = {},
} = {}) {
  const normalizedPlanText = String(planText || "").trim();
  if (normalizedPlanText) {
    const parsed = parsePlanDocumentFromText(normalizedPlanText);
    const hasNumberedPlans = Array.isArray(parsed?.mainPlans) && parsed.mainPlans.length > 0;
    if (hasNumberedPlans) {
      const rendered = String(renderPlanDocument(parsed) || "").trim();
      if (rendered) return rendered;
    }
    return normalizedPlanText;
  }
  return buildMainPlanTextFromChecklist(bucket?.taskChecklist || []);
}

export function buildPlanChecklistSystemContent({
  locale = LOCALE.ZH_CN,
  planText = "",
  bucket = {},
} = {}) {
  const resolvedPlanText = resolvePlanChecklistText({ planText, bucket });
  if (!resolvedPlanText) return "";
  const header =
    locale === LOCALE.EN_US
      ? "<!-- harness-plan-checklist-context -->\n[Plan Checklist]"
      : "<!-- harness-plan-checklist-context -->\n【计划清单】";
  return `${header}\n${resolvedPlanText}`;
}

export function buildPlanChecklistContextMessages(options = {}) {
  const content = buildPlanChecklistSystemContent(options);
  if (!content) return [];
  return [{ role: "system", content }];
}
