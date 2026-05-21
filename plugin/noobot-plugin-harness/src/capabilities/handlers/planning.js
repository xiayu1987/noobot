/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureTaskAcceptanceTool } from "./acceptance.js";
import {
  CAPABILITY_DOMAIN,
  LLM_SUMMARY_THRESHOLD,
  LOCALE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  defaultTaskChecklist,
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  extractJsonObjectFromText,
  extractRawTextContent,
  getDefaultTaskOwner,
  getTaskTemplate,
  parseTaskChecklistFromModelOutput,
  relaySeparateModelOutputAsUserMessage,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelName,
  resolveCapabilityModelMessages,
  resolvePlanningToolAllowlist,
  resolveSceneToolNames,
  sanitizeInternalMessages,
  shouldUseSeparateModel,
  translateI18nText,
} from "./shared.js";
import {
  extractPlanMetadataFromText,
  isPlanPayloadComplete,
} from "./model-response-parser.js";

function resolvePlanningToolCatalog(ctx = {}, locale = LOCALE.ZH_CN) {
  const registry = Array.isArray(ctx?.agentContext?.payload?.tools?.registry)
    ? ctx.agentContext.payload.tools.registry
    : [];
  const fallbackDescription = locale === LOCALE.EN_US ? "(no description)" : "（无说明）";
  const catalog = [];
  const seenNames = new Set();
  for (const toolItem of registry) {
    const name = String(toolItem?.name || "").trim();
    if (!name || seenNames.has(name)) continue;
    const description = String(toolItem?.description || "")
      .replace(/\s+/g, " ")
      .trim();
    catalog.push({
      name,
      description: description || fallbackDescription,
    });
    seenNames.add(name);
  }
  return catalog;
}

function buildPlanningToolCatalogPrompt(ctx = {}, locale = LOCALE.ZH_CN) {
  const catalog = resolvePlanningToolCatalog(ctx, locale);
  return [
    translateI18nText(locale, "planningPromptToolsHeader"),
    "```json",
    JSON.stringify(catalog, null, 2),
    "```",
  ].join("\n");
}

function maybeInjectPlanningPrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  if (state.flags.planningPromptInjected === true) return false;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  messages.unshift({
    role: "system",
    content: [
      translateI18nText(locale, "planningPromptMarker"),
      translateI18nText(locale, "planningPromptLine1"),
      translateI18nText(locale, "planningPromptLine2", {
        example: `{"totalGoal":"完成用户请求","taskOwner":"${getDefaultTaskOwner(locale)}","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"${getTaskTemplate(locale).PARSE_ATTACHMENT}","owner":"${getDefaultTaskOwner(locale)}","input":"用户请求/上下文/附件","output":"可用于后续步骤的解析结果","files":{"create":[],"modify":[],"delete":[]}}]}`,
      }),
      translateI18nText(locale, "planningPromptLine3"),
      translateI18nText(locale, "planningPromptLine4"),
      buildPlanningToolCatalogPrompt(ctx, locale),
    ].join("\n"),
  });
  state.flags.planningPromptInjected = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_prompt_injected",
  });
  return true;
}

function hasJsonFeature(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return raw.includes("{") || raw.includes("[") || /```(?:json)?/i.test(raw);
}

function sanitizeJsonCandidate(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const fencedBlocks = Array.from(raw.matchAll(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/gi));
  const preferredBlock = fencedBlocks
    .map((item) => String(item?.[1] || "").trim())
    .find((block) => block.includes("{") || block.includes("["));
  const fallbackBlock = String(fencedBlocks?.[0]?.[1] || "").trim();
  const source = preferredBlock || fallbackBlock || raw;
  return source
    .replace(/^\s*json\s*/i, "")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
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

function applyPlanningMetadata(bucket = {}, text = "", locale = LOCALE.ZH_CN, { source = "model", summary = "" } = {}) {
  if (!bucket || typeof bucket !== "object") return false;
  const metadata = extractPlanMetadataFromText(text);
  bucket.totalGoal = metadata.totalGoal || bucket.totalGoal || "";
  bucket.taskOwner = metadata.taskOwner || bucket.taskOwner || getDefaultTaskOwner(locale);
  if (metadata.nextPhase?.objective || metadata.nextPhase?.content || metadata.nextPhase?.checklistIndexes?.length) {
    bucket.nextPhase = metadata.nextPhase;
  }
  if (!Array.isArray(bucket.planRevisions)) bucket.planRevisions = [];
  bucket.planRevisions.push({
    source,
    revisedAt: new Date().toISOString(),
    totalGoal: bucket.totalGoal || "",
    nextPhase: bucket.nextPhase || null,
    summary: String(summary || "").trim() || undefined,
    checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
  });
  if (bucket.planRevisions.length > 20) bucket.planRevisions.splice(0, bucket.planRevisions.length - 20);
  return true;
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
  const lines = raw
    .replace(/```[\s\S]*?```/g, "")
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

const MAX_PLANNING_CAPTURE_ATTEMPTS = 3;

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

function compactText(text = "", maxChars = 500) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}...`;
}

function recordPlanningRawOutput(
  ctx = {},
  { source = "unknown", content = "", parsedCount = 0 } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket } = holder;
  const rawText = String(content || "");
  const entry = {
    source: String(source || "unknown").trim() || "unknown",
    capturedAt: new Date().toISOString(),
    content: rawText,
    parsedCount: Number.isFinite(Number(parsedCount)) ? Number(parsedCount) : 0,
  };
  if (!Array.isArray(bucket.planningRawOutputs)) {
    bucket.planningRawOutputs = [];
  }
  bucket.planningRawOutputs.push(entry);
  if (bucket.planningRawOutputs.length > 20) {
    bucket.planningRawOutputs.splice(0, bucket.planningRawOutputs.length - 20);
  }
  bucket.lastPlanningRawOutput = entry;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_raw_output_recorded",
    detail: {
      source: entry.source,
      chars: rawText.length,
      parsedCount: entry.parsedCount,
      preview: compactText(rawText, 300),
    },
  });
  return true;
}

function normalizePlanningTextContent(content = "") {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.text === "string") return item.text;
      return "";
    })
    .join("\n")
    .trim();
}

function collectAgentStyleHistoryMessages(ctx = {}) {
  const history = Array.isArray(ctx?.agentContext?.payload?.messages?.history)
    ? ctx.agentContext.payload.messages.history
    : [];
  if (!history.length) return Array.isArray(ctx?.messages) ? ctx.messages : [];

  const knownToolCallIds = new Set();
  for (const msg of history) {
    if (msg?.summarized === true) continue;
    if (String(msg?.role || "").trim().toLowerCase() !== "assistant") continue;
    const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    for (const call of calls) {
      const id = String(call?.id || call?.tool_call_id || call?.toolCallId || "").trim();
      if (id) knownToolCallIds.add(id);
    }
  }

  return history
    .filter((msg) => msg?.summarized !== true)
    .filter((msg) => {
      const role = String(msg?.role || "").trim().toLowerCase();
      if (!role) return false;
      if (role !== "tool") return true;
      const toolCallId = String(msg?.tool_call_id || "").trim();
      return !toolCallId || knownToolCallIds.has(toolCallId);
    })
    .map((msg = {}) => {
      const role = String(msg?.role || "").trim().toLowerCase();
      const assistantRaw =
        typeof msg?.rawModelContent === "string" || Array.isArray(msg?.rawModelContent)
          ? msg.rawModelContent
          : msg?.content;
      const content =
        role === "assistant"
          ? normalizePlanningTextContent(assistantRaw)
          : normalizePlanningTextContent(msg?.content);
      return { role, content };
    })
    .filter((msg) => msg.content);
}

function summarizePlanningMessages(messages = [], maxItems = 8) {
  const source = Array.isArray(messages) ? messages : [];
  const simplified = source
    .filter((item) => {
      const role = String(item?.role || "").trim().toLowerCase();
      return role === "user" || role === "assistant" || role === "tool" || role === "system";
    })
    .slice(-maxItems)
    .map((item = {}) => ({
      role: String(item?.role || "").trim(),
      content: compactText(extractRawTextContent(item?.content ?? item), 500),
    }))
    .filter((item) => item.content);
  return simplified;
}

function buildPlanningContextSummary(ctx = {}, meta = {}, locale = LOCALE.ZH_CN) {
  const messages = collectAgentStyleHistoryMessages(ctx);
  const latestUserMessage = [...messages]
    .reverse()
    .find((item) => String(item?.role || "").trim().toLowerCase() === "user");
  return {
    locale,
    turn: Number.isFinite(Number(ctx?.turn)) ? Number(ctx.turn) : undefined,
    latestUserGoal: compactText(extractRawTextContent(latestUserMessage?.content), 800),
    recentDialog: summarizePlanningMessages(messages, 8),
    sceneTools: resolveSceneToolNames(ctx),
    toolAllowlist: resolvePlanningToolAllowlist(meta),
  };
}

async function repairChecklistByModel({
  invoker = null,
  ctx = {},
  meta = {},
  locale = LOCALE.ZH_CN,
  rawText = "",
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
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    purpose: "planning_json_repair",
    response,
  });
  const repairedText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  return parseChecklistWithLocalRepair(repairedText, locale);
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

function enablePlanningForceToolRetry(ctx = {}) {
  void ctx;
  return false;
}

function restorePlanningForceToolRetry(ctx = {}) {
  // Keep tool choice in auto mode for planning; no restore path.
  void ctx;
  return true;
}

async function runPlanningBySeparateModel(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.planningCaptured === true) return false;
  if (state.flags.planningSeparateModelInFlight === true) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_separate_model_skipped_inflight",
    });
    return false;
  }
  if (
    String(bucket?.taskChecklistSource || "").trim().toLowerCase() === "model" &&
    Array.isArray(bucket?.taskChecklist) &&
    bucket.taskChecklist.length
  ) {
    state.flags.planningCaptured = true;
    return false;
  }
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  state.flags.planningSeparateModelInFlight = true;
  const locale = state?.locale || LOCALE.ZH_CN;
  const planningMessages = [
    ...resolveCapabilityModelMessages(meta, {
      ctx,
      purpose: "planning",
      messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
    }),
  ];
  const contextSummary = buildPlanningContextSummary(ctx, meta, locale);
  planningMessages.unshift({
    role: "system",
    content:
      locale === LOCALE.EN_US
        ? `Planning context summary (compact). Must be fully considered:\n\`\`\`json\n${JSON.stringify(contextSummary, null, 2)}\n\`\`\``
        : `规划输入上下文摘要（精简）如下，必须完整参考：\n\`\`\`json\n${JSON.stringify(contextSummary, null, 2)}\n\`\`\``,
  });
  const planningPromptBase = [
    translateI18nText(locale, "planningPromptLine1"),
    translateI18nText(locale, "planningPromptLine2", {
      example: `{"totalGoal":"完成用户请求","taskOwner":"${getDefaultTaskOwner(locale)}","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"${getTaskTemplate(locale).PARSE_ATTACHMENT}","owner":"${getDefaultTaskOwner(locale)}","input":"用户请求/上下文/附件","output":"可用于后续步骤的解析结果","files":{"create":[],"modify":[],"delete":[]}}]}`,
    }),
    translateI18nText(locale, "planningPromptLine3"),
    translateI18nText(locale, "planningPromptLine4"),
    buildPlanningToolCatalogPrompt(ctx, locale),
    "",
    JSON.stringify(
      {
        sceneTools: resolveSceneToolNames(ctx),
        toolAllowlist: resolvePlanningToolAllowlist(meta),
      },
      null,
      2,
    ),
  ].join("\n");
  try {
    let response = null;
    try {
      response = await invoker({
        purpose: "planning",
        domain: CAPABILITY_DOMAIN.PLANNING,
        model: resolveCapabilityModelName(meta, {
          purpose: "planning",
          domain: CAPABILITY_DOMAIN.PLANNING,
        }),
        locale,
        prompt: planningPromptBase,
        messages: planningMessages,
        ctx,
        toolAllowlist: resolvePlanningToolAllowlist(meta),
      });
    } catch (error) {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_separate_model_call_failed",
        detail: { error: String(error?.message || error || "") },
      });
      return false;
    }
    await appendCapabilityModelTraceLog(ctx, meta, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      purpose: "planning",
      response,
    });
    const responseText =
      extractRawTextContent(response?.content) ||
      String(response?.text || response?.output || "").trim();
    recordPlanningRawOutput(ctx, {
      source: "separate_model",
      content: responseText,
    });
    let parsed = parseChecklistWithLocalRepair(responseText, locale);
    let jsonRepairAttempted = false;
    if (!parsed.length && hasJsonFeature(responseText)) {
      jsonRepairAttempted = true;
      parsed = await repairChecklistByModel({
        invoker,
        ctx,
        meta,
        locale,
        rawText: responseText,
      });
    }
    if (parsed.length) {
      if (!isPlanPayloadComplete(responseText, parsed)) {
        appendCapabilityLog(ctx, {
          domain: CAPABILITY_DOMAIN.PLANNING,
          event: "planning_checklist_incomplete_rejected",
          detail: { reason: "missing_total_goal_or_step_io_files", source: "separate_model" },
        });
        parsed = [];
      }
    }

    if (parsed.length) {
      bucket.taskChecklist = parsed;
      bucket.taskChecklistSource = "model";
      state.counters.planningCaptureAttempts = 0;
      state.flags.planningCaptured = true;
    } else {
      bucket.taskChecklist = [];
      bucket.taskChecklistSource = "none";
      bucket.taskOwner = getDefaultTaskOwner(locale);
      const attempts = increasePlanningCaptureAttempts(state);
      if (!jsonRepairAttempted && attempts < MAX_PLANNING_CAPTURE_ATTEMPTS) {
        relaySeparateModelOutputAsUserMessage(ctx, {
          locale,
          purpose: "planning",
          content: responseText || (locale === LOCALE.EN_US ? "None" : "无"),
          dedupe: true,
        });
        appendCapabilityLog(ctx, {
          domain: CAPABILITY_DOMAIN.PLANNING,
          event: "planning_checklist_retry_scheduled_by_separate_model",
          detail: { attempts, maxAttempts: MAX_PLANNING_CAPTURE_ATTEMPTS },
        });
        return true;
      }
      applyDefaultPlanningChecklist(ctx, locale, {
        reason: jsonRepairAttempted
          ? "planning_json_repair_unusable"
          : "planning_retry_exhausted",
      });
    }
    applyPlanningMetadata(bucket, responseText, locale, { source: "initial_plan" });
    relaySeparateModelOutputAsUserMessage(ctx, {
      locale,
      purpose: "planning",
      content: responseText || (locale === LOCALE.EN_US ? "None" : "无"),
      dedupe: true,
    });
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_checklist_captured_by_separate_model",
      detail: {
        checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
        source: String(bucket?.taskChecklistSource || "").trim() || (parsed.length ? "model" : "default"),
        emptyResponse: !String(responseText || "").trim(),
      },
    });
    return true;
  } finally {
    state.flags.planningSeparateModelInFlight = false;
  }
}

async function maybeCapturePlanningResult(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.planningCaptured === true) return false;
  if (state.flags.planningPromptInjected !== true) return false;
  const sourceContent =
    extractRawTextContent(ctx?.ai?.content) ||
    extractRawTextContent(ctx?.modelResponse?.content) ||
    "";
  const hasToolCalls =
    Array.isArray(ctx?.ai?.tool_calls) ||
    Array.isArray(ctx?.ai?.toolCalls) ||
    Array.isArray(ctx?.modelResponse?.tool_calls) ||
    Array.isArray(ctx?.modelResponse?.toolCalls) ||
    String(ctx?.modelResponse?.finish_reason || "").trim() === "tool_calls";
  if (hasToolCalls && !String(sourceContent || "").trim()) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_capture_skipped_for_tool_call_turn",
    });
    return false;
  }
  recordPlanningRawOutput(ctx, {
    source: "after_llm_call",
    content: sourceContent,
  });
  const locale = state?.locale || LOCALE.ZH_CN;
  let parsed = parseChecklistWithLocalRepair(sourceContent, locale);
  let jsonRepairAttempted = false;
  const repairInvoker = resolveCapabilityModelInvoker(meta);
  if (!parsed.length && hasJsonFeature(sourceContent) && typeof repairInvoker === "function") {
    jsonRepairAttempted = true;
    parsed = await repairChecklistByModel({
      invoker: repairInvoker,
      ctx,
      meta,
      locale,
      rawText: sourceContent,
    });
  }
  if (parsed.length) {
    if (!isPlanPayloadComplete(sourceContent, parsed)) {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_checklist_incomplete_rejected",
        detail: { reason: "missing_total_goal_or_step_io_files", source: "after_llm_call" },
      });
      parsed = [];
    }
  }

  if (parsed.length) {
    bucket.taskChecklist = parsed;
    bucket.taskChecklistSource = "model";
    applyPlanningMetadata(bucket, sourceContent, locale, { source: "initial_plan" });
    state.counters.planningCaptureAttempts = 0;
    state.flags.planningCaptured = true;
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_checklist_captured",
      detail: {
        checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
        source: "model",
      },
    });
    return true;
  }
  bucket.taskChecklist = [];
  bucket.taskChecklistSource = "none";
  bucket.taskOwner = getDefaultTaskOwner(locale);
  const attempts = increasePlanningCaptureAttempts(state);
  if (!jsonRepairAttempted && attempts < MAX_PLANNING_CAPTURE_ATTEMPTS) {
    state.flags.planningPromptInjected = false;
    enablePlanningForceToolRetry(ctx);
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_checklist_retry_scheduled",
      detail: {
        attempts,
        maxAttempts: MAX_PLANNING_CAPTURE_ATTEMPTS,
        emptyResponse: !String(sourceContent || "").trim(),
      },
    });
    return true;
  }
  applyDefaultPlanningChecklist(ctx, locale, {
    reason: jsonRepairAttempted
      ? "planning_json_repair_unusable"
      : "planning_retry_exhausted",
  });
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_checklist_captured",
    detail: {
      checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
      source: String(bucket?.taskChecklistSource || "").trim() || "default",
      emptyResponse: !String(sourceContent || "").trim(),
    },
  });
  return true;
}

export function createPlanningHandler({ shouldProcessPrimaryToolHooks = () => true } = {}) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (
      ["before_llm_call", "after_llm_call", "before_final_output"].includes(point) &&
      !shouldProcessPrimaryToolHooks(ctx)
    ) {
      return { capability, point, status: "active", changed: false };
    }
    if (point === "before_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      if (holder) {
        holder.state.counters.llmTurns += 1;
        if (holder.state.counters.llmTurns > LLM_SUMMARY_THRESHOLD) {
          holder.state.pending.summary = true;
        }
      }
      changed = enablePlanningForceToolRetry(ctx) || changed;
      changed = sanitizeInternalMessages(ctx) || changed;
      changed = disableBlockedToolsInRegistry(ctx) || changed;
      changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
      if (shouldUseSeparateModel(meta)) {
        changed = (await runPlanningBySeparateModel(ctx, meta)) || changed;
      } else {
        changed = maybeInjectPlanningPrompt(ctx) || changed;
      }
    }
    if (point === "after_llm_call") {
      changed = (await maybeCapturePlanningResult(ctx, meta)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}

export {
  enablePlanningForceToolRetry,
  restorePlanningForceToolRetry,
};
