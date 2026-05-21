/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureTaskAcceptanceTool } from "./acceptance.js";
import { processPlanningResult } from "./planning/result-pipeline.js";
import {
  LLM_SUMMARY_THRESHOLD,
  MAX_PLANNING_CAPTURE_ATTEMPTS,
  PLANNING_RAW_OUTPUT_LIMIT,
  PLANNING_SUMMARY_MAX_ITEMS,
  PLANNING_COMPACT_TEXT_MAX_CHARS,
  PLANNING_RAW_OUTPUT_PREVIEW_MAX_CHARS,
  PLANNING_CONTEXT_GOAL_MAX_CHARS,
} from "../../core/thresholds.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  extractRawTextContent,
  getDefaultTaskOwner,
  getTaskTemplate,
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
  messages.push({
    role: "user",
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

function compactText(text = "", maxChars = PLANNING_COMPACT_TEXT_MAX_CHARS) {
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
  if (bucket.planningRawOutputs.length > PLANNING_RAW_OUTPUT_LIMIT) {
    bucket.planningRawOutputs.splice(0, bucket.planningRawOutputs.length - PLANNING_RAW_OUTPUT_LIMIT);
  }
  bucket.lastPlanningRawOutput = entry;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_raw_output_recorded",
    detail: {
      source: entry.source,
      chars: rawText.length,
      parsedCount: entry.parsedCount,
      preview: compactText(rawText, PLANNING_RAW_OUTPUT_PREVIEW_MAX_CHARS),
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

function summarizePlanningMessages(messages = [], maxItems = PLANNING_SUMMARY_MAX_ITEMS) {
  const source = Array.isArray(messages) ? messages : [];
  const simplified = source
    .filter((item) => {
      const role = String(item?.role || "").trim().toLowerCase();
      return role === "user" || role === "assistant" || role === "tool" || role === "system";
    })
    .slice(-maxItems)
    .map((item = {}) => ({
      role: String(item?.role || "").trim(),
      content: compactText(extractRawTextContent(item?.content ?? item), PLANNING_COMPACT_TEXT_MAX_CHARS),
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
    latestUserGoal: compactText(extractRawTextContent(latestUserMessage?.content), PLANNING_CONTEXT_GOAL_MAX_CHARS),
    recentDialog: summarizePlanningMessages(messages, PLANNING_SUMMARY_MAX_ITEMS),
    sceneTools: resolveSceneToolNames(ctx),
    toolAllowlist: resolvePlanningToolAllowlist(meta),
  };
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
    translateI18nText(locale, "planningPromptMarker"),
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
  planningMessages.push({ role: "user", content: planningPromptBase });
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
        prompt: "",
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
    const processed = await processPlanningResult(ctx, meta, {
      source: "separate_model",
      rawText: responseText,
      locale,
      repairInvoker: invoker,
      appendCapabilityModelTraceLog,
    });

    if (processed.retryScheduled) {
      relaySeparateModelOutputAsUserMessage(ctx, {
        locale,
        purpose: "planning",
        content: responseText || (locale === LOCALE.EN_US ? "None" : "无"),
        dedupe: true,
      });
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_checklist_retry_scheduled_by_separate_model",
        detail: { attempts: processed.attempts, maxAttempts: MAX_PLANNING_CAPTURE_ATTEMPTS },
      });
      return true;
    }

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
        checklistCount: processed.checklistCount,
        source: processed.sourceType,
        emptyResponse: processed.emptyResponse === true,
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
  const { state } = holder;
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
  const processed = await processPlanningResult(ctx, meta, {
    source: "after_llm_call",
    rawText: sourceContent,
    locale,
    repairInvoker: resolveCapabilityModelInvoker(meta),
    appendCapabilityModelTraceLog,
  });

  if (processed.sourceType === "model") {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_checklist_captured",
      detail: {
        checklistCount: processed.checklistCount,
        source: processed.sourceType,
      },
    });
    return true;
  }

  if (processed.retryScheduled) {
    state.flags.planningPromptInjected = false;
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_checklist_retry_scheduled",
      detail: {
        attempts: processed.attempts,
        maxAttempts: MAX_PLANNING_CAPTURE_ATTEMPTS,
        emptyResponse: processed.emptyResponse === true,
      },
    });
    return true;
  }

  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_checklist_captured",
    detail: {
      checklistCount: processed.checklistCount,
      source: processed.sourceType || "default",
      emptyResponse: processed.emptyResponse === true,
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

