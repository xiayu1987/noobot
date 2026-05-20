/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  FAILURE_THRESHOLD,
  GUIDANCE_REASON,
  GUIDANCE_WEB_SERVICE_NAME,
  GUIDANCE_WEB_TOOL_NAMES,
  LOCALE,
  TOOL_NAME_SET,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  ensureHarnessBucket,
  extractRawTextContent,
  markMessagesSummarized,
  relaySeparateModelOutputAsUserMessage,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityToolAllowlist,
  shouldUseSeparateModel,
  translateI18nText,
} from "./shared.js";

function markGuidanceSummarizedMessages(ctx = {}) {
  const historyMessages = ctx?.agentContext?.payload?.messages?.history;
  const currentMessages = ctx?.messages;
  const currentMarked = markMessagesSummarized(currentMessages);
  const historyMarked = markMessagesSummarized(historyMessages);
  return currentMarked + historyMarked;
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
        translateI18nText(locale, "guidanceSummaryMarker"),
        translateI18nText(locale, "guidanceSummaryBody"),
      ].join("\n"),
    });
    state.pending.summary = false;
    state.counters.llmTurns = 0;
    state.flags.guidanceSummaryMarkPending = true;
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
      translateI18nText(locale, "guidanceMarker"),
      translateI18nText(locale, "guidanceBody", { reason }),
      translateI18nText(locale, "guidancePreferTools", { tools: GUIDANCE_WEB_TOOL_NAMES.join(", ") }),
      translateI18nText(locale, "guidanceWebService", {
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
    prompt = translateI18nText(locale, "guidanceSummaryBody");
    state.pending.summary = false;
    state.counters.llmTurns = 0;
  } else if (state.pending.guidance) {
    purpose = "guidance";
    reason = state.pending.guidance;
    prompt = [
      translateI18nText(locale, "guidanceBody", { reason }),
      translateI18nText(locale, "guidancePreferTools", { tools: GUIDANCE_WEB_TOOL_NAMES.join(", ") }),
      translateI18nText(locale, "guidanceWebService", {
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
      messages: resolveCapabilityModelMessages(meta, {
        ctx,
        purpose,
        messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
      }),
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
  if (purpose === "summary") {
    const markedCount = markGuidanceSummarizedMessages(ctx);
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_messages_marked",
      detail: { markedCount },
    });
  }
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

export function createGuidanceHandler({ shouldProcessPrimaryToolHooks }) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
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
    if (point === "after_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      if (holder?.state?.flags?.guidanceSummaryMarkPending === true) {
        holder.state.flags.guidanceSummaryMarkPending = false;
        const markedCount = markGuidanceSummarizedMessages(ctx);
        appendCapabilityLog(ctx, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          event: "summary_messages_marked",
          detail: { markedCount },
        });
        changed = markedCount > 0 || changed;
      }
    }
    return { capability, point, status: "active", changed };
  };
}
