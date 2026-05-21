/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  GUIDANCE_REASON,
  GUIDANCE_WEB_SERVICE_NAME,
  GUIDANCE_WEB_TOOL_NAMES,
  LOCALE,
  TOOL_NAME_SET,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  ensureHarnessBucket,
  extractRawTextContent,
  getDefaultTaskOwner,
  markMessagesSummarized,
  parseTaskChecklistFromModelOutput,
  relaySeparateModelOutputAsUserMessage,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelName,
  resolveCapabilityModelMessages,
  resolveCapabilityToolAllowlist,
  resolveInjectedMessageSummarizer,
  shouldUseSeparateModel,
  translateI18nText,
} from "./shared.js";
import {
  extractPlanMetadataFromText,
  isPlanPayloadComplete,
  isSummaryCompletionMarked,
} from "./model-response-parser.js";
import {
  captureInjectedResult,
  injectScheduledPrompt,
  scheduleInjectTask,
} from "./inject-fallback.js";
import { FAILURE_THRESHOLD } from "../../core/thresholds.js";

function markGuidanceSummarizedMessages(ctx = {}, meta = {}) {
  const historyMessages = ctx?.agentContext?.payload?.messages?.history;
  const currentMessages = ctx?.messages;
  const injectedSummarizer = resolveInjectedMessageSummarizer(meta);
  const safeMark = (messages = []) => {
    if (!Array.isArray(messages)) return 0;
    if (typeof injectedSummarizer === "function") {
      try {
        const result = injectedSummarizer({
          messages,
          taskSummaryToolName: "task_summary",
        });
        const normalized = Number(result);
        if (Number.isFinite(normalized)) return normalized;
      } catch {
        // fallback to local implementation
      }
    }
    return markMessagesSummarized(messages);
  };
  const currentMarked = safeMark(currentMessages);
  const historyMarked = safeMark(historyMessages);
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

function applyRevisedPlanFromText(ctx = {}, text = "", { summary = "", source = "planning_revision" } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  const checklist = parseTaskChecklistFromModelOutput(text, locale);
  if (!checklist.length) return false;
  if (!isPlanPayloadComplete(text, checklist)) return false;
  const payload = extractPlanMetadataFromText(text);
  bucket.taskChecklist = checklist;
  bucket.taskChecklistSource = source;
  bucket.totalGoal = String(payload.totalGoal ?? bucket.totalGoal ?? "").trim();
  bucket.taskOwner = String(payload.taskOwner ?? bucket.taskOwner ?? getDefaultTaskOwner(locale)).trim() || getDefaultTaskOwner(locale);
  const nextPhase = payload.nextPhase && typeof payload.nextPhase === "object" ? payload.nextPhase : {};
  if (nextPhase.objective || nextPhase.content || nextPhase.checklistIndexes.length) {
    bucket.nextPhase = nextPhase;
  }
  if (!Array.isArray(bucket.planRevisions)) bucket.planRevisions = [];
  bucket.planRevisions.push({
    source,
    revisedAt: new Date().toISOString(),
    summary: String(summary || "").trim() || undefined,
    totalGoal: bucket.totalGoal || "",
    nextPhase: bucket.nextPhase || null,
    checklistCount: checklist.length,
  });
  if (bucket.planRevisions.length > 20) bucket.planRevisions.splice(0, bucket.planRevisions.length - 20);
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_checklist_revised_after_summary",
    detail: { checklistCount: checklist.length, hasNextPhase: Boolean(bucket.nextPhase) },
  });
  return true;
}

function buildPlanningRevisionPrompt(locale = LOCALE.ZH_CN, bucket = {}, state = {}, summaryText = "") {
  return [
    translateI18nText(locale, "planningRevisionMarker"),
    translateI18nText(locale, "planningRevisionBody"),
    locale === LOCALE.EN_US
      ? 'Output JSON only. Required format: {"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}'
      : '只输出 JSON。必需格式：{"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}',
    JSON.stringify({
      currentSummary: String(summaryText || "").trim(),
      currentPlan: {
        totalGoal: bucket.totalGoal || "",
        taskOwner: bucket.taskOwner || getDefaultTaskOwner(locale),
        taskChecklist: bucket.taskChecklist || [],
        nextPhase: bucket.nextPhase || null,
      },
      harnessState: {
        signals: state.signals || {},
        counters: state.counters || {},
      },
    }, null, 2),
  ].join("\n");
}

function buildNextPhaseRelayContent(bucket = {}, locale = LOCALE.ZH_CN) {
  const nextPhase = bucket?.nextPhase && typeof bucket.nextPhase === "object" ? bucket.nextPhase : null;
  const selected = nextPhase?.checklistIndexes?.length
    ? (bucket.taskChecklist || []).filter((item) => nextPhase.checklistIndexes.includes(Number(item.index)))
    : [];
  const payload = {
    totalGoal: bucket.totalGoal || "",
    nextPhase: nextPhase || {},
    taskChecklist: selected.length ? selected : bucket.taskChecklist || [],
  };
  const title = locale === LOCALE.EN_US ? "Next phase plan checklist:" : "下一阶段计划清单：";
  return `${title}
${JSON.stringify(payload, null, 2)}`;
}

function schedulePlanRevisionByInject(ctx = {}, summaryText = "") {
  return scheduleInjectTask(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    scheduledEvent: "planning_revision_scheduled_by_inject",
    setPendingData: ({ state }) => {
      state.pending.planRevision = true;
      state.pending.summaryText = String(summaryText || "").trim();
      return true;
    },
    buildScheduledDetail: ({ bucket, state }) => ({
      hasSummaryText: Boolean(state.pending.summaryText),
      checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
    }),
  });
}

function maybeInjectPlanRevisionPrompt(ctx = {}) {
  return injectScheduledPrompt(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    injectedEvent: "planning_revision_prompt_injected",
    getPendingData: ({ state }) =>
      state.pending.planRevision === true
        ? { summaryText: String(state.pending.summaryText || "").trim() }
        : null,
    consumePendingData: ({ state }) => {
      state.pending.planRevision = false;
      state.pending.summaryText = "";
    },
    markCapturePending: ({ state }) => {
      state.flags.planRevisionCapturePending = true;
    },
    buildPromptContent: ({ locale, bucket, state, pendingData }) =>
      buildPlanningRevisionPrompt(locale, bucket, state, pendingData.summaryText || ""),
    messageRole: "user",
    injectAt: "append",
  });
}

async function maybeCapturePlanRevisionByInject(ctx = {}) {
  return captureInjectedResult(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    completedEvent: "planning_revision_capture_completed_inject",
    failedEvent: "planning_revision_capture_failed_inject",
    isCapturePending: ({ state }) => state.flags.planRevisionCapturePending === true,
    consumeCaptureMeta: ({ state }) => {
      state.flags.planRevisionCapturePending = false;
      return {};
    },
    applyCaptureResult: ({ responseText, ctx: currentCtx, state, bucket }) => {
      const applied = applyRevisedPlanFromText(currentCtx, responseText, {
        source: "planning_revision_inject",
      });
      if (!applied) return { applied: false };
      const locale = state?.locale || LOCALE.ZH_CN;
      relaySeparateModelOutputAsUserMessage(currentCtx, {
        locale,
        purpose: "next_phase_plan",
        content: buildNextPhaseRelayContent(bucket, locale),
        dedupe: true,
      });
      return { applied: true, detail: { checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0 } };
    },
  });
}

async function revisePlanAfterSummary(ctx = {}, meta = {}, summaryText = "") {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    return schedulePlanRevisionByInject(ctx, summaryText);
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const prompt = buildPlanningRevisionPrompt(locale, bucket, state, summaryText);
  const revisionMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "planning_revision",
    messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
  });
  revisionMessages.push({ role: "user", content: prompt });

  let response = null;
  try {
    response = await invoker({
      purpose: "planning_revision",
      domain: CAPABILITY_DOMAIN.PLANNING,
      model: resolveCapabilityModelName(meta, {
        purpose: "planning_revision",
        domain: CAPABILITY_DOMAIN.PLANNING,
      }),
      locale,
      prompt: "",
      messages: revisionMessages,
      ctx,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, "planning_revision"),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_revision_model_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    purpose: "planning_revision",
    response,
  });
  const responseText = extractRawTextContent(response?.content) || String(response?.text || response?.output || "").trim();
  const applied = applyRevisedPlanFromText(ctx, responseText, { summary: summaryText });
  if (!applied) return false;
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "next_phase_plan",
    content: buildNextPhaseRelayContent(bucket, locale),
    dedupe: true,
  });
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
      model: resolveCapabilityModelName(meta, {
        purpose,
        domain: CAPABILITY_DOMAIN.GUIDANCE,
      }),
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
    const markedCount = markGuidanceSummarizedMessages(ctx, meta);
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_messages_marked",
      detail: { markedCount },
    });
    if (isSummaryCompletionMarked(responseText, locale)) {
      await revisePlanAfterSummary(ctx, meta, responseText);
    } else {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        event: "summary_completion_marker_missing",
      });
    }
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
        changed = maybeInjectPlanRevisionPrompt(ctx) || changed;
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
        const markedCount = markGuidanceSummarizedMessages(ctx, meta);
        appendCapabilityLog(ctx, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          event: "summary_messages_marked",
          detail: { markedCount },
        });
        const summaryText = extractRawTextContent(ctx?.ai?.content) || extractRawTextContent(ctx?.modelResponse?.content) || "";
        const locale = holder.state?.locale || LOCALE.ZH_CN;
        if (isSummaryCompletionMarked(summaryText, locale)) {
          if (!shouldUseSeparateModel(meta) && !resolveCapabilityModelInvoker(meta)) {
            changed = schedulePlanRevisionByInject(ctx, summaryText) || changed;
          } else {
            changed = (await revisePlanAfterSummary(ctx, meta, summaryText)) || changed;
          }
        } else {
          appendCapabilityLog(ctx, {
            domain: CAPABILITY_DOMAIN.GUIDANCE,
            event: "summary_completion_marker_missing",
          });
        }
        changed = markedCount > 0 || changed;
      }
      changed = (await maybeCapturePlanRevisionByInject(ctx)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}
