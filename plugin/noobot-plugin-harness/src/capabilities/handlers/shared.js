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

export const FAILURE_THRESHOLD = Object.freeze({
  CONSECUTIVE: 3,
  ACCUMULATED: 10,
});

export const LLM_SUMMARY_THRESHOLD = 15;

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
    planningPromptLine1: "任务：基于完整 context 与场景全部工具，生成流程任务清单。",
    planningPromptLine2: "输出：只输出 JSON，格式：{example}",
    planningPromptLine3: "限制：输出清单后继续执行，不要直接结束；可包含 subOwners。",
    planningPromptLine4: "限制：工具范围使用通配符 *（表示全量工具）。",
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
    planningPromptLine1: "Task: generate a workflow checklist from the full context and all scene tools.",
    planningPromptLine2: "Output: JSON only. Format: {example}",
    planningPromptLine3: "Constraints: continue execution after checklist; do not stop. subOwners is optional.",
    planningPromptLine4: "Constraints: tool scope must use wildcard * (all tools).",
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

export const BLOCKED_AGENT_TOOL_NAMES = new Set([
  TOOL_NAME_SET.PLAN_MULTI_TASK_COLLABORATION,
  "request_help",
  "task_summary",
]);

export const GUIDANCE_WEB_SERVICE_NAME = "web_search_service";
export const GUIDANCE_WEB_TOOL_NAMES = [TOOL_NAME_SET.CALL_SERVICE];
export const TASK_ACCEPTANCE_TOOL_NAME = "request_task_acceptance";

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
      guidanceSummaryMarkPending: false,
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
  if (state.flags.guidanceSummaryMarkPending === undefined) {
    state.flags.guidanceSummaryMarkPending = false;
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
  { locale = LOCALE.ZH_CN, purpose = "", content = "" } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  const text = String(content || "").trim();
  if (!messages || !text) return false;
  const prefix = translateI18nText(locale, "separateModelRelayPrefix", {
    purpose: String(purpose || "").trim() || "unknown",
  });
  messages.push({
    role: "user",
    content: `${prefix}\n${text}`,
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
  const allowlist = resolveCapabilityToolAllowlist(meta, "planning");
  if (!Array.isArray(allowlist) || !allowlist.length) return ["*"];
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

export function markMessagesSummarized(messages = []) {
  if (!Array.isArray(messages)) return 0;
  let changedCount = 0;
  for (const messageItem of messages) {
    if (!messageItem || typeof messageItem !== "object") continue;
    const role = String(messageItem?.role || messageItem?.lc_kwargs?.role || "").trim().toLowerCase();
    if (role === "system") continue;
    if (markMessageSummarized(messageItem)) {
      changedCount += 1;
    }
  }
  return changedCount;
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

export function defaultTaskChecklist(locale = LOCALE.ZH_CN) {
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
