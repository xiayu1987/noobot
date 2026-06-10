/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  resolveDialogProcessId,
  resolveMessageDialogProcessId,
} from "../shared/runtime/dialog-process-id.js";
import { processPlanningResult } from "./result-pipeline.js";
import {
  buildPlanningMessagePlan,
  resolveLatestUserMessageText,
} from "./prompt-builder.js";
import { renderMessagePlanForSeparateModel } from "../shared/model/message-plan.js";
import {
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  PROMPT_ENVELOPE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  ensureHarnessBucket,
  extractRawTextContent,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsTransferArtifacts,
  invokeWithReasoningRetry,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelName,
  resolveCapabilityModelMessages,
  resolvePlanningToolAllowlist,
  resolveSceneToolNames,
  translateI18nText,
} from "./deps.js";
import {
  buildPostPlanUserFollowupPrompt,
  getPlanningContextSummaryHeader,
  getPlanningSeparateModelEmptyRelay,
} from "../shared/workflow/prompts.js";
import {
  compactOperationDirectoryForPrompt,
  formatOperationDirectoryForRelay,
  resolveOperationDirectoryContext,
} from "../shared/operation-directory.js";

const PLANNING_EVENTS = WORKFLOW_PARAMS.logging.events.planning;
const MAX_PLANNING_CAPTURE_ATTEMPTS = WORKFLOW_PARAMS.planning.capture.maxAttempts;
const PLANNING_RAW_OUTPUT_LIMIT = WORKFLOW_PARAMS.planning.capture.rawOutputLimit;
const PLANNING_SUMMARY_MAX_ITEMS = WORKFLOW_PARAMS.planning.capture.summaryMaxItems;
const PLANNING_COMPACT_TEXT_MAX_CHARS = WORKFLOW_PARAMS.planning.capture.compactTextMaxChars;
const PLANNING_RAW_OUTPUT_PREVIEW_MAX_CHARS =
  WORKFLOW_PARAMS.planning.capture.rawOutputPreviewMaxChars;
const PLANNING_CONTEXT_GOAL_MAX_CHARS = WORKFLOW_PARAMS.planning.capture.contextGoalMaxChars;

function compactText(text = "", maxChars = PLANNING_COMPACT_TEXT_MAX_CHARS) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}...`;
}

export function recordPlanningRawOutput(
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
    event: PLANNING_EVENTS.rawOutputRecorded,
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

function isInjectedMessage(item = {}) {
  if (!item || typeof item !== "object") return false;
  if (item?.injectedMessage === true) return true;
  if (String(item?.injectedBy || "").trim()) return true;
  const content = String(item?.content || "").trim();
  if (!content) return false;
  const relayPrefixes = [LOCALE.ZH_CN, LOCALE.EN_US]
    .map((locale) =>
      translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SEPARATE_MODEL_PREFIX, { purpose: "" }))
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return relayPrefixes.some((prefix) => content.startsWith(prefix));
}

function collectAgentStyleHistoryMessages(ctx = {}) {
  const currentDialogProcessId = resolveDialogProcessId({
    ctx,
    messages: ctx?.agentContext?.payload?.messages?.history,
  });
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
      if (!isInjectedMessage(msg)) return true;
      if (!currentDialogProcessId) return false;
      return (
        resolveMessageDialogProcessId(msg) === currentDialogProcessId
      );
    })
    .filter((msg) => {
      const role = String(msg?.role || "").trim().toLowerCase();
      if (!role) return false;
      if (role !== "tool") return true;
      const toolCallId = String(msg?.tool_call_id || "").trim();
      return !toolCallId || knownToolCallIds.has(toolCallId);
    })
    .slice(-WORKFLOW_PARAMS.contextWindow.capabilityModelRecentMessageLimit)
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
  const unifiedMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "planning",
  });
  const messages = Array.isArray(unifiedMessages) && unifiedMessages.length
    ? unifiedMessages
    : collectAgentStyleHistoryMessages(ctx);
  const latestUserMessage = [...messages]
    .reverse()
    .find((item) => String(item?.role || "").trim().toLowerCase() === "user");
  const latestUserGoalText =
    resolveLatestUserMessageText(ctx) ||
    compactText(extractRawTextContent(latestUserMessage?.content), PLANNING_CONTEXT_GOAL_MAX_CHARS);
  return {
    locale,
    turn: Number.isFinite(Number(ctx?.turn)) ? Number(ctx.turn) : undefined,
    latestUserGoal: compactText(latestUserGoalText, PLANNING_CONTEXT_GOAL_MAX_CHARS),
    operationDirectory: compactOperationDirectoryForPrompt(resolveOperationDirectoryContext(ctx)),
    sceneTools: resolveSceneToolNames(ctx),
    toolAllowlist: resolvePlanningToolAllowlist(meta),
  };
}

function buildPlanningMessagesForSeparateModel(ctx = {}, meta = {}, locale = LOCALE.ZH_CN) {
  const contextSummary = buildPlanningContextSummary(ctx, meta, locale);
  const agentMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "planning",
  });
  const messagePlan = buildPlanningMessagePlan(locale, ctx, meta, {
    contextSummaryContent:
      `${getPlanningContextSummaryHeader(locale)}\n\`\`\`json\n${JSON.stringify(contextSummary, null, 2)}\n\`\`\``,
  });
  const messages = renderMessagePlanForSeparateModel({
    locale,
    agentMessages,
    plan: messagePlan,
  });
  return messages;
}

function extractPlanningResponseText(response = null) {
  return (
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim()
  );
}

function extractAfterCallContent(ctx = {}) {
  return (
    extractRawTextContent(ctx?.ai?.content) ||
    extractRawTextContent(ctx?.modelResponse?.content) ||
    ""
  );
}

function hasToolCallOnlyWithoutText(ctx = {}, sourceContent = "") {
  const hasToolCalls =
    Array.isArray(ctx?.ai?.tool_calls) ||
    Array.isArray(ctx?.ai?.toolCalls) ||
    Array.isArray(ctx?.modelResponse?.tool_calls) ||
    Array.isArray(ctx?.modelResponse?.toolCalls) ||
    String(ctx?.modelResponse?.finish_reason || "").trim() === "tool_calls";
  return hasToolCalls && !String(sourceContent || "").trim();
}

function shouldBlockToolCallOnlyTurn(meta = {}) {
  const allowlist = resolvePlanningToolAllowlist(meta);
  if (!Array.isArray(allowlist) || !allowlist.length) return true;
  if (allowlist.includes("*")) return false;
  return false;
}

function logPlanningCaptureResult(ctx = {}, processed = {}, {
  event = PLANNING_EVENTS.checklistCaptured,
  defaultSource = "default",
} = {}) {
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event,
    detail: {
      checklistCount: processed?.checklistCount,
      source: processed?.sourceType || defaultSource,
      emptyResponse: processed?.emptyResponse === true,
    },
  });
}

function handleAfterLlmPlanningProcessResult(ctx = {}, processed = {}, state = {}) {
  if (processed.sourceType === "model") {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: PLANNING_EVENTS.checklistCaptured,
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
      event: PLANNING_EVENTS.checklistRetryScheduled,
      detail: {
        attempts: processed.attempts,
        maxAttempts: MAX_PLANNING_CAPTURE_ATTEMPTS,
        emptyResponse: processed.emptyResponse === true,
      },
    });
    return true;
  }

  logPlanningCaptureResult(ctx, processed, {
    event: PLANNING_EVENTS.checklistCaptured,
    defaultSource: "default",
  });
  return true;
}

async function handleSeparateModelPlanningProcessResult(
  ctx = {},
  processed = {},
  locale = LOCALE.ZH_CN,
  responseText = "",
) {
  const operationDirectory = resolveOperationDirectoryContext(ctx);
  const relayText = [
    responseText || getPlanningSeparateModelEmptyRelay(locale),
    formatOperationDirectoryForRelay(operationDirectory),
  ].filter(Boolean).join("\n\n");
  const attachmentMetas = await saveCapabilityOutputAsTransferArtifacts(ctx, {
    purpose: "planning",
    content: relayText,
    generationSource: "harness_planning",
    domain: CAPABILITY_DOMAIN.PLANNING,
  });
  if (processed.retryScheduled) {
    relaySeparateModelOutputAsUserMessage(ctx, {
      locale,
      purpose: "planning",
      content: relayText,
      dedupe: true,
      attachmentMetas,
    });
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: PLANNING_EVENTS.checklistRetryScheduledBySeparateModel,
      detail: { attempts: processed.attempts, maxAttempts: MAX_PLANNING_CAPTURE_ATTEMPTS },
    });
    return true;
  }

  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "planning",
    content: relayText,
    dedupe: true,
    attachmentMetas,
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "planning_followup",
    content: buildPostPlanUserFollowupPrompt(locale, "planning"),
    dedupe: true,
  });
  logPlanningCaptureResult(ctx, processed, {
    event: PLANNING_EVENTS.checklistCapturedBySeparateModel,
    defaultSource: "unknown",
  });
  return true;
}

export async function runPlanningBySeparateModel(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.planningCaptured === true) return false;
  if (state.flags.planningSeparateModelInFlight === true) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: PLANNING_EVENTS.separateModelSkippedInflight,
    });
    return false;
  }
  if (
    String(bucket?.planText || "").trim().length > 0
  ) {
    state.flags.planningCaptured = true;
    return false;
  }
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  state.flags.planningSeparateModelInFlight = true;
  const locale = state?.locale || LOCALE.ZH_CN;
  const planningMessages = buildPlanningMessagesForSeparateModel(ctx, meta, locale);
  try {
    let response = null;
    try {
      response = await invokeWithReasoningRetry({
        invoker,
        invokePayload: {
          purpose: "planning",
          promptVersion: PROMPT_ENVELOPE.VERSION,
          envelopeType: PROMPT_ENVELOPE.TYPE,
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
        },
        maxReasoningRetries: 1,
        purpose: "planning",
        domain: CAPABILITY_DOMAIN.PLANNING,
        appendCapabilityLog,
        appendModelTrace: async (retryResponse = null) => {
          await appendCapabilityModelTraceLog(ctx, meta, {
            domain: CAPABILITY_DOMAIN.PLANNING,
            purpose: "planning",
            response: retryResponse,
          });
        },
        ctx,
        meta,
      });
    } catch (error) {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: PLANNING_EVENTS.separateModelCallFailed,
        detail: { error: String(error?.message || error || "") },
      });
      return false;
    }
    const responseText = extractPlanningResponseText(response);
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
    return await handleSeparateModelPlanningProcessResult(ctx, processed, locale, responseText);
  } finally {
    state.flags.planningSeparateModelInFlight = false;
  }
}

export async function maybeCapturePlanningResult(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (state.flags.planningCaptured === true) return false;
  if (state.flags.planningPromptInjected !== true) return false;
  const sourceContent = extractAfterCallContent(ctx);
  if (hasToolCallOnlyWithoutText(ctx, sourceContent)) {
    if (!shouldBlockToolCallOnlyTurn(meta)) {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: PLANNING_EVENTS.captureSkippedForToolCallTurn,
      });
      return false;
    }
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: PLANNING_EVENTS.captureBlockedForToolCallTurn,
    });
    const locale = state?.locale || LOCALE.ZH_CN;
    const processed = await processPlanningResult(ctx, meta, {
      source: "after_llm_call_tool_calls_blocked",
      rawText: "",
      locale,
      repairInvoker: resolveCapabilityModelInvoker(meta),
      appendCapabilityModelTraceLog,
    });
    return handleAfterLlmPlanningProcessResult(ctx, processed, state);
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
  return handleAfterLlmPlanningProcessResult(ctx, processed, state);
}
