/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FAILURE_THRESHOLD, LLM_SUMMARY_THRESHOLD } from "../../core/thresholds.js";

export const LOCALE = Object.freeze({
  ZH_CN: "zh-CN",
  EN_US: "en-US",
});

const DEFAULT_TASK_OWNER = Object.freeze({
  [LOCALE.ZH_CN]: "primary_task_owner",
  [LOCALE.EN_US]: "primary_task_owner",
});
const DEFAULT_SUBTASK_OWNERS = Object.freeze({
  [LOCALE.ZH_CN]: ["subtask_owner_alpha", "subtask_owner_beta"],
  [LOCALE.EN_US]: ["subtask_owner_alpha", "subtask_owner_beta"],
});
const DEFAULT_TASK_TEMPLATE = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    PARSE_ATTACHMENT: "解析附件",
    EXECUTE_CORE: "执行核心任务",
    START_SUBTASK: "开启子任务",
    WAIT_SUBTASK_RESULT: "等待子任务结果",
  }),
  [LOCALE.EN_US]: Object.freeze({
    PARSE_ATTACHMENT: "Parse attachments",
    EXECUTE_CORE: "Execute core task",
    START_SUBTASK: "Start subtasks",
    WAIT_SUBTASK_RESULT: "Wait for subtask results",
  }),
});

export const ACCEPTANCE_MODE = Object.freeze({
  ACTIVE: "active",
  FORCED: "forced",
});

export const GUIDANCE_REASON = Object.freeze({
  CONSECUTIVE_FAILURES: "consecutive_failures",
  ACCUMULATED_FAILURES: "accumulated_failures",
});
export { FAILURE_THRESHOLD, LLM_SUMMARY_THRESHOLD };

export const TOOL_NAME_SET = Object.freeze({
  CALL_SERVICE: "call_service",
  WEB_TO_DATA: "web_to_data",
  MEDIA_TO_DATA: "media_to_data",
  DOC_TO_DATA: "doc_to_data",
  PROCESS_CONTENT_TASK: "process_content_task",
  DELEGATE_TASK_ASYNC: "delegate_task_async",
  PLAN_MULTI_TASK_COLLABORATION: "plan_multi_task_collaboration",
  WAIT_ASYNC_TASK_RESULT: "wait_async_task_result",
});

export const CAPABILITY_DOMAIN = Object.freeze({
  PLANNING: "planning",
  GUIDANCE: "guidance",
  ACCEPTANCE: "acceptance",
  REVIEW: "review",
});

const I18N_TEXT = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    taskAcceptanceToolDescription:
      "请求任务验收：按 harness 插件任务清单输出验收报告；mode=active(主动) 或 forced(强行)。",
    planningPromptMarker: "<!-- harness-planning-bootstrap -->",
    planningPromptBody:
      "基于完整上下文和全部工具生成完整计划：必须包含 totalGoal；每步必须包含 task、input、output、files(create/modify/delete)。\n仅输出 JSON：{example}\n输出后继续执行，不要结束。\n工具范围用 *；后续修订也必须输出完整计划。",
    planningPromptToolsHeader: "可用工具（name/description），规划必须参考：",
    guidanceSummaryMarker: "<!-- harness-guidance-summary -->",
    guidanceSummaryBody: "只输出已完成项；最后一行必须为“小结完成”。",
    planningRevisionMarker: "<!-- harness-planning-revision -->",
    planningRevisionPromptBody:
      "基于当前状态和阶段小结修订计划。\n仅输出完整计划 JSON，并给出 nextPhase。\n格式：{example}",
    guidanceMarker: "<!-- harness-guidance -->",
    guidanceBody: "工具失败达到阈值({reason})，基于未小结消息给出下一步指引。",
    guidancePreferTools: "优先工具：{tools}。",
    guidanceWebService: "网页搜索使用 {service}（通过 {tool}）。",
    acceptanceSemanticValidationMarker: "<!-- harness-acceptance-semantic-validation -->",
    acceptanceSemanticValidationBody: "基于最新计划和验收报告做语义一致性校验；仅输出 JSON。",
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[来自harness外部模型输出/{purpose}]",
    reviewHeader: "[Harness-Review]",
  }),
  [LOCALE.EN_US]: Object.freeze({
    taskAcceptanceToolDescription:
      "Request task acceptance: validate completion against the harness checklist; mode=active or forced.",
    planningPromptMarker: "<!-- harness-planning-bootstrap -->",
    planningPromptBody:
      "Generate a complete plan from full context and all tools: include totalGoal; each step must include task/input/output/files(create/modify/delete).\nJSON only: {example}\nContinue after output; do not end.\nUse * for tool scope; revisions must also output the full plan.",
    planningPromptToolsHeader: "Available tools (name/description), must be referenced:",
    guidanceSummaryMarker: "<!-- harness-guidance-summary -->",
    guidanceSummaryBody: 'Only output completed items; final line must be "Summary complete".',
    planningRevisionMarker: "<!-- harness-planning-revision -->",
    planningRevisionPromptBody:
      "Revise the plan from current state and phase summary.\nOutput full plan JSON only and include nextPhase.\nFormat: {example}",
    guidanceMarker: "<!-- harness-guidance -->",
    guidanceBody:
      "Tool failures reached threshold ({reason}); provide next-step guidance from unsummarized messages.",
    guidancePreferTools: "Preferred tools: {tools}.",
    guidanceWebService: "Use web search {service} (via {tool}).",
    acceptanceSemanticValidationMarker: "<!-- harness-acceptance-semantic-validation -->",
    acceptanceSemanticValidationBody:
      "Validate semantic consistency from latest plan and acceptance report; JSON only.",
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[Relay from harness external model/{purpose}]",
    reviewHeader: "[Harness-Review]",
  }),
});

export const BLOCKED_AGENT_TOOL_NAMES = new Set([
  TOOL_NAME_SET.PLAN_MULTI_TASK_COLLABORATION,
  "request_help",
  "task_summary",
]);

export const GUIDANCE_WEB_SERVICE_NAME = "web_search_service";
export const GUIDANCE_WEB_TOOL_NAMES = [TOOL_NAME_SET.CALL_SERVICE];
export const TASK_ACCEPTANCE_TOOL_NAME = "request_task_acceptance";
const HARNESS_BUCKET_VERSION = 1;

const DEFAULT_HARNESS_COUNTERS = Object.freeze({
  llmTurns: 0,
  consecutiveToolFailures: 0,
  totalToolFailures: 0,
});

const DEFAULT_HARNESS_FLAGS = Object.freeze({
  planningPromptInjected: false,
  planningCaptured: false,
  planningSeparateModelInFlight: false,
  acceptanceRequested: false,
  checklistArtifactsAttached: false,
  planningForceToolTemporarilyEnabled: false,
  planningForceToolOriginalSet: false,
  planningForceToolOriginal: false,
  guidanceSummaryMarkPending: false,
  planRevisionCapturePending: false,
  acceptanceSemanticValidationCapturePending: false,
});

const DEFAULT_HARNESS_SIGNALS = Object.freeze({
  parsedAttachment: false,
  subtaskStarted: false,
  subtaskWaited: false,
  successfulToolCount: 0,
});

const DEFAULT_HARNESS_PENDING = Object.freeze({
  guidance: null,
  summary: false,
  planRevision: false,
  acceptanceSemanticValidation: null,
});

function ensureObjectField(target = {}, key = "") {
  if (!target || !key) return {};
  const current = target[key];
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    target[key] = {};
  }
  return target[key];
}

function ensureArrayField(target = {}, key = "") {
  if (!target || !key) return [];
  if (!Array.isArray(target[key])) target[key] = [];
  return target[key];
}

function fillMissingDefaults(target = {}, defaults = {}) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) target[key] = value;
  }
}

export function resolveLocale(ctx = {}) {
  const runtime =
    ctx?.agentContext?.execution?.controllers?.runtime &&
    typeof ctx.agentContext.execution.controllers.runtime === "object"
      ? ctx.agentContext.execution.controllers.runtime
      : {};
  const localeCandidates = [
    ctx?.locale,
    runtime?.systemRuntime?.config?.locale,
    runtime?.userConfig?.locale,
    runtime?.globalConfig?.locale,
    runtime?.runConfig?.locale,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const locale = localeCandidates[0] || LOCALE.ZH_CN;
  return String(locale).toLowerCase().startsWith("en") ? LOCALE.EN_US : LOCALE.ZH_CN;
}

export function translateI18nText(locale = LOCALE.ZH_CN, key = "", params = {}) {
  const dict = I18N_TEXT[locale] || I18N_TEXT[LOCALE.ZH_CN];
  const raw = String(dict?.[key] || I18N_TEXT[LOCALE.ZH_CN]?.[key] || "").trim();
  if (!raw) return "";
  return raw.replace(/\{(\w+)\}/g, (_all, token) => String(params?.[token] ?? ""));
}

export function getDefaultTaskOwner(locale = LOCALE.ZH_CN) {
  return DEFAULT_TASK_OWNER[locale] || DEFAULT_TASK_OWNER[LOCALE.ZH_CN];
}

export function getDefaultSubtaskOwners(locale = LOCALE.ZH_CN) {
  const owners = DEFAULT_SUBTASK_OWNERS[locale] || DEFAULT_SUBTASK_OWNERS[LOCALE.ZH_CN];
  return Array.isArray(owners) ? [...owners] : [];
}

export function getTaskTemplate(locale = LOCALE.ZH_CN) {
  return DEFAULT_TASK_TEMPLATE[locale] || DEFAULT_TASK_TEMPLATE[LOCALE.ZH_CN];
}

export function ensureHarnessBucket(ctx = {}) {
  const agentContext =
    ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return null;
  const payload = ensureObjectField(agentContext, "payload");
  const bucket = ensureObjectField(payload, "harness");
  const state = ensureObjectField(bucket, "state");

  const isFastPathReady =
    bucket.__harnessBucketVersion === HARNESS_BUCKET_VERSION &&
    state.__harnessBucketVersion === HARNESS_BUCKET_VERSION &&
    Array.isArray(bucket.taskChecklist) &&
    Array.isArray(bucket.acceptanceReports) &&
    Array.isArray(bucket.reviewReports) &&
    Array.isArray(bucket.planningRawOutputs) &&
    bucket.logs &&
    typeof bucket.logs === "object" &&
    Array.isArray(bucket.logs.planning) &&
    Array.isArray(bucket.logs.guidance) &&
    Array.isArray(bucket.logs.acceptance) &&
    Array.isArray(bucket.logs.review);

  if (!isFastPathReady) {
    const counters = ensureObjectField(state, "counters");
    const flags = ensureObjectField(state, "flags");
    const signals = ensureObjectField(state, "signals");
    const pending = ensureObjectField(state, "pending");
    fillMissingDefaults(counters, DEFAULT_HARNESS_COUNTERS);
    fillMissingDefaults(flags, DEFAULT_HARNESS_FLAGS);
    fillMissingDefaults(signals, DEFAULT_HARNESS_SIGNALS);
    fillMissingDefaults(pending, DEFAULT_HARNESS_PENDING);

    ensureArrayField(bucket, "taskChecklist");
    ensureArrayField(bucket, "acceptanceReports");
    ensureArrayField(bucket, "reviewReports");
    ensureArrayField(bucket, "planningRawOutputs");
    if (!("lastPlanningRawOutput" in bucket) || (bucket.lastPlanningRawOutput && typeof bucket.lastPlanningRawOutput !== "object")) {
      bucket.lastPlanningRawOutput = null;
    }
    const logs = ensureObjectField(bucket, "logs");
    ensureArrayField(logs, "planning");
    ensureArrayField(logs, "guidance");
    ensureArrayField(logs, "acceptance");
    ensureArrayField(logs, "review");
    bucket.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
    state.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
  }

  const locale = resolveLocale(ctx);
  state.locale = locale;
  return { bucket, state };
}

export function mergeAttachmentMetas(existing = [], incoming = []) {
  const current = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!next.length) return current;
  const keyOf = (item = {}) =>
    String(item?.attachmentId || "").trim() ||
    `${String(item?.name || "").trim()}|${String(item?.path || "").trim()}`;
  const seen = new Set(current.map((item) => keyOf(item)).filter(Boolean));
  const merged = [...current];
  for (const item of next) {
    const key = keyOf(item);
    if (key && seen.has(key)) continue;
    merged.push(item);
    if (key) seen.add(key);
  }
  return merged;
}

export function mapAttachmentRecordsToMetas(records = []) {
  const list = Array.isArray(records) ? records : [];
  return list.map((record = {}) => ({
    attachmentId: String(record?.attachmentId || "").trim(),
    sessionId: String(record?.sessionId || "").trim(),
    attachmentSource: String(record?.attachmentSource || "model").trim(),
    name: String(record?.name || "").trim(),
    mimeType: String(record?.mimeType || "application/octet-stream").trim(),
    size: Number(record?.size) || 0,
    path: String(record?.path || "").trim(),
    relativePath: String(record?.relativePath || "").trim(),
    generatedByModel: record?.generatedByModel === true,
    generationSource: String(record?.generationSource || "").trim(),
  }));
}

export function attachArtifactsToAssistantResult(ctx = {}, attachmentMetas = []) {
  const metas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  if (!metas.length) return false;
  const result = ctx?.result && typeof ctx.result === "object" ? ctx.result : null;
  if (!result || !Array.isArray(result.turnMessages)) return false;
  const assistantIndexes = [];
  for (let messageIndex = 0; messageIndex < result.turnMessages.length; messageIndex += 1) {
    if (String(result.turnMessages[messageIndex]?.role || "").trim() === "assistant") {
      assistantIndexes.push(messageIndex);
    }
  }
  if (!assistantIndexes.length) return false;
  const latestDialogProcessId = String(
    result.turnMessages[assistantIndexes[assistantIndexes.length - 1]]?.dialogProcessId || "",
  ).trim();
  let changed = false;
  for (const index of assistantIndexes) {
    const message = result.turnMessages[index] || {};
    const dialogProcessId = String(message?.dialogProcessId || "").trim();
    if (latestDialogProcessId && dialogProcessId !== latestDialogProcessId) continue;
    result.turnMessages[index] = {
      ...message,
      attachmentMetas: mergeAttachmentMetas(message?.attachmentMetas, metas),
    };
    changed = true;
  }
  return changed;
}

export function appendCapabilityLog(ctx = {}, { domain = "", event = "", detail = {} } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket } = holder;
  if (!domain || !bucket?.logs?.[domain] || !Array.isArray(bucket.logs[domain])) return false;
  const entry = {
    domain,
    event: String(event || "").trim() || "unknown",
    timestamp: new Date().toISOString(),
    point: String(ctx?.phase || "").trim() || undefined,
    turn: Number.isFinite(Number(ctx?.turn)) ? Number(ctx.turn) : undefined,
    detail: detail && typeof detail === "object" ? detail : {},
  };
  bucket.logs[domain].push(entry);
  if (!Array.isArray(ctx.harnessCapabilityLogs)) {
    ctx.harnessCapabilityLogs = [];
  }
  ctx.harnessCapabilityLogs.push(entry);
  return true;
}

export function relaySeparateModelOutputAsUserMessage(
  ctx = {},
  { locale = LOCALE.ZH_CN, purpose = "", content = "", dedupe = false } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  const text = String(content || "").trim();
  if (!messages || !text) return false;
  const prefix = translateI18nText(locale, "separateModelRelayPrefix", {
    purpose: String(purpose || "").trim() || "unknown",
  });
  const relayContent = `${prefix}\n${text}`;
  if (dedupe === true) {
    const exists = messages.some(
      (message = {}) =>
        String(message?.role || "").trim() === "user" &&
        String(message?.content || "").trim() === relayContent,
    );
    if (exists) {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_separate_model_relay_skipped_duplicate",
      });
      return false;
    }
  }
  messages.push({
    role: "user",
    content: relayContent,
  });
  return true;
}

export async function appendCapabilityModelTraceLog(
  ctx = {},
  meta = {},
  { domain = "", purpose = "", response = null } = {},
) {
  const traces = Array.isArray(response?.traces) ? response.traces : [];
  if (!traces.length) return false;
  const detail = {
    purpose: String(purpose || response?.purpose || "").trim() || undefined,
    finishedReason: response?.finishedReason || undefined,
    turn: response?.turn || undefined,
    toolTurnLimitReached: response?.toolTurnLimitReached === true,
    traces,
  };
  const log = {
    domain,
    event: "capability_model_trace",
    detail,
  };
  appendCapabilityLog(ctx, log);
  const sink = typeof meta?.harness?.runTraceSink === "function" ? meta.harness.runTraceSink : null;
  if (sink) {
    await sink({
      point: ctx?.point || "before_llm_call",
      timestamp: new Date().toISOString(),
      userId: ctx?.userId || undefined,
      sessionId: ctx?.sessionId || undefined,
      dialogProcessId: ctx?.dialogProcessId || undefined,
      ...log,
    });
  }
  return true;
}

export function resolvePlanningGuidanceMode(meta = {}) {
  return String(meta?.harness?.planningGuidanceMode || "separate_model").trim().toLowerCase();
}

export function shouldUseSeparateModel(meta = {}) {
  return resolvePlanningGuidanceMode(meta) === "separate_model";
}

export function resolveCapabilityModelInvoker(meta = {}) {
  return typeof meta?.harness?.capabilityModelInvoker === "function"
    ? meta.harness.capabilityModelInvoker
    : null;
}

function normalizeCapabilityModelMap(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => [
        String(key || "").trim(),
        String(
          value && typeof value === "object" && !Array.isArray(value)
            ? value.model
            : value || "",
        ).trim(),
      ])
      .filter(([key, value]) => key && value),
  );
}

export function resolveCapabilityModelName(meta = {}, { purpose = "", domain = "" } = {}) {
  const byPurpose = {
    ...normalizeCapabilityModelMap(meta?.harness?.capabilityModelByPurpose),
    ...normalizeCapabilityModelMap(meta?.harness?.stepModels),
  };
  const normalizedPurpose = String(purpose || "").trim();
  const normalizedDomain = String(domain || "").trim();
  const lowerPurpose = normalizedPurpose.toLowerCase();
  const candidates = [
    normalizedPurpose,
    lowerPurpose,
    lowerPurpose.includes("planning") ? "planning" : "",
    lowerPurpose.includes("acceptance") ? "acceptance" : "",
    lowerPurpose === "summary" ? "summary" : "",
    lowerPurpose.includes("guidance") ? "guidance" : "",
    normalizedDomain,
    normalizedDomain.toLowerCase(),
    "default",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (byPurpose[candidate]) return byPurpose[candidate];
  }
  return "";
}

export function resolveCapabilityModelMessages(
  meta = {},
  { ctx = {}, purpose = "", messages = [] } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const resolver = meta?.harness?.resolveModelMessages;
  if (typeof resolver !== "function") return source;
  try {
    const resolved = resolver({
      ctx,
      purpose: String(purpose || "").trim(),
      messages: source,
    });
    return Array.isArray(resolved) ? resolved : source;
  } catch {
    return source;
  }
}

export function resolveCapabilityToolAllowlist(meta = {}, purpose = "") {
  const normalizedPurpose = String(purpose || "").trim();
  const byPurpose =
    meta?.harness?.capabilityToolAllowlistByPurpose &&
    typeof meta.harness.capabilityToolAllowlistByPurpose === "object"
      ? meta.harness.capabilityToolAllowlistByPurpose
      : {};
  const scoped = Array.isArray(byPurpose?.[normalizedPurpose]) ? byPurpose[normalizedPurpose] : null;
  if (scoped) {
    const normalized = scoped.map((item) => String(item || "").trim()).filter(Boolean);
    if (normalized.includes("*")) return ["*"];
    return normalized;
  }
  const globalAllowlist = Array.isArray(meta?.harness?.capabilityToolAllowlist)
    ? meta.harness.capabilityToolAllowlist
    : [];
  const normalized = globalAllowlist.map((item) => String(item || "").trim()).filter(Boolean);
  if (normalized.includes("*")) return ["*"];
  return normalized;
}

export function resolvePlanningToolAllowlist(meta = {}) {
  // Follow harness config directly; no hardcoded fallback to wildcard.
  // If caller does not configure planning allowlist, default is empty (no tools).
  const allowlist = resolveCapabilityToolAllowlist(meta, "planning");
  if (!Array.isArray(allowlist) || !allowlist.length) return [];
  if (allowlist.includes("*")) return ["*"];
  return allowlist;
}

export function resolveSceneToolNames(ctx = {}) {
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return [];
  return registry
    .map((tool) => String(tool?.name || "").trim())
    .filter(Boolean);
}

export function shouldProcessPrimaryToolHooks(ctx = {}) {
  const scope = String(ctx?.executionScope || "").trim().toLowerCase();
  if (!scope) return true;
  return scope === "primary";
}

export function cleanupInternalForcedMessages(messages = []) {
  if (!Array.isArray(messages)) return 0;
  let removed = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const marker =
      message?.additional_kwargs?.noobotInternalMessageType ||
      message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      message?.metadata?.noobotInternalMessageType ||
      message?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "";
    if (!String(marker || "").trim()) continue;
    messages.splice(index, 1);
    removed += 1;
  }
  return removed;
}

export function sanitizeInternalMessages(ctx = {}) {
  let changed = false;
  if (cleanupInternalForcedMessages(ctx?.messages || []) > 0) {
    changed = true;
  }
  const systemMessages = ctx?.agentContext?.payload?.messages?.system;
  const historyMessages = ctx?.agentContext?.payload?.messages?.history;
  if (cleanupInternalForcedMessages(systemMessages || []) > 0) {
    changed = true;
  }
  if (cleanupInternalForcedMessages(historyMessages || []) > 0) {
    changed = true;
  }
  return changed;
}

export function disableBlockedToolsInRegistry(ctx = {}) {
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return false;
  const next = registry.filter((tool) => {
    const name = String(tool?.name || "").trim();
    return name && !BLOCKED_AGENT_TOOL_NAMES.has(name);
  });
  if (next.length === registry.length) return false;
  registry.splice(0, registry.length, ...next);
  return true;
}

export function disableBlockedCalls(calls = []) {
  if (!Array.isArray(calls)) return false;
  const next = calls.filter((call) => !BLOCKED_AGENT_TOOL_NAMES.has(String(call?.name || "").trim()));
  if (next.length === calls.length) return false;
  calls.splice(0, calls.length, ...next);
  return true;
}

export function extractRawTextContent(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  return input
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.text === "string") {
        return item.text;
      }
      return "";
    })
    .join("\n")
    .trim();
}

export function safeJsonStringify(value = null, space = 2) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (_key, current) => {
        if (typeof current === "bigint") return String(current);
        if (typeof current === "function") {
          return `[Function ${current.name || "anonymous"}]`;
        }
        if (current && typeof current === "object") {
          if (seen.has(current)) return "[Circular]";
          seen.add(current);
        }
        return current;
      },
      space,
    );
  } catch (error) {
    return JSON.stringify({
      error: "ctx_serialize_failed",
      message: String(error?.message || error || ""),
    });
  }
}

function markMessageSummarized(messageItem = null) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem.summarized === true && messageItem?.lc_kwargs?.summarized === true) return false;
  messageItem.summarized = true;
  if (messageItem?.lc_kwargs && typeof messageItem.lc_kwargs === "object") {
    messageItem.lc_kwargs.summarized = true;
  }
  return true;
}

const DEFAULT_TASK_SUMMARY_TOOL_NAME = "task_summary";

function resolveToolNamesFromToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((toolCall = {}) => {
      if (!toolCall || typeof toolCall !== "object") return "";
      if (toolCall.name) return String(toolCall.name || "").trim();
      const fn =
        toolCall.function && typeof toolCall.function === "object"
          ? toolCall.function
          : {};
      return String(fn.name || "").trim();
    })
    .filter(Boolean);
}

function getMessageToolCalls(messageItem = {}) {
  if (Array.isArray(messageItem?.tool_calls)) return messageItem.tool_calls;
  if (Array.isArray(messageItem?.lc_kwargs?.tool_calls)) return messageItem.lc_kwargs.tool_calls;
  if (Array.isArray(messageItem?.additional_kwargs?.tool_calls)) return messageItem.additional_kwargs.tool_calls;
  return [];
}

function resolveToolNameFromMessage(messageItem = {}) {
  const explicitToolName = String(
    messageItem?.toolName || messageItem?.tool_name || "",
  ).trim();
  if (explicitToolName) return explicitToolName;
  try {
    const parsed = JSON.parse(String(messageItem?.content || ""));
    return String(parsed?.toolName || "").trim();
  } catch {
    return "";
  }
}

function shouldMarkHarnessSummaryMessage(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  if (!messageItem || typeof messageItem !== "object") return false;
  const role = String(messageItem?.role || messageItem?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role === "system" || role === "user") return false;
  if (role === "tool") {
    return resolveToolNameFromMessage(messageItem) !== taskSummaryToolName;
  }
  if (role !== "assistant") return false;
  const toolCallNames = resolveToolNamesFromToolCalls(getMessageToolCalls(messageItem));
  if (toolCallNames.includes(taskSummaryToolName)) return false;
  return !String(messageItem?.content || "").trim();
}

export function markMessagesSummarized(messages = []) {
  if (!Array.isArray(messages)) return 0;
  let changedCount = 0;
  for (const messageItem of messages) {
    if (
      !shouldMarkHarnessSummaryMessage(messageItem, {
        taskSummaryToolName: DEFAULT_TASK_SUMMARY_TOOL_NAME,
      })
    ) {
      continue;
    }
    if (markMessageSummarized(messageItem)) {
      changedCount += 1;
    }
  }
  return changedCount;
}

export function resolveInjectedMessageSummarizer(meta = {}) {
  return typeof meta?.harness?.markMessagesSummarized === "function"
    ? meta.harness.markMessagesSummarized
    : null;
}

export function extractJsonObjectFromText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const candidates = [raw.match(/\{[\s\S]*\}/), raw.match(/\[[\s\S]*\]/)];
  for (const matched of candidates) {
    const segment = matched?.[0];
    if (!segment) continue;
    try {
      return JSON.parse(segment);
    } catch {}
  }
  return null;
}

function normalizeFilePlan(files = null) {
  const source = files && typeof files === "object" && !Array.isArray(files) ? files : {};
  const readArray = (...keys) => {
    for (const key of keys) {
      if (Array.isArray(source[key])) return source[key].map((item) => String(item || "").trim()).filter(Boolean);
    }
    return [];
  };
  return {
    create: readArray("create", "created", "add", "新增", "new"),
    modify: readArray("modify", "modified", "change", "update", "修改"),
    delete: readArray("delete", "deleted", "remove", "删除"),
  };
}

export function normalizeChecklistItem(item = {}, index = 0, locale = LOCALE.ZH_CN) {
  const source = item && typeof item === "object" ? item : {};
  const fallbackTaskName =
    locale === LOCALE.EN_US ? `Task ${index + 1}` : `任务${index + 1}`;
  return {
    index: Number(source.index ?? source.seq ?? source.id ?? index + 1),
    task: String(source.task ?? source.name ?? source.todo ?? "").trim() || fallbackTaskName,
    owner:
      String(source.owner ?? source.assignee ?? getDefaultTaskOwner(locale)).trim() ||
      getDefaultTaskOwner(locale),
    subOwners: Array.isArray(source.subOwners ?? source.subTaskOwners)
      ? (source.subOwners ?? source.subTaskOwners).map((name) => String(name || "").trim()).filter(Boolean)
      : [],
    input: String(source.input ?? source.inputs ?? source.requiredInput ?? "").trim(),
    output: String(source.output ?? source.outputs ?? source.expectedOutput ?? "").trim(),
    files: normalizeFilePlan(source.files ?? source.fileChanges ?? source.filePlan),
  };
}

export function parseTaskChecklistFromModelOutput(text = "", locale = LOCALE.ZH_CN) {
  const parsed = extractJsonObjectFromText(text);
  if (Array.isArray(parsed)) {
    return parsed.map((item, index) => normalizeChecklistItem(item, index, locale));
  }
  if (parsed && typeof parsed === "object") {
    const checklist = Array.isArray(parsed.taskChecklist)
      ? parsed.taskChecklist
      : Array.isArray(parsed.tasks)
        ? parsed.tasks
        : null;
    if (checklist) {
      return checklist.map((item, index) => normalizeChecklistItem(item, index, locale));
    }
  }
  return [];
}

export function buildPlanSnapshot(bucket = {}, locale = LOCALE.ZH_CN) {
  const source = bucket && typeof bucket === "object" ? bucket : {};
  return {
    totalGoal: String(source.totalGoal || "").trim(),
    taskOwner: String(source.taskOwner || getDefaultTaskOwner(locale)).trim() || getDefaultTaskOwner(locale),
    nextPhase: source.nextPhase && typeof source.nextPhase === "object" ? source.nextPhase : null,
    checklistSource: String(source.taskChecklistSource || "").trim(),
    revisionCount: Array.isArray(source.planRevisions) ? source.planRevisions.length : 0,
  };
}

export function defaultTaskChecklist(locale = LOCALE.ZH_CN) {
  const owner = getDefaultTaskOwner(locale);
  const template = getTaskTemplate(locale);
  const emptyFiles = () => ({ create: [], modify: [], delete: [] });
  return [
    { index: 1, task: template.PARSE_ATTACHMENT, owner, subOwners: [], input: "user attachments/context", output: "parsed attachment/context data", files: emptyFiles() },
    { index: 2, task: template.EXECUTE_CORE, owner, subOwners: [], input: "task requirements and parsed data", output: "core task result", files: emptyFiles() },
    {
      index: 3,
      task: template.START_SUBTASK,
      owner,
      subOwners: getDefaultSubtaskOwners(locale),
      input: "delegable subtasks",
      output: "started subtask records",
      files: emptyFiles(),
    },
    { index: 4, task: template.WAIT_SUBTASK_RESULT, owner, subOwners: [], input: "started subtask records", output: "merged subtask results", files: emptyFiles() },
  ];
}
