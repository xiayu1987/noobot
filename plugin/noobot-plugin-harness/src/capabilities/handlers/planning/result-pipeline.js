/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  canAttemptPlanUpdate,
  ensureHarnessBucket,
  getDefaultTaskOwner,
  setPendingPlanUpdate,
} from "./deps.js";
import {
  parseMainPlansFromPlanText,
  parsePlanDocumentFromText,
  renderPlanDocument,
} from "../shared/plan/text-protocol.js";

const PLANNING_EVENTS = WORKFLOW_PARAMS.logging.events.planning;
const MAX_PLANNING_CAPTURE_ATTEMPTS = WORKFLOW_PARAMS.planning.capture.maxAttempts;

function extractChangedMainStepIndexes(previousDocument = {}, nextDocument = {}) {
  const previousMainPlans = Array.isArray(previousDocument?.mainPlans) ? previousDocument.mainPlans : [];
  const nextMainPlans = Array.isArray(nextDocument?.mainPlans) ? nextDocument.mainPlans : [];
  const previousMap = new Map(
    previousMainPlans
      .map((item = {}) => [Number(item.id), String(item.content || "").trim()])
      .filter(([id, content]) => Number.isFinite(id) && id > 0 && content),
  );
  const nextMap = new Map(
    nextMainPlans
      .map((item = {}) => [Number(item.id), String(item.content || "").trim()])
      .filter(([id, content]) => Number.isFinite(id) && id > 0 && content),
  );
  const changed = new Set();
  for (const id of previousMap.keys()) {
    if (!nextMap.has(id)) changed.add(id);
  }
  for (const [id, content] of nextMap.entries()) {
    if (!previousMap.has(id) || previousMap.get(id) !== content) changed.add(id);
  }
  return [...changed].sort((a, b) => a - b);
}

function increasePlanningCaptureAttempts(state = {}) {
  if (!state || typeof state !== "object") return 1;
  const counters = state.counters && typeof state.counters === "object" ? state.counters : {};
  const current = Number.isFinite(Number(counters.planningCaptureAttempts))
    ? Number(counters.planningCaptureAttempts)
    : 0;
  const next = current + 1;
  counters.planningCaptureAttempts = next;
  state.counters = counters;
  return next;
}

function applyPlanText(ctx = {}, bucket = {}, state = {}, rawText = "", source = "unknown", summary = "") {
  const normalized = String(rawText || "").trim();
  if (!normalized) return false;
  const previousDocument = parsePlanDocumentFromText(bucket.planText);
  const parsed = parsePlanDocumentFromText(normalized);
  bucket.planDocument = parsed;
  bucket.planText = renderPlanDocument(parsed) || normalized;
  bucket.lastRevisionChangedMainStepIndexes = extractChangedMainStepIndexes(previousDocument, parsed);
  bucket.taskChecklist = [];
  bucket.taskChecklistSource = "plan_text";
  bucket.taskOwner = bucket.taskOwner || getDefaultTaskOwner(state?.locale || LOCALE.ZH_CN);
  bucket.globalRevisionCount = Number.isFinite(Number(bucket.globalRevisionCount))
    ? Number(bucket.globalRevisionCount)
    : 0;
  if (!Array.isArray(bucket.planRevisions)) bucket.planRevisions = [];
  bucket.planRevisions.push({
    source,
    stage: "main_plan",
    revisedAt: new Date().toISOString(),
    summary: String(summary || "").trim() || undefined,
    planText: bucket.planText,
    checklistCount: parseMainPlansFromPlanText(bucket.planText).length,
  });
  if (bucket.planRevisions.length > 20) {
    bucket.planRevisions.splice(0, bucket.planRevisions.length - 20);
  }
  state.counters.planningCaptureAttempts = 0;
  state.flags.planningCaptured = true;
  const changedMainStepIndexes = Array.isArray(bucket.lastRevisionChangedMainStepIndexes)
    ? bucket.lastRevisionChangedMainStepIndexes
    : [];
  if (
    changedMainStepIndexes.length &&
    canAttemptPlanUpdate(ctx, state, { increment: false, stage: "refinement" })
  ) {
    setPendingPlanUpdate(state, {
      active: true,
      stage: "refinement",
      summaryText: "",
      targetMainStepIndexes: changedMainStepIndexes,
    });
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: PLANNING_EVENTS.checklistCaptured,
      detail: {
        stage: "main_plan",
        refinementScheduled: true,
        refinementTargetMainStepIndexes: changedMainStepIndexes,
      },
    });
  }
  return true;
}

function applyDefaultPlanText(ctx = {}, locale = LOCALE.ZH_CN, reason = "") {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const fallbackText = locale === LOCALE.EN_US
    ? "1. Clarify requirements and constraints\n2. Implement and verify core changes\n3. Final acceptance and delivery"
    : "1. 需求澄清与约束确认\n2. 实施并验证核心改动\n3. 最终验收与交付";
  const applied = applyPlanText(ctx, bucket, state, fallbackText, "default_plan_text");
  if (!applied) return false;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: PLANNING_EVENTS.defaultChecklistApplied,
    detail: { reason: String(reason || "").trim() || "planning_empty_response" },
  });
  return true;
}

export async function processPlanningResult(
  ctx = {},
  _meta = {},
  {
    source = "unknown",
    rawText = "",
    locale = LOCALE.ZH_CN,
  } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) {
    return { captured: false, retryScheduled: false, sourceType: "none", checklistCount: 0 };
  }
  const { bucket, state } = holder;
  const responseText = String(rawText || "").trim();
  if (responseText) {
    applyPlanText(ctx, bucket, state, responseText, source);
    return {
      captured: true,
      retryScheduled: false,
      sourceType: "plan_text",
      checklistCount: parseMainPlansFromPlanText(bucket.planText).length,
      attempts: 0,
      emptyResponse: false,
      jsonRepairAttempted: false,
    };
  }

  const attempts = increasePlanningCaptureAttempts(state);
  const shouldRetry = attempts < MAX_PLANNING_CAPTURE_ATTEMPTS;
  if (shouldRetry) {
    return {
      captured: false,
      retryScheduled: true,
      sourceType: "none",
      checklistCount: 0,
      attempts,
      emptyResponse: true,
      jsonRepairAttempted: false,
    };
  }

  applyDefaultPlanText(ctx, locale, "planning_retry_exhausted");
  return {
    captured: true,
    retryScheduled: false,
    sourceType: "default",
    checklistCount: parseMainPlansFromPlanText(bucket.planText).length,
    attempts,
    emptyResponse: true,
    jsonRepairAttempted: false,
  };
}
