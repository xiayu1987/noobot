import { HARNESS_ENGINEERING_CAPABILITIES } from "./profile.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const LOCALE = Object.freeze({
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
const ACCEPTANCE_MODE = Object.freeze({
  ACTIVE: "active",
  FORCED: "forced",
});
const TASK_STATUS = Object.freeze({
  COMPLETED: "completed",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
});
const GUIDANCE_REASON = Object.freeze({
  CONSECUTIVE_FAILURES: "consecutive_failures",
  ACCUMULATED_FAILURES: "accumulated_failures",
});
const FAILURE_THRESHOLD = Object.freeze({
  CONSECUTIVE: 3,
  ACCUMULATED: 10,
});
const LLM_SUMMARY_THRESHOLD = 15;
const TOOL_NAME_SET = Object.freeze({
  CALL_SERVICE: "call_service",
  WEB_TO_DATA: "web_to_data",
  MEDIA_TO_DATA: "media_to_data",
  DOC_TO_DATA: "doc_to_data",
  PROCESS_CONTENT_TASK: "process_content_task",
  DELEGATE_TASK_ASYNC: "delegate_task_async",
  PLAN_MULTI_TASK_COLLABORATION: "plan_multi_task_collaboration",
  WAIT_ASYNC_TASK_RESULT: "wait_async_task_result",
});
const CAPABILITY_DOMAIN = Object.freeze({
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
    planningPromptLine1: "首次模型调用：先输出任务清单(JSON)，随后继续执行任务，不要在清单后直接结束。",
    planningPromptLine2: "格式示例：{example}",
    planningPromptLine3: "可包含子任务负责人(subOwners)。",
    guidanceSummaryMarker: "<!-- harness-guidance-summary -->",
    guidanceSummaryBody: "轮数已超过15轮，请立即输出当前阶段小结（目标、完成项、未完成项、阻塞项、下一步）。",
    guidanceMarker: "<!-- harness-guidance -->",
    guidanceBody: "检测到工具失败阈值({reason})，请基于未小结消息给出下一步指引。",
    guidancePreferTools: "优先使用工具: {tools}。",
    guidanceWebService: "网页搜索服务请使用: {service}（通过 {tool} 调用）。",
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[来自harness外部模型输出/{purpose}]",
    reviewHeader: "[Harness-Review]",
  }),
  [LOCALE.EN_US]: Object.freeze({
    taskAcceptanceToolDescription:
      "Request task acceptance: validate completion against the harness checklist; mode=active or forced.",
    planningPromptMarker: "<!-- harness-planning-bootstrap -->",
    planningPromptLine1:
      "On the first model call, output a JSON task checklist first, then continue execution instead of stopping.",
    planningPromptLine2: "Format example: {example}",
    planningPromptLine3: "You may include subtask owners (subOwners).",
    guidanceSummaryMarker: "<!-- harness-guidance-summary -->",
    guidanceSummaryBody:
      "The loop count exceeded 15. Output a phase summary now (goal, completed, pending, blockers, next steps).",
    guidanceMarker: "<!-- harness-guidance -->",
    guidanceBody:
      "Tool-failure threshold reached ({reason}). Provide next-step guidance based on unsummarized messages.",
    guidancePreferTools: "Prefer tools: {tools}.",
    guidanceWebService: "Use web search service: {service} (via {tool}).",
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[Relay from harness external model/{purpose}]",
    reviewHeader: "[Harness-Review]",
  }),
});

function resolveLocale(ctx = {}) {
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

function t(locale = LOCALE.ZH_CN, key = "", params = {}) {
  const dict = I18N_TEXT[locale] || I18N_TEXT[LOCALE.ZH_CN];
  const raw = String(dict?.[key] || I18N_TEXT[LOCALE.ZH_CN]?.[key] || "").trim();
  if (!raw) return "";
  return raw.replace(/\{(\w+)\}/g, (_all, token) => String(params?.[token] ?? ""));
}

function getDefaultTaskOwner(locale = LOCALE.ZH_CN) {
  return DEFAULT_TASK_OWNER[locale] || DEFAULT_TASK_OWNER[LOCALE.ZH_CN];
}

function getDefaultSubtaskOwners(locale = LOCALE.ZH_CN) {
  const owners = DEFAULT_SUBTASK_OWNERS[locale] || DEFAULT_SUBTASK_OWNERS[LOCALE.ZH_CN];
  return Array.isArray(owners) ? [...owners] : [];
}

function getTaskTemplate(locale = LOCALE.ZH_CN) {
  return DEFAULT_TASK_TEMPLATE[locale] || DEFAULT_TASK_TEMPLATE[LOCALE.ZH_CN];
}

const BLOCKED_AGENT_TOOL_NAMES = new Set([
  TOOL_NAME_SET.PLAN_MULTI_TASK_COLLABORATION,
  "request_help",
  "task_summary",
]);

const GUIDANCE_WEB_SERVICE_NAME = "web_search_service";
const GUIDANCE_WEB_TOOL_NAMES = [TOOL_NAME_SET.CALL_SERVICE];
const TASK_ACCEPTANCE_TOOL_NAME = "request_task_acceptance";

function ensureHarnessBucket(ctx = {}) {
  const agentContext =
    ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return null;
  if (!agentContext.payload || typeof agentContext.payload !== "object") {
    agentContext.payload = {};
  }
  if (!agentContext.payload.harness || typeof agentContext.payload.harness !== "object") {
    agentContext.payload.harness = {};
  }
  const bucket = agentContext.payload.harness;
  if (!bucket.state || typeof bucket.state !== "object") {
    bucket.state = {};
  }
  const state = bucket.state;
  if (!state.counters || typeof state.counters !== "object") {
    state.counters = {
      llmTurns: 0,
      consecutiveToolFailures: 0,
      totalToolFailures: 0,
    };
  }
  if (!state.flags || typeof state.flags !== "object") {
    state.flags = {
      planningPromptInjected: false,
      planningCaptured: false,
      acceptanceRequested: false,
      checklistArtifactsAttached: false,
      planningForceToolTemporarilyEnabled: false,
      planningForceToolOriginalSet: false,
      planningForceToolOriginal: false,
    };
  }
  if (state.flags.checklistArtifactsAttached === undefined) {
    state.flags.checklistArtifactsAttached = false;
  }
  if (state.flags.planningForceToolTemporarilyEnabled === undefined) {
    state.flags.planningForceToolTemporarilyEnabled = false;
  }
  if (state.flags.planningForceToolOriginalSet === undefined) {
    state.flags.planningForceToolOriginalSet = false;
  }
  if (state.flags.planningForceToolOriginal === undefined) {
    state.flags.planningForceToolOriginal = false;
  }
  if (!state.signals || typeof state.signals !== "object") {
    state.signals = {
      parsedAttachment: false,
      subtaskStarted: false,
      subtaskWaited: false,
      successfulToolCount: 0,
    };
  }
  if (!state.pending || typeof state.pending !== "object") {
    state.pending = {
      guidance: null,
      summary: false,
    };
  }
  if (!Array.isArray(bucket.taskChecklist)) {
    bucket.taskChecklist = [];
  }
  if (!Array.isArray(bucket.acceptanceReports)) {
    bucket.acceptanceReports = [];
  }
  if (!Array.isArray(bucket.reviewReports)) {
    bucket.reviewReports = [];
  }
  if (!bucket.logs || typeof bucket.logs !== "object") {
    bucket.logs = {
      planning: [],
      guidance: [],
      acceptance: [],
      review: [],
    };
  }
  if (!Array.isArray(bucket.logs.planning)) bucket.logs.planning = [];
  if (!Array.isArray(bucket.logs.guidance)) bucket.logs.guidance = [];
  if (!Array.isArray(bucket.logs.acceptance)) bucket.logs.acceptance = [];
  if (!Array.isArray(bucket.logs.review)) bucket.logs.review = [];
  const locale = resolveLocale(ctx);
  state.locale = locale;
  return { bucket, state };
}

function mergeAttachmentMetas(existing = [], incoming = []) {
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

function mapAttachmentRecordsToMetas(records = []) {
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

function attachArtifactsToAssistantResult(ctx = {}, attachmentMetas = []) {
  const metas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  if (!metas.length) return false;
  const result = ctx?.result && typeof ctx.result === "object" ? ctx.result : null;
  if (!result || !Array.isArray(result.turnMessages)) return false;
  const assistantIndexes = [];
  for (let i = 0; i < result.turnMessages.length; i += 1) {
    if (String(result.turnMessages[i]?.role || "").trim() === "assistant") {
      assistantIndexes.push(i);
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

function appendCapabilityLog(ctx = {}, { domain = "", event = "", detail = {} } = {}) {
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

function relaySeparateModelOutputAsUserMessage(
  ctx = {},
  { locale = LOCALE.ZH_CN, purpose = "", content = "" } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  const text = String(content || "").trim();
  if (!messages || !text) return false;
  const prefix = t(locale, "separateModelRelayPrefix", { purpose: String(purpose || "").trim() || "unknown" });
  messages.push({
    role: "user",
    content: `${prefix}\n${text}`,
  });
  return true;
}


async function appendCapabilityModelTraceLog(ctx = {}, meta = {}, { domain = "", purpose = "", response = null } = {}) {
  const traces = Array.isArray(response?.traces) ? response.traces : [];
  if (!traces.length) return false;
  const detail = {
    purpose: String(purpose || response?.purpose || "").trim() || undefined,
    finishedReason: response?.finishedReason || undefined,
    turn: response?.turn || undefined,
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

function resolvePlanningGuidanceMode(meta = {}) {
  return String(meta?.harness?.planningGuidanceMode || "separate_model").trim().toLowerCase();
}

function shouldUseSeparateModel(meta = {}) {
  return resolvePlanningGuidanceMode(meta) === "separate_model";
}

function resolveCapabilityModelInvoker(meta = {}) {
  return typeof meta?.harness?.capabilityModelInvoker === "function"
    ? meta.harness.capabilityModelInvoker
    : null;
}

function resolveCapabilityToolAllowlist(meta = {}, purpose = "") {
  const normalizedPurpose = String(purpose || "").trim();
  const byPurpose =
    meta?.harness?.capabilityToolAllowlistByPurpose &&
    typeof meta.harness.capabilityToolAllowlistByPurpose === "object"
      ? meta.harness.capabilityToolAllowlistByPurpose
      : {};
  const scoped = Array.isArray(byPurpose?.[normalizedPurpose]) ? byPurpose[normalizedPurpose] : null;
  if (scoped) {
    return scoped.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const globalAllowlist = Array.isArray(meta?.harness?.capabilityToolAllowlist)
    ? meta.harness.capabilityToolAllowlist
    : [];
  return globalAllowlist.map((item) => String(item || "").trim()).filter(Boolean);
}

function shouldProcessPrimaryToolHooks(ctx = {}) {
  const scope = String(ctx?.executionScope || "").trim().toLowerCase();
  if (!scope) return true;
  return scope === "primary";
}

function cleanupInternalForcedMessages(messages = []) {
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

function sanitizeInternalMessages(ctx = {}) {
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

function disableBlockedToolsInRegistry(ctx = {}) {
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

function disableBlockedCalls(calls = []) {
  if (!Array.isArray(calls)) return false;
  const next = calls.filter((call) => !BLOCKED_AGENT_TOOL_NAMES.has(String(call?.name || "").trim()));
  if (next.length === calls.length) return false;
  calls.splice(0, calls.length, ...next);
  return true;
}

function extractRawTextContent(input) {
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

function extractJsonObjectFromText(text = "") {
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

function normalizeChecklistItem(item = {}, index = 0, locale = LOCALE.ZH_CN) {
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
  };
}

function parseTaskChecklistFromModelOutput(text = "", locale = LOCALE.ZH_CN) {
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

function defaultTaskChecklist(locale = LOCALE.ZH_CN) {
  const owner = getDefaultTaskOwner(locale);
  const template = getTaskTemplate(locale);
  return [
    { index: 1, task: template.PARSE_ATTACHMENT, owner, subOwners: [] },
    { index: 2, task: template.EXECUTE_CORE, owner, subOwners: [] },
    {
      index: 3,
      task: template.START_SUBTASK,
      owner,
      subOwners: getDefaultSubtaskOwners(locale),
    },
    { index: 4, task: template.WAIT_SUBTASK_RESULT, owner, subOwners: [] },
  ];
}

function evaluateTaskStatus(task = {}, state = {}) {
  const text = String(task?.task || "").toLowerCase();
  const signals = state?.signals || {};
  if (text.includes("附件") || text.includes("attachment")) {
    return signals.parsedAttachment ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING;
  }
  if ((text.includes("子任务") && text.includes("开启")) || (text.includes("subtask") && text.includes("start"))) {
    return signals.subtaskStarted ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING;
  }
  if ((text.includes("等待") && text.includes("子任务")) || (text.includes("wait") && text.includes("subtask"))) {
    return signals.subtaskWaited ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING;
  }
  return signals.successfulToolCount > 0 ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.PENDING;
}

function buildAcceptanceReport({ bucket = {}, state = {}, mode = ACCEPTANCE_MODE.ACTIVE } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  const checklist = Array.isArray(bucket.taskChecklist) && bucket.taskChecklist.length
    ? bucket.taskChecklist
    : defaultTaskChecklist(locale);
  const items = checklist.map((task, index) => {
    const normalized = normalizeChecklistItem(task, index, locale);
    return {
      ...normalized,
      status: evaluateTaskStatus(normalized, state),
    };
  });
  return {
    mode,
    acceptedAt: new Date().toISOString(),
    summary: {
      total: items.length,
      completed: items.filter((item) => item.status === TASK_STATUS.COMPLETED).length,
      inProgress: items.filter((item) => item.status === TASK_STATUS.IN_PROGRESS).length,
      pending: items.filter((item) => item.status === TASK_STATUS.PENDING).length,
    },
    taskChecklist: items,
  };
}


function parseSemanticValidationResult(responseText = "") {
  const parsed = extractJsonObjectFromText(responseText);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  return {
    status: "warn",
    consistent: false,
    raw: String(responseText || "").trim(),
  };
}

async function runAcceptanceBySeparateModel(ctx = {}, meta = {}, baseReport = null) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder || !baseReport) return false;
  const { bucket, state } = holder;
  const acceptanceOptions = meta?.harness?.acceptance && typeof meta.harness.acceptance === "object"
    ? meta.harness.acceptance
    : {};
  if (acceptanceOptions.semanticValidation !== true) return false;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  const locale = state?.locale || LOCALE.ZH_CN;
  const finalOutput = String(ctx?.result?.output || "").trim();
  const prompt = [
    locale === LOCALE.EN_US
      ? "Validate semantic consistency between the task checklist, acceptance report, tool signals, and final output. Return JSON only."
      : "请验证任务清单、规则验收报告、工具信号与最终输出之间的语义一致性。只返回 JSON。",
    JSON.stringify({
      expectedSchema: {
        status: "pass|warn|fail",
        consistent: true,
        missingItems: [],
        unsupportedClaims: [],
        checklistCoverage: [
          { index: 1, task: "...", covered: true, evidence: "...", risk: "low|medium|high" },
        ],
        suggestions: [],
      },
      taskChecklist: bucket.taskChecklist || [],
      acceptanceReport: baseReport,
      toolSignals: state.signals || {},
      finalOutput,
    }, null, 2),
  ].join("\n");
  let response = null;
  try {
    response = await invoker({
      purpose: "acceptance_semantic_validation",
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      locale,
      prompt,
      messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
      ctx,
      baseReport,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, "acceptance_semantic_validation"),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "acceptance_semantic_validation_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    purpose: "acceptance_semantic_validation",
    response,
  });
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  baseReport.semanticValidation = parseSemanticValidationResult(responseText);
  bucket.lastAcceptanceReport = baseReport;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: "acceptance_semantic_validation_completed",
    detail: { status: baseReport.semanticValidation?.status, consistent: baseReport.semanticValidation?.consistent },
  });
  return true;
}

function createRequestTaskAcceptanceTool({ bucket = {}, state = {}, ctx = {}, meta = {} } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  const modeDescription =
    locale === LOCALE.EN_US
      ? "Acceptance mode: active or forced."
      : "验收模式：active(主动) 或 forced(强行)。";
  return new DynamicStructuredTool({
    name: TASK_ACCEPTANCE_TOOL_NAME,
    description: t(locale, "taskAcceptanceToolDescription"),
    schema: z.object({
      mode: z
        .enum([ACCEPTANCE_MODE.ACTIVE, ACCEPTANCE_MODE.FORCED])
        .optional()
        .describe(modeDescription),
    }),
    async func(args = {}, _runManager = null, config = {}) {
      const toolCtx = config?.configurable?.noobotHookContext || ctx;
      const toolMeta = config?.configurable?.noobotHookMeta || meta;
      const requestedMode = String(args?.mode || ACCEPTANCE_MODE.ACTIVE).trim().toLowerCase();
      const mode = requestedMode === ACCEPTANCE_MODE.FORCED ? ACCEPTANCE_MODE.FORCED : ACCEPTANCE_MODE.ACTIVE;
      state.flags.acceptanceRequested = true;
      const report = buildAcceptanceReport({ bucket, state, mode });
      bucket.lastAcceptanceReport = report;
      bucket.acceptanceReports.push(report);
      await runAcceptanceBySeparateModel(toolCtx, toolMeta, report);
      return {
        ok: true,
        status: "completed",
        tool: TASK_ACCEPTANCE_TOOL_NAME,
        report,
      };
    },
  });
}

function ensureTaskAcceptanceTool(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return false;
  if (registry.some((tool) => String(tool?.name || "").trim() === TASK_ACCEPTANCE_TOOL_NAME)) {
    return false;
  }
  registry.push(createRequestTaskAcceptanceTool({ bucket, state, ctx, meta }));
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "task_acceptance_tool_injected",
  });
  return true;
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
      t(locale, "planningPromptMarker"),
      t(locale, "planningPromptLine1"),
      t(locale, "planningPromptLine2", {
        example: `{"taskOwner":"${getDefaultTaskOwner(locale)}","taskChecklist":[{"index":1,"task":"${getTaskTemplate(locale).PARSE_ATTACHMENT}","owner":"${getDefaultTaskOwner(locale)}"}]}`,
      }),
      t(locale, "planningPromptLine3"),
    ].join("\n"),
  });
  state.flags.planningPromptInjected = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_prompt_injected",
  });
  return true;
}

function enablePlanningForceToolRetry(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (state.flags.planningCaptured === true) return false;
  if (state.flags.planningForceToolTemporarilyEnabled === true) return false;
  const runtimeConfig = ctx?.agentContext?.execution?.controllers?.runtime?.systemRuntime?.config;
  if (!runtimeConfig || typeof runtimeConfig !== "object") return false;
  state.flags.planningForceToolOriginalSet = Object.prototype.hasOwnProperty.call(runtimeConfig, "forceTool");
  state.flags.planningForceToolOriginal = Boolean(runtimeConfig?.forceTool);
  runtimeConfig.forceTool = true;
  state.flags.planningForceToolTemporarilyEnabled = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_force_tool_retry_enabled",
  });
  return true;
}

function restorePlanningForceToolRetry(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (state.flags.planningForceToolTemporarilyEnabled !== true) return false;
  const runtimeConfig = ctx?.agentContext?.execution?.controllers?.runtime?.systemRuntime?.config;
  if (!runtimeConfig || typeof runtimeConfig !== "object") return false;
  if (state.flags.planningForceToolOriginalSet === true) {
    runtimeConfig.forceTool = Boolean(state.flags.planningForceToolOriginal);
  } else {
    delete runtimeConfig.forceTool;
  }
  state.flags.planningForceToolTemporarilyEnabled = false;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_force_tool_retry_restored",
  });
  return true;
}

async function runPlanningBySeparateModel(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.planningCaptured === true) return false;
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
  const locale = state?.locale || LOCALE.ZH_CN;
  const planningPrompt = [
    t(locale, "planningPromptLine1"),
    t(locale, "planningPromptLine2", {
      example: `{"taskOwner":"${getDefaultTaskOwner(locale)}","taskChecklist":[{"index":1,"task":"${getTaskTemplate(locale).PARSE_ATTACHMENT}","owner":"${getDefaultTaskOwner(locale)}"}]}`,
    }),
    t(locale, "planningPromptLine3"),
  ].join("\n");
  let response = null;
  try {
    response = await invoker({
      purpose: "planning",
      domain: CAPABILITY_DOMAIN.PLANNING,
      locale,
      prompt: planningPrompt,
      messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
      ctx,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, "planning"),
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
  const parsed = parseTaskChecklistFromModelOutput(responseText, locale);
  if (parsed.length) {
    bucket.taskChecklist = parsed;
    bucket.taskChecklistSource = "model";
  } else if (!Array.isArray(bucket.taskChecklist) || !bucket.taskChecklist.length) {
    bucket.taskChecklist = defaultTaskChecklist(locale);
    bucket.taskChecklistSource = "default";
  } else if (!String(bucket?.taskChecklistSource || "").trim()) {
    bucket.taskChecklistSource = "existing";
  }
  bucket.taskOwner = getDefaultTaskOwner(locale);
  state.flags.planningCaptured = true;
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "planning",
    content: responseText,
  });
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_checklist_captured_by_separate_model",
    detail: {
      checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
      source: String(bucket?.taskChecklistSource || "").trim() || (parsed.length ? "model" : "default"),
    },
  });
  return true;
}

function maybeCapturePlanningResult(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.planningCaptured === true) return false;
  if (state.flags.planningPromptInjected !== true) return false;
  const sourceContent =
    extractRawTextContent(ctx?.ai?.content) ||
    extractRawTextContent(ctx?.modelResponse?.content) ||
    "";
  const locale = state?.locale || LOCALE.ZH_CN;
  const parsed = parseTaskChecklistFromModelOutput(sourceContent, locale);
  bucket.taskChecklist = parsed.length ? parsed : defaultTaskChecklist(locale);
  bucket.taskOwner = getDefaultTaskOwner(locale);
  state.flags.planningCaptured = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_checklist_captured",
    detail: { checklistCount: bucket.taskChecklist.length, source: parsed.length ? "model" : "default" },
  });
  return true;
}

function markToolSignals(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const toolName = String(ctx?.toolName || ctx?.call?.name || "").trim();
  if (!toolName) return false;
  let changed = false;
  if (ctx?.success === true) {
    state.signals.successfulToolCount += 1;
    if (
      [
        TOOL_NAME_SET.MEDIA_TO_DATA,
        TOOL_NAME_SET.DOC_TO_DATA,
        TOOL_NAME_SET.WEB_TO_DATA,
        TOOL_NAME_SET.PROCESS_CONTENT_TASK,
      ].includes(toolName)
    ) {
      state.signals.parsedAttachment = true;
      changed = true;
    }
    if ([TOOL_NAME_SET.DELEGATE_TASK_ASYNC, TOOL_NAME_SET.PLAN_MULTI_TASK_COLLABORATION].includes(toolName)) {
      state.signals.subtaskStarted = true;
      changed = true;
    }
    if (toolName === TOOL_NAME_SET.WAIT_ASYNC_TASK_RESULT) {
      state.signals.subtaskWaited = true;
      changed = true;
    }
  }
  if (ctx?.commitType === "attachment_metas" && Array.isArray(ctx?.payload?.attachmentMetas) && ctx.payload.attachmentMetas.length) {
    state.signals.parsedAttachment = true;
    changed = true;
  }
  return changed;
}

function updateFailureCounters(ctx = {}, failed = false) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (failed) {
    state.counters.consecutiveToolFailures += 1;
    state.counters.totalToolFailures += 1;
    if (state.counters.consecutiveToolFailures >= FAILURE_THRESHOLD.CONSECUTIVE) {
      state.pending.guidance = GUIDANCE_REASON.CONSECUTIVE_FAILURES;
    } else if (state.counters.totalToolFailures >= FAILURE_THRESHOLD.ACCUMULATED) {
      state.pending.guidance = GUIDANCE_REASON.ACCUMULATED_FAILURES;
    }
    return true;
  }
  state.counters.consecutiveToolFailures = 0;
  return true;
}

function maybeInjectGuidanceOrSummaryPrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;

  if (state.pending.summary === true) {
    messages.unshift({
      role: "system",
      content: [
        t(locale, "guidanceSummaryMarker"),
        t(locale, "guidanceSummaryBody"),
      ].join("\n"),
    });
    state.pending.summary = false;
    state.counters.llmTurns = 0;
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_prompt_injected",
    });
    return true;
  }

  if (!state.pending.guidance) return false;
  const reason = state.pending.guidance;
  messages.unshift({
    role: "system",
    content: [
      t(locale, "guidanceMarker"),
      t(locale, "guidanceBody", { reason }),
      t(locale, "guidancePreferTools", { tools: GUIDANCE_WEB_TOOL_NAMES.join(", ") }),
      t(locale, "guidanceWebService", {
        service: GUIDANCE_WEB_SERVICE_NAME,
        tool: TOOL_NAME_SET.CALL_SERVICE,
      }),
    ].join("\n"),
  });
  state.pending.guidance = null;
  state.counters.consecutiveToolFailures = 0;
  state.counters.totalToolFailures = 0;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: "guidance_prompt_injected",
    detail: { reason },
  });
  return true;
}

async function runGuidanceBySeparateModel(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  const locale = state?.locale || LOCALE.ZH_CN;

  let purpose = "";
  let prompt = "";
  let reason = "";
  if (state.pending.summary === true) {
    purpose = "summary";
    prompt = t(locale, "guidanceSummaryBody");
    state.pending.summary = false;
    state.counters.llmTurns = 0;
  } else if (state.pending.guidance) {
    purpose = "guidance";
    reason = state.pending.guidance;
    prompt = [
      t(locale, "guidanceBody", { reason }),
      t(locale, "guidancePreferTools", { tools: GUIDANCE_WEB_TOOL_NAMES.join(", ") }),
      t(locale, "guidanceWebService", {
        service: GUIDANCE_WEB_SERVICE_NAME,
        tool: TOOL_NAME_SET.CALL_SERVICE,
      }),
    ].join("\n");
    state.pending.guidance = null;
    state.counters.consecutiveToolFailures = 0;
    state.counters.totalToolFailures = 0;
  } else {
    return false;
  }

  let response = null;
  try {
    response = await invoker({
      purpose,
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      locale,
      prompt,
      messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
      ctx,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, purpose),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "guidance_separate_model_call_failed",
      detail: { purpose, error: String(error?.message || error || "") },
    });
    return false;
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    purpose,
    response,
  });
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  if (!Array.isArray(bucket.guidanceOutputs)) {
    bucket.guidanceOutputs = [];
  }
  bucket.guidanceOutputs.push({
    purpose,
    reason: reason || undefined,
    content: responseText,
    timestamp: new Date().toISOString(),
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose,
    content: responseText,
  });
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event:
      purpose === "summary"
        ? "summary_generated_by_separate_model"
        : "guidance_generated_by_separate_model",
    detail: { reason: reason || undefined },
  });
  return true;
}

async function maybeAttachChecklistArtifactsAtFinalOutput(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.checklistArtifactsAttached === true) return false;

  const runtime = ctx?.agentContext?.execution?.controllers?.runtime || null;
  const attachmentService = runtime?.attachmentService || null;
  if (!attachmentService || typeof attachmentService.ingestGeneratedArtifacts !== "function") {
    return false;
  }
  const userId = String(
    ctx?.userId || runtime?.systemRuntime?.userId || runtime?.userId || "",
  ).trim();
  const sessionId = String(
    ctx?.sessionId || runtime?.systemRuntime?.sessionId || runtime?.sessionId || "",
  ).trim();
  if (!userId || !sessionId) return false;

  const locale = state?.locale || LOCALE.ZH_CN;
  const checklist = Array.isArray(bucket?.taskChecklist) && bucket.taskChecklist.length
    ? bucket.taskChecklist
    : defaultTaskChecklist(locale);
  const acceptanceReport =
    bucket?.lastAcceptanceReport && typeof bucket.lastAcceptanceReport === "object"
      ? bucket.lastAcceptanceReport
      : buildAcceptanceReport({ bucket, state, mode: ACCEPTANCE_MODE.FORCED });

  const artifacts = [
    {
      name: "harness-task-checklist.json",
      mimeType: "application/json",
      contentBase64: Buffer.from(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            taskOwner: bucket?.taskOwner || getDefaultTaskOwner(locale),
            taskChecklist: checklist,
          },
          null,
          2,
        ),
        "utf8",
      ).toString("base64"),
    },
    {
      name: "harness-acceptance-checklist.json",
      mimeType: "application/json",
      contentBase64: Buffer.from(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            report: acceptanceReport,
          },
          null,
          2,
        ),
        "utf8",
      ).toString("base64"),
    },
  ];

  let savedRecords = [];
  try {
    savedRecords = await attachmentService.ingestGeneratedArtifacts({
      userId,
      sessionId,
      attachmentSource: "model",
      generationSource: "harness_checklist",
      artifacts,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "checklist_artifact_attach_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }

  const metas = mapAttachmentRecordsToMetas(savedRecords);
  if (!metas.length) return false;
  if (runtime && typeof runtime === "object") {
    runtime.attachmentMetas = mergeAttachmentMetas(runtime?.attachmentMetas, metas);
  }
  attachArtifactsToAssistantResult(ctx, metas);
  state.flags.checklistArtifactsAttached = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: "checklist_artifacts_attached",
    detail: { attachmentCount: metas.length },
  });
  return true;
}

async function maybeForceAcceptanceAtFinalOutput(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.acceptanceRequested === true) return false;
  const report = buildAcceptanceReport({ bucket, state, mode: ACCEPTANCE_MODE.FORCED });
  bucket.lastAcceptanceReport = report;
  bucket.acceptanceReports.push(report);
  if (ctx?.result && typeof ctx.result === "object") {
    await runAcceptanceBySeparateModel(ctx, meta, report);
    const locale = state?.locale || LOCALE.ZH_CN;
    const original = String(ctx.result.output || "").trim();
    ctx.result.output = [
      original,
      "",
      t(locale, "forcedAcceptanceHeader"),
      JSON.stringify(report, null, 2),
    ].filter(Boolean).join("\n");
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "forced_acceptance_triggered",
    });
    return true;
  }
  return false;
}

async function handleAcceptanceLifecycle(point = "", ctx = {}, meta = {}) {
  let changed = false;
  if (point === "before_turn") {
    changed = disableBlockedToolsInRegistry(ctx) || changed;
    changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
  }
  if (point === "before_tool_calls") {
    changed = disableBlockedCalls(ctx?.calls || []) || changed;
    changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
  }
  if (point === "before_tool_call" && BLOCKED_AGENT_TOOL_NAMES.has(String(ctx?.call?.name || "").trim())) {
    ctx.call.name = TASK_ACCEPTANCE_TOOL_NAME;
    ctx.call.args = { mode: ACCEPTANCE_MODE.ACTIVE };
    changed = true;
  }
  if (point === "before_final_output") {
    changed = (await maybeForceAcceptanceAtFinalOutput(ctx, meta)) || changed;
    changed = (await maybeAttachChecklistArtifactsAtFinalOutput(ctx)) || changed;
  }
  return changed;
}

function buildReviewReport(point = "", ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return null;
  const { bucket, state } = holder;
  const acceptance = bucket.lastAcceptanceReport || null;
  const status = String(ctx?.status || "").trim() ||
    (["on_error", "context_build_error", "llm_call_error", "tool_call_error"].includes(point)
      ? "error"
      : point === "on_abort"
        ? "abort"
        : "reviewed");
  const issues = [];
  if (state.flags.planningCaptured !== true) issues.push("planning_not_captured");
  if (acceptance?.summary?.pending > 0) issues.push("acceptance_has_pending_items");
  const semanticValidation = acceptance?.semanticValidation || null;
  if (semanticValidation && (semanticValidation.consistent === false || String(semanticValidation.status || "").toLowerCase() === "fail")) {
    issues.push("acceptance_semantic_validation_failed_or_inconsistent");
  }
  if (state.counters.totalToolFailures > 0) issues.push("tool_failures_observed");
  if (ctx?.error) issues.push("runtime_error_observed");
  return {
    point,
    status,
    reviewedAt: new Date().toISOString(),
    summary: {
      planningCaptured: state.flags.planningCaptured === true,
      acceptanceRequested: state.flags.acceptanceRequested === true,
      successfulToolCount: state.signals.successfulToolCount || 0,
      totalToolFailures: state.counters.totalToolFailures || 0,
      pendingAcceptanceItems: acceptance?.summary?.pending ?? null,
      semanticValidationStatus: semanticValidation?.status ?? null,
      semanticValidationConsistent: semanticValidation?.consistent ?? null,
      issues,
    },
    acceptanceReport: acceptance || undefined,
    error: ctx?.error ? String(ctx.error?.message || ctx.error || "") : undefined,
  };
}

function appendReviewReport(point = "", ctx = {}, { attachToFinalOutput = false } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const report = buildReviewReport(point, ctx);
  if (!report) return false;
  bucket.lastReviewReport = report;
  bucket.reviewReports.push(report);
  if (attachToFinalOutput && ctx?.result && typeof ctx.result === "object") {
    const locale = state?.locale || LOCALE.ZH_CN;
    const original = String(ctx.result.output || "").trim();
    ctx.result.output = [original, "", t(locale, "reviewHeader"), JSON.stringify(report, null, 2)]
      .filter(Boolean)
      .join("\n");
  }
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.REVIEW,
    event: "review_report_generated",
    detail: { point, issues: report.summary.issues },
  });
  return true;
}

function createNoopHandler(capability = "") {
  return async ({ point = "" } = {}) => ({
    capability,
    point,
    implemented: false,
    status: "planned",
  });
}

export function createDefaultCapabilityHandlers() {
  const fallback = HARNESS_ENGINEERING_CAPABILITIES.reduce((acc, capability) => {
    acc[capability] = createNoopHandler(capability);
    return acc;
  }, {});

  fallback.planning = async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (point === "before_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      if (holder) {
        holder.state.counters.llmTurns += 1;
        if (holder.state.counters.llmTurns > LLM_SUMMARY_THRESHOLD) {
          holder.state.pending.summary = true;
        }
      }
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
      changed = maybeCapturePlanningResult(ctx) || changed;
    }
    return { capability, point, status: "active", changed };
  };

  fallback.guidance = async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (point === "before_llm_call") {
      if (shouldUseSeparateModel(meta)) {
        changed = (await runGuidanceBySeparateModel(ctx, meta)) || changed;
      } else {
        changed = maybeInjectGuidanceOrSummaryPrompt(ctx) || changed;
      }
    }
    if (point === "after_tool_call" && shouldProcessPrimaryToolHooks(ctx)) {
      changed = markToolSignals(ctx) || changed;
      const failed = ctx?.success === false;
      changed = updateFailureCounters(ctx, failed) || changed;
    }
    if (point === "tool_call_error" && shouldProcessPrimaryToolHooks(ctx)) {
      changed = updateFailureCounters(ctx, true) || changed;
    }
    return { capability, point, status: "active", changed };
  };

  fallback.acceptance = async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    if (
      ["before_tool_calls", "before_tool_call", "after_tool_call", "tool_call_error"].includes(
        String(point || "").trim(),
      ) &&
      !shouldProcessPrimaryToolHooks(ctx)
    ) {
      return { capability, point, status: "active", changed: false };
    }
    const changed = await handleAcceptanceLifecycle(point, ctx, meta);
    return { capability, point, status: "active", changed };
  };

  fallback.review = async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    const hook = String(point || "").trim();
    const reviewOptions = meta?.harness?.review && typeof meta.harness.review === "object"
      ? meta.harness.review
      : {};
    const attachToFinalOutput = hook === "before_final_output" && reviewOptions.attachToFinalOutput !== false;
    const changed = appendReviewReport(point, ctx, { attachToFinalOutput });
    return { capability, point, status: "active", changed };
  };

  return fallback;
}

export function resolveCapabilityHandlers(handlers = {}) {
  const incoming = handlers && typeof handlers === "object" ? handlers : {};
  const fallback = createDefaultCapabilityHandlers();
  return HARNESS_ENGINEERING_CAPABILITIES.reduce((acc, capability) => {
    const candidate = incoming[capability];
    acc[capability] = typeof candidate === "function" ? candidate : fallback[capability];
    return acc;
  }, {});
}
