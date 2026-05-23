/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MAX_PLANNING_CAPTURE_ATTEMPTS } from "../../../core/thresholds.js";
import { hasJsonFeature, repairJsonTextByModel } from "../shared/json-repair-utils.js";
import { isHarnessAgentTurnEnded } from "../shared/lifecycle-utils.js";
import {
  buildCapabilityModelMessages,
  CAPABILITY_DOMAIN,
  LOCALE,
  PROMPT_ENVELOPE,
  appendCapabilityLog,
  defaultTaskChecklist,
  ensureHarnessBucket,
  getDefaultTaskOwner,
  getPromptJsonFormatExample,
  parseChecklistWithLocalRepair,
  resolveCapabilityModelName,
  translateI18nText,
} from "./deps.js";
import {
  extractPlanMetadataFromText,
  isPlanPayloadComplete,
} from "../model-response-parser.js";

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

async function repairChecklistByModel({
  invoker = null,
  ctx = {},
  meta = {},
  locale = LOCALE.ZH_CN,
  rawText = "",
  appendCapabilityModelTraceLog = null,
} = {}) {
  if (typeof invoker !== "function") return { parsed: [], repairedText: "" };
  if (isHarnessAgentTurnEnded(ctx)) {
    return { parsed: [], repairedText: "" };
  }
  const content = String(rawText || "").trim();
  if (!content) return { parsed: [], repairedText: "" };
  const repairPrompt = [
    translateI18nText(locale, "planningJsonRepairInstruction"),
    translateI18nText(locale, "planningJsonRepairFormatExample", {
      example: getPromptJsonFormatExample("planning_main"),
    }),
    "",
    content,
  ].join("\n");
  const repairConstraints = [
    translateI18nText(locale, "planningJsonRepairOutputConstraint"),
    translateI18nText(locale, "planningJsonRepairStructureConstraint"),
    translateI18nText(locale, "planningJsonRepairFallbackInstruction"),
  ];

  const repairedText = await repairJsonTextByModel({
    invoker,
    invokePayload: {
      purpose: "planning_json_repair",
      promptVersion: PROMPT_ENVELOPE.VERSION,
      envelopeType: PROMPT_ENVELOPE.TYPE,
      domain: CAPABILITY_DOMAIN.PLANNING,
      model: resolveCapabilityModelName(meta, {
        purpose: "planning_json_repair",
        domain: CAPABILITY_DOMAIN.PLANNING,
      }),
      locale,
      prompt: "",
      messages: buildCapabilityModelMessages({
        locale,
        agentMessages: [],
        constraints: repairConstraints,
        task: repairPrompt,
      }),
      ctx,
      toolAllowlist: [],
    },
    appendModelTrace:
      typeof appendCapabilityModelTraceLog === "function"
        ? async (response) => {
            await appendCapabilityModelTraceLog(ctx, meta, {
              domain: CAPABILITY_DOMAIN.PLANNING,
              purpose: "planning_json_repair",
              response,
            });
          }
        : null,
    onError: (error) => {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_json_repair_model_failed",
        detail: { error: String(error?.message || error || "") },
      });
    },
  });
  return {
    parsed: parseChecklistWithLocalRepair(repairedText, locale),
    repairedText: String(repairedText || ""),
  };
}

async function extractChecklistFromResponse({
  ctx = {},
  meta = {},
  locale = LOCALE.ZH_CN,
  responseText = "",
  invoker = null,
  appendCapabilityModelTraceLog = null,
} = {}) {
  let parsed = parseChecklistWithLocalRepair(responseText, locale);
  let metadataText = String(responseText || "");
  let jsonRepairAttempted = false;
  if (
    !parsed.length &&
    hasJsonFeature(responseText) &&
    typeof invoker === "function" &&
    !isHarnessAgentTurnEnded(ctx)
  ) {
    jsonRepairAttempted = true;
    const repaired = await repairChecklistByModel({
      invoker,
      ctx,
      meta,
      locale,
      rawText: responseText,
      appendCapabilityModelTraceLog,
    });
    parsed = Array.isArray(repaired?.parsed) ? repaired.parsed : [];
    if (parsed.length) {
      metadataText = String(repaired?.repairedText || responseText || "");
    }
  }
  return { parsed, jsonRepairAttempted, metadataText };
}

function applyDefaultPlanningChecklist(ctx = {}, locale = LOCALE.ZH_CN, { reason = "" } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const owner = getDefaultTaskOwner(locale);
  bucket.taskChecklist = defaultTaskChecklist(locale);
  bucket.taskChecklistSource = "default";
  bucket.taskOwner = owner;
  bucket.totalGoal =
    bucket.totalGoal ||
    (locale === LOCALE.EN_US ? "Complete the user request" : "完成用户请求");
  bucket.nextPhase = bucket.nextPhase || {
    objective: locale === LOCALE.EN_US ? "Execute the default plan" : "执行默认计划",
    checklistIndexes: [1],
  };
  state.counters.planningCaptureAttempts = 0;
  state.flags.planningCaptured = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_default_checklist_applied",
    detail: {
      reason: String(reason || "").trim() || "planning_parse_failed",
      checklistCount: bucket.taskChecklist.length,
    },
  });
  return true;
}

function applyPlanningMetadata(bucket = {}, text = "", locale = LOCALE.ZH_CN, { source = "model", summary = "" } = {}) {
  if (!bucket || typeof bucket !== "object") return false;
  const previousMainPlanVersion = Number.isFinite(Number(bucket.mainPlanVersion))
    ? Number(bucket.mainPlanVersion)
    : 0;
  const mainPlanVersion = previousMainPlanVersion > 0 ? previousMainPlanVersion : 1;
  bucket.mainPlanVersion = mainPlanVersion;
  bucket.currentMainPlanVersion = mainPlanVersion;
  const metadata = extractPlanMetadataFromText(text);
  bucket.totalGoal = metadata.totalGoal || bucket.totalGoal || "";
  bucket.taskOwner = metadata.taskOwner || bucket.taskOwner || getDefaultTaskOwner(locale);
  if (metadata.nextPhase?.objective || metadata.nextPhase?.content || metadata.nextPhase?.checklistIndexes?.length) {
    bucket.nextPhase = metadata.nextPhase;
  }
  if (!Array.isArray(bucket.planRevisions)) bucket.planRevisions = [];
  bucket.planRevisions.push({
    source,
    stage: "main_plan",
    mainPlanVersion,
    revisedAt: new Date().toISOString(),
    totalGoal: bucket.totalGoal || "",
    nextPhase: bucket.nextPhase || null,
    summary: String(summary || "").trim() || undefined,
    taskChecklist: Array.isArray(bucket.taskChecklist) ? [...bucket.taskChecklist] : [],
    checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
  });
  if (bucket.planRevisions.length > 20) bucket.planRevisions.splice(0, bucket.planRevisions.length - 20);
  return true;
}

export async function processPlanningResult(
  ctx = {},
  meta = {},
  {
    source = "unknown",
    rawText = "",
    locale = LOCALE.ZH_CN,
    repairInvoker = null,
    appendCapabilityModelTraceLog = null,
  } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) {
    return { captured: false, retryScheduled: false, sourceType: "none", checklistCount: 0 };
  }
  const { bucket, state } = holder;
  const responseText = String(rawText || "");
  const { parsed: extractedChecklist, jsonRepairAttempted, metadataText } = await extractChecklistFromResponse({
    ctx,
    meta,
    locale,
    responseText,
    invoker: repairInvoker,
    appendCapabilityModelTraceLog,
  });
  let parsed = extractedChecklist;

  if (parsed.length && !isPlanPayloadComplete(metadataText, parsed)) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_checklist_incomplete_rejected",
      detail: { reason: "missing_total_goal_or_step_io_files", source },
    });
    parsed = [];
  }

  if (parsed.length) {
    bucket.taskChecklist = parsed;
    bucket.taskChecklistSource = "model";
    state.counters.planningCaptureAttempts = 0;
    state.flags.planningCaptured = true;
    applyPlanningMetadata(bucket, metadataText, locale, { source: "initial_plan" });
    return {
      captured: true,
      retryScheduled: false,
      sourceType: "model",
      checklistCount: parsed.length,
      jsonRepairAttempted,
      emptyResponse: !String(responseText || "").trim(),
      attempts: 0,
    };
  }

  bucket.taskChecklist = [];
  bucket.taskChecklistSource = "none";
  bucket.taskOwner = getDefaultTaskOwner(locale);
  const attempts = increasePlanningCaptureAttempts(state);
  const shouldRetry = !jsonRepairAttempted && attempts < MAX_PLANNING_CAPTURE_ATTEMPTS;
  if (shouldRetry) {
    return {
      captured: false,
      retryScheduled: true,
      sourceType: "none",
      checklistCount: 0,
      jsonRepairAttempted,
      attempts,
      emptyResponse: !String(responseText || "").trim(),
    };
  }

  applyDefaultPlanningChecklist(ctx, locale, {
    reason: jsonRepairAttempted
      ? "planning_json_repair_unusable"
      : "planning_retry_exhausted",
  });
  return {
    captured: true,
    retryScheduled: false,
    sourceType: String(bucket?.taskChecklistSource || "").trim() || "default",
    checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
    jsonRepairAttempted,
    attempts,
    emptyResponse: !String(responseText || "").trim(),
  };
}
