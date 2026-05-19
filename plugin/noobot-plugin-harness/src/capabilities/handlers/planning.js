import { ensureTaskAcceptanceTool } from "./acceptance.js";
import {
  CAPABILITY_DOMAIN,
  LLM_SUMMARY_THRESHOLD,
  LOCALE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  extractRawTextContent,
  getDefaultTaskOwner,
  getTaskTemplate,
  parseTaskChecklistFromModelOutput,
  relaySeparateModelOutputAsUserMessage,
  resolveCapabilityModelInvoker,
  resolvePlanningToolAllowlist,
  resolveSceneToolNames,
  safeJsonStringify,
  sanitizeInternalMessages,
  shouldUseSeparateModel,
  translateI18nText,
} from "./shared.js";

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
        example: `{"taskOwner":"${getDefaultTaskOwner(locale)}","taskChecklist":[{"index":1,"task":"${getTaskTemplate(locale).PARSE_ATTACHMENT}","owner":"${getDefaultTaskOwner(locale)}"}]}`,
      }),
      translateI18nText(locale, "planningPromptLine3"),
      translateI18nText(locale, "planningPromptLine4"),
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
  if (!sanitized || sanitized === raw) return [];
  return parseTaskChecklistFromModelOutput(sanitized, locale);
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
          'Preferred format: {"taskOwner":"...","taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[]}]}',
          "If content cannot be repaired into checklist JSON, output {}.",
          "",
          content,
        ].join("\n")
      : [
          "请把以下文本修复为严格 JSON，只输出 JSON。",
          "输出只能是 JSON 对象或数组。",
          '优先格式：{"taskOwner":"...","taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[]}]}',
          "如果无法修复为清单 JSON，请输出 {}。",
          "",
          content,
        ].join("\n");
  let response = null;
  try {
    response = await invoker({
      purpose: "planning_json_repair",
      domain: CAPABILITY_DOMAIN.PLANNING,
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
  const planningMessages = Array.isArray(ctx?.messages) ? [...ctx.messages] : [];
  planningMessages.unshift({
    role: "system",
    content:
      locale === LOCALE.EN_US
        ? `Context input (ctx) for planning. Must be fully considered:\n\`\`\`json\n${safeJsonStringify(ctx)}\n\`\`\``
        : `规划输入上下文(ctx)如下，必须完整参考：\n\`\`\`json\n${safeJsonStringify(ctx)}\n\`\`\``,
  });
  const planningPromptBase = [
    translateI18nText(locale, "planningPromptLine1"),
    translateI18nText(locale, "planningPromptLine2", {
      example: `{"taskOwner":"${getDefaultTaskOwner(locale)}","taskChecklist":[{"index":1,"task":"${getTaskTemplate(locale).PARSE_ATTACHMENT}","owner":"${getDefaultTaskOwner(locale)}"}]}`,
    }),
    translateI18nText(locale, "planningPromptLine3"),
    translateI18nText(locale, "planningPromptLine4"),
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
  let response = null;
  try {
    response = await invoker({
      purpose: "planning",
      domain: CAPABILITY_DOMAIN.PLANNING,
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
  let parsed = parseChecklistWithLocalRepair(responseText, locale);
  if (!parsed.length && hasJsonFeature(responseText)) {
    parsed = await repairChecklistByModel({
      invoker,
      ctx,
      meta,
      locale,
      rawText: responseText,
    });
  }

  if (parsed.length) {
    bucket.taskChecklist = parsed;
    bucket.taskChecklistSource = "model";
  } else {
    bucket.taskChecklist = [];
    bucket.taskChecklistSource = "none";
  }
  bucket.taskOwner = getDefaultTaskOwner(locale);
  state.flags.planningCaptured = true;
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "planning",
    content: responseText || (locale === LOCALE.EN_US ? "None" : "无"),
  });
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_checklist_captured_by_separate_model",
    detail: {
      checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
      source: String(bucket?.taskChecklistSource || "").trim() || (parsed.length ? "model" : "none"),
      emptyResponse: !String(responseText || "").trim(),
    },
  });
  return true;
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
  const locale = state?.locale || LOCALE.ZH_CN;
  let parsed = parseChecklistWithLocalRepair(sourceContent, locale);
  if (!parsed.length && hasJsonFeature(sourceContent)) {
    parsed = await repairChecklistByModel({
      invoker: resolveCapabilityModelInvoker(meta),
      ctx,
      meta,
      locale,
      rawText: sourceContent,
    });
  }
  if (parsed.length) {
    bucket.taskChecklist = parsed;
    bucket.taskChecklistSource = "model";
    bucket.taskOwner = getDefaultTaskOwner(locale);
    state.flags.planningCaptured = true;
    restorePlanningForceToolRetry(ctx);
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
  state.flags.planningCaptured = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_checklist_captured",
    detail: {
      checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
      source: "none",
      emptyResponse: !String(sourceContent || "").trim(),
    },
  });
  return true;
}

export function createPlanningHandler() {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
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
      changed = (await maybeCapturePlanningResult(ctx, meta)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}

export {
  enablePlanningForceToolRetry,
  restorePlanningForceToolRetry,
};
