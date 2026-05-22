/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MAX_PLANNING_CAPTURE_ATTEMPTS } from "../../../core/thresholds.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  defaultTaskChecklist,
  ensureHarnessBucket,
  extractJsonObjectFromText,
  extractRawTextContent,
  getDefaultTaskOwner,
  parseTaskChecklistFromModelOutput,
  resolveCapabilityModelName,
} from "./deps.js";
import {
  extractPlanMetadataFromText,
  isPlanPayloadComplete,
} from "../model-response-parser.js";

const FENCED_BLOCK_RE = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/gi;
const STRIP_FENCED_BLOCK_RE = /```[\s\S]*?```/g;
const TRAILING_COMMA_RE = /,\s*([}\]])/g;

function hasJsonFeature(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return raw.includes("{") || raw.includes("[") || /```(?:json)?/i.test(raw);
}

function sanitizeJsonCandidate(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  FENCED_BLOCK_RE.lastIndex = 0;
  const fencedBlocks = Array.from(raw.matchAll(FENCED_BLOCK_RE));
  const preferredBlock = fencedBlocks
    .map((item) => String(item?.[1] || "").trim())
    .find((block) => block.includes("{") || block.includes("["));
  const fallbackBlock = String(fencedBlocks?.[0]?.[1] || "").trim();
  const source = preferredBlock || fallbackBlock || raw;
  return source
    .replace(/^\s*json\s*/i, "")
    .replace(TRAILING_COMMA_RE, "$1")
    .trim();
}

function parseChecklistFromWrappedPayload(text = "", locale = LOCALE.ZH_CN) {
  const parsed = extractJsonObjectFromText(text);
  if (!parsed || typeof parsed !== "object") return [];

  const visited = new Set();
  const queue = [{ value: parsed, depth: 0 }];
  const candidateKeys = new Set([
    "stdout",
    "stderr",
    "output",
    "content",
    "text",
    "result",
    "data",
    "payload",
    "toolResultText",
    "raw",
    "message",
  ]);

  while (queue.length) {
    const current = queue.shift();
    const value = current?.value;
    const depth = Number(current?.depth || 0);
    if (value === null || value === undefined) continue;
    if (typeof value === "object") {
      if (visited.has(value)) continue;
      visited.add(value);
    }

    if (typeof value === "string") {
      const checklist = parseTaskChecklistFromModelOutput(value, locale);
      if (checklist.length) return checklist;
      if (depth < 3) {
        const nested = extractJsonObjectFromText(value);
        if (nested && typeof nested === "object") {
          queue.push({ value: nested, depth: depth + 1 });
        }
      }
      continue;
    }

    if (Array.isArray(value)) {
      const checklist = parseTaskChecklistFromModelOutput(JSON.stringify(value), locale);
      if (checklist.length) return checklist;
      if (depth < 3) {
        for (const item of value) {
          queue.push({ value: item, depth: depth + 1 });
        }
      }
      continue;
    }

    if (typeof value !== "object") continue;

    const checklist = parseTaskChecklistFromModelOutput(JSON.stringify(value), locale);
    if (checklist.length) return checklist;
    if (depth >= 3) continue;

    for (const [key, nested] of Object.entries(value)) {
      if (candidateKeys.has(String(key || "").trim())) {
        queue.push({ value: nested, depth: depth + 1 });
      } else if (nested && typeof nested === "object") {
        queue.push({ value: nested, depth: depth + 1 });
      }
    }
  }

  return [];
}

function parseChecklistFromPlainText(text = "", locale = LOCALE.ZH_CN) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  STRIP_FENCED_BLOCK_RE.lastIndex = 0;
  const lines = raw
    .replace(STRIP_FENCED_BLOCK_RE, "")
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const matched = [];
  for (const line of lines) {
    const numbered = line.match(/^\s*(\d+)\s*[\.、\)\-:：]\s*(.+)$/);
    const checkbox = line.match(/^\s*[-*+]\s*(?:\[[ xX]\]\s*)?(.+)$/);
    const step = line.match(/^\s*第?\s*(\d+)\s*步\s*[:：]?\s*(.+)$/);
    const detail = (numbered?.[2] || step?.[2] || checkbox?.[1] || "").trim();
    if (!detail) continue;
    matched.push({
      index: Number(numbered?.[1] || step?.[1] || matched.length + 1),
      task: detail,
    });
  }

  if (!matched.length || matched.length < 2) return [];
  const owner = getDefaultTaskOwner(locale);
  return matched.map((item, index) => ({
    index: Number.isFinite(Number(item.index)) ? Number(item.index) : index + 1,
    task: String(item.task || "").trim() || `${locale === LOCALE.EN_US ? "Task" : "任务"} ${index + 1}`,
    owner,
    subOwners: [],
  }));
}

function parseChecklistWithLocalRepair(text = "", locale = LOCALE.ZH_CN) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const parsedDirect = parseTaskChecklistFromModelOutput(raw, locale);
  if (parsedDirect.length) return parsedDirect;
  const sanitized = sanitizeJsonCandidate(raw);
  if (sanitized && sanitized !== raw) {
    const repaired = parseTaskChecklistFromModelOutput(sanitized, locale);
    if (repaired.length) return repaired;
  }
  const wrapped = parseChecklistFromWrappedPayload(raw, locale);
  if (wrapped.length) return wrapped;
  return parseChecklistFromPlainText(raw, locale);
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

async function repairChecklistByModel({
  invoker = null,
  ctx = {},
  meta = {},
  locale = LOCALE.ZH_CN,
  rawText = "",
  appendCapabilityModelTraceLog = null,
} = {}) {
  if (typeof invoker !== "function") return [];
  const content = String(rawText || "").trim();
  if (!content) return [];
  const repairPrompt =
    locale === LOCALE.EN_US
      ? [
          "Repair the following text into strict JSON only.",
          "Output only JSON object or array.",
          'Preferred format: {"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}',
          "If content cannot be repaired into checklist JSON, output {}.",
          "",
          content,
        ].join("\n")
      : [
          "请把以下文本修复为严格 JSON，只输出 JSON。",
          "输出只能是 JSON 对象或数组。",
          '优先格式：{"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}',
          "如果无法修复为清单 JSON，请输出 {}。",
          "",
          content,
        ].join("\n");

  let response = null;
  try {
    response = await invoker({
      purpose: "planning_json_repair",
      domain: CAPABILITY_DOMAIN.PLANNING,
      model: resolveCapabilityModelName(meta, {
        purpose: "planning_json_repair",
        domain: CAPABILITY_DOMAIN.PLANNING,
      }),
      locale,
      prompt: repairPrompt,
      messages: [],
      ctx,
      toolAllowlist: [],
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_json_repair_model_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return [];
  }

  if (typeof appendCapabilityModelTraceLog === "function") {
    await appendCapabilityModelTraceLog(ctx, meta, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      purpose: "planning_json_repair",
      response,
    });
  }

  const repairedText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  return parseChecklistWithLocalRepair(repairedText, locale);
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
  let jsonRepairAttempted = false;
  if (!parsed.length && hasJsonFeature(responseText) && typeof invoker === "function") {
    jsonRepairAttempted = true;
    parsed = await repairChecklistByModel({
      invoker,
      ctx,
      meta,
      locale,
      rawText: responseText,
      appendCapabilityModelTraceLog,
    });
  }
  return { parsed, jsonRepairAttempted };
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
  const { parsed: extractedChecklist, jsonRepairAttempted } = await extractChecklistFromResponse({
    ctx,
    meta,
    locale,
    responseText,
    invoker: repairInvoker,
    appendCapabilityModelTraceLog,
  });
  let parsed = extractedChecklist;

  if (parsed.length && !isPlanPayloadComplete(responseText, parsed)) {
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
    applyPlanningMetadata(bucket, responseText, locale, { source: "initial_plan" });
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
