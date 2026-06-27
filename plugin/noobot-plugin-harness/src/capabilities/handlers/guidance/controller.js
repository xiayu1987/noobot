/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  getTransferPayloadFromAttachments,
  saveCapabilityOutputAsTransferArtifacts,
  relaySeparateModelOutputAsUserMessage,
  ensureHarnessBucket,
  extractRawTextContent,
  translateI18nText,
} from "./deps.js";
import { isSummaryCompletionMarked } from "../model-response-parser.js";
import {
  parseSummaryOverviewAndDetailFromText,
  resolveSummaryDetailAttachmentText,
} from "../shared/plan/summary-text-protocol.js";
import {
  maybeInjectPlanUpdatePrompt,
  maybeCapturePlanUpdateByInject,
} from "./revision-injector.js";
import { maybeInjectGuidanceOrSummaryPrompt } from "./prompt-injector.js";
import {
  runPendingPlanUpdateBySeparateModel,
  runGuidanceBySeparateModel,
} from "./model-runner.js";
import { resolveGuidancePriorityDecision, resolveNextGuidanceAction } from "../planning/plan-update-scheduler.js";
import { markGuidanceSummarizedMessages, markToolSignals, updateFailureCounters } from "./signal-tracker.js";
import {
  applySummaryText,
  recordLatestSummaryFullText,
  recordSummaryDetailAttachments,
  shouldSaveSummaryDetailToAttachment,
  transferSummaryInjectionMessage,
} from "./summary-manager.js";
import { appendCapabilityLog } from "../shared/attachment-log-utils.js";
import { resolveAttachmentDisplayPath } from "../shared/sandbox-path.js";
import {
  resolveWorkflowMode,
  runWorkflowLifecycle,
} from "../shared/workflow/pattern.js";
import { resolveWorkflowThresholdModeFromContext } from "../shared/workflow/prompts.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";
import {
  HARNESS_MAIN_FLOW_CONTROL_REASON,
  requestFinalNoToolsMainFlowInstruction,
} from "../shared/runtime/main-flow-control-instruction.js";
import { clearIncrementalCapabilityMessageCacheForContext } from "../shared/model/incremental-message-cache.js";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;
const GUIDANCE_DECISION = WORKFLOW_PARAMS.guidance.decisions;
const TASK_SUMMARY_TOOL_NAME = WORKFLOW_PARAMS.planning.tools.summaryToolName;
const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = WORKFLOW_PARAMS.guidance.summary.messageCharsThreshold;
const LLM_SUMMARY_OVERFLOW_POLICY = Object.freeze({
  ENABLE_PRUNE_AFTER_SUMMARY: WORKFLOW_PARAMS.guidance.summary.overflowPolicy.enablePruneAfterSummary,
  PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS:
    WORKFLOW_PARAMS.guidance.summary.overflowPolicy.pruneTriggerAfterCharSummaryRounds,
  FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW:
    WORKFLOW_PARAMS.guidance.summary.overflowPolicy.forceAcceptanceWhenStillOverflow,
});

function isMessageSummarized(message = {}) {
  return message?.summarized === true || message?.lc_kwargs?.summarized === true;
}

function resolveUnsummarizedMessageChars(messages = []) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, message) => {
    if (!message || typeof message !== "object") return total;
    if (isMessageSummarized(message)) return total;
    const content = extractRawTextContent(message?.content ?? message);
    return total + String(content || "").length;
  }, 0);
}

function getMessageToolCalls(messageItem = {}) {
  if (Array.isArray(messageItem?.tool_calls)) return messageItem.tool_calls;
  if (Array.isArray(messageItem?.lc_kwargs?.tool_calls)) return messageItem.lc_kwargs.tool_calls;
  if (Array.isArray(messageItem?.additional_kwargs?.tool_calls)) return messageItem.additional_kwargs.tool_calls;
  return [];
}

function resolveToolNameFromToolCall(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return String(fn.name || "").trim();
}

function resolveToolCallId(toolCall = {}) {
  return String(toolCall?.id ?? toolCall?.tool_call_id ?? toolCall?.toolCallId ?? "").trim();
}

function resolveToolCallIdFromToolMessage(messageItem = {}) {
  return String(
    messageItem?.tool_call_id ??
      messageItem?.toolCallId ??
      messageItem?.lc_kwargs?.tool_call_id ??
      "",
  ).trim();
}

function setMessageSummarized(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem.summarized === true && messageItem?.lc_kwargs?.summarized === true) return false;
  messageItem.summarized = true;
  if (messageItem?.lc_kwargs && typeof messageItem.lc_kwargs === "object") {
    messageItem.lc_kwargs.summarized = true;
  }
  return true;
}

function discardOldestToolCallPairs(messages = [], charsThreshold = 0) {
  if (!Array.isArray(messages) || !Number.isFinite(charsThreshold) || charsThreshold <= 0) {
    return { discardedMessages: 0, charsAfter: resolveUnsummarizedMessageChars(messages) };
  }
  let charsAfter = resolveUnsummarizedMessageChars(messages);
  if (charsAfter <= charsThreshold) return { discardedMessages: 0, charsAfter };
  let discardedMessages = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (charsAfter <= charsThreshold) break;
    const message = messages[index];
    if (!message || typeof message !== "object" || isMessageSummarized(message)) continue;
    const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
    if (role !== "assistant") continue;
    const contentText = extractRawTextContent(message?.content ?? "");
    if (String(contentText || "").trim()) continue;
    const toolCallIds = getMessageToolCalls(message)
      .filter((toolCall) => resolveToolNameFromToolCall(toolCall) !== TASK_SUMMARY_TOOL_NAME)
      .map((toolCall) => resolveToolCallId(toolCall))
      .filter(Boolean);
    if (!toolCallIds.length) continue;
    const toolResultIndexes = [];
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const maybeToolResult = messages[cursor];
      if (!maybeToolResult || typeof maybeToolResult !== "object" || isMessageSummarized(maybeToolResult)) continue;
      const resultRole = String(maybeToolResult?.role || maybeToolResult?.lc_kwargs?.role || "").trim().toLowerCase();
      if (resultRole !== "tool") continue;
      const toolCallId = resolveToolCallIdFromToolMessage(maybeToolResult);
      if (!toolCallId || !toolCallIds.includes(toolCallId)) continue;
      const explicitToolName = String(maybeToolResult?.toolName || maybeToolResult?.tool_name || "").trim();
      if (explicitToolName === TASK_SUMMARY_TOOL_NAME) continue;
      toolResultIndexes.push(cursor);
    }
    if (!toolResultIndexes.length) continue;
    if (setMessageSummarized(message)) discardedMessages += 1;
    for (const toolIndex of toolResultIndexes) {
      if (setMessageSummarized(messages[toolIndex])) discardedMessages += 1;
    }
    charsAfter = resolveUnsummarizedMessageChars(messages);
  }
  return { discardedMessages, charsAfter };
}

function normalizePositiveInteger(value = 0, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function normalizeGuidanceAnalysisTurnsThreshold(value = undefined) {
  const normalized = normalizePositiveInteger(value, 0);
  if (!normalized) return 0;
  return Math.min(10, Math.max(1, normalized));
}

function resolveGuidanceAnalysisTurnsThreshold(ctx = {}, meta = {}) {
  const modeThresholds = WORKFLOW_PARAMS.modeThresholds || {};
  const thresholdMode = resolveWorkflowThresholdModeFromContext(ctx);
  const scopedMode = modeThresholds[thresholdMode] || modeThresholds.full || {};
  const runtimeThreshold = normalizeGuidanceAnalysisTurnsThreshold(
    meta?.harness?.guidance?.analysis?.turnsThreshold,
  );
  return {
    mode: modeThresholds[thresholdMode] ? thresholdMode : "full",
    turnsThreshold: runtimeThreshold || normalizePositiveInteger(
      scopedMode?.guidance?.analysis?.turnsThreshold,
      WORKFLOW_PARAMS.guidance.analysis.turnsThreshold,
    ),
    source: runtimeThreshold ? "runtime" : "workflow_params",
  };
}

function resolveGuidanceSummaryThresholds(ctx = {}) {
  const modeThresholds = WORKFLOW_PARAMS.modeThresholds || {};
  const thresholdMode = resolveWorkflowThresholdModeFromContext(ctx);
  const scopedMode = modeThresholds[thresholdMode] || modeThresholds.full || {};
  const scoped = scopedMode?.guidance?.summary || {};
  return {
    mode: modeThresholds[thresholdMode] ? thresholdMode : "full",
    turnsThreshold: normalizePositiveInteger(
      scoped?.turnsThreshold,
      WORKFLOW_PARAMS.guidance.summary.turnsThreshold,
    ),
  };
}

function maybeScheduleGuidanceSummary(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder?.state) return false;
  const state = holder.state;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  if (state.pending?.summary === true) return false;
  const currentTurn = Number(ctx?.turn);
  const previousTurn = Number(state.counters.lastGuidanceSummaryCounterTurn || 0);
  let turnIncrement = 1;
  if (Number.isFinite(currentTurn) && currentTurn > 0) {
    const normalizedTurn = Math.trunc(currentTurn);
    if (Number.isFinite(previousTurn) && previousTurn > 0) {
      if (normalizedTurn <= Math.trunc(previousTurn)) return false;
      turnIncrement = Math.max(1, normalizedTurn - Math.trunc(previousTurn));
    }
    state.counters.lastGuidanceSummaryCounterTurn = normalizedTurn;
  }
  state.counters.summaryTurns = Number(state.counters.summaryTurns || 0) + turnIncrement;
  let currentChars = resolveUnsummarizedMessageChars(ctx?.messages);
  const threshold = resolveGuidanceSummaryThresholds(ctx);
  const reachedTurnsSummary = state.counters.summaryTurns > threshold.turnsThreshold;
  let reachedCharsSummary = currentChars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD;

  const pruneEnabled = LLM_SUMMARY_OVERFLOW_POLICY.ENABLE_PRUNE_AFTER_SUMMARY === true;
  const pruneTriggerRounds = Number(LLM_SUMMARY_OVERFLOW_POLICY.PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS || 1);
  const canPruneAfterSummary = state.flags?.summaryByCharsPrompted === true && pruneTriggerRounds <= 1;
  if (reachedCharsSummary && pruneEnabled && canPruneAfterSummary) {
    const pruneResult = discardOldestToolCallPairs(ctx?.messages, LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD);
    currentChars = pruneResult.charsAfter;
    reachedCharsSummary = currentChars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD;
    if (reachedCharsSummary && LLM_SUMMARY_OVERFLOW_POLICY.FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW === true) {
      state.flags.overflowForceAcceptancePending = true;
      const instruction = requestFinalNoToolsMainFlowInstruction(ctx, {
        reason: HARNESS_MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY,
        source: "harness_summary_overflow",
        detail: {
          charsThreshold: LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
          unsummarizedChars: currentChars,
          discardedMessages: pruneResult.discardedMessages,
        },
      });
      if (instruction) {
        appendCapabilityLog(ctx, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          event: "main_flow_final_no_tools_instruction_requested",
          detail: {
            action: instruction.action,
            reason: instruction.reason,
            source: instruction.source,
            charsThreshold: LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
            unsummarizedChars: currentChars,
            discardedMessages: pruneResult.discardedMessages,
          },
        });
        state.flags.overflowForceAcceptancePending = false;
        state.flags.mainFlowFinalNoToolsPending = true;
      }
    } else {
      state.flags.overflowForceAcceptancePending = false;
      state.flags.mainFlowFinalNoToolsPending = false;
      state.flags.summaryByCharsPrompted = false;
    }
  } else if (state.flags?.overflowForceAcceptancePending !== true) {
    state.flags.overflowForceAcceptancePending = false;
  }

  if (!reachedTurnsSummary && !reachedCharsSummary) {
    if (!reachedCharsSummary) state.flags.summaryByCharsPrompted = false;
    return false;
  }
  setPendingStateWithMeta(state, "summary", true);
  state.counters.summaryTurns = 0;
  state.flags.summaryByCharsPrompted = reachedCharsSummary === true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: reachedCharsSummary ? "summary_scheduled_by_char_threshold" : "summary_scheduled_by_turn_threshold",
    detail: {
      thresholdMode: threshold.mode,
      triggerTurns: threshold.turnsThreshold,
      charsThreshold: LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
      unsummarizedChars: currentChars,
    },
  });
  return true;
}

function isSummaryOnToolBurstThresholdEnabled(meta = {}) {
  return meta?.harness?.summaryOnToolBurstThreshold === true || meta?.harness?.enableToolBurstSummary === true;
}

function maybeScheduleSummaryByToolBurst(ctx = {}, meta = {}) {
  if (!isSummaryOnToolBurstThresholdEnabled(meta)) return false;
  const threshold = Number(resolveGuidanceSummaryThresholds(ctx).turnsThreshold);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  const calls = Array.isArray(ctx?.calls) ? ctx.calls : [];
  if (!Array.isArray(calls) || calls.length < threshold) return false;
  const holder = ensureHarnessBucket(ctx);
  if (!holder || holder.state?.pending?.summary === true) return false;
  const toolNames = calls.map((call) => resolveToolNameFromToolCall(call)).filter(Boolean);
  if (toolNames.includes(TASK_SUMMARY_TOOL_NAME)) return false;
  setPendingStateWithMeta(holder.state, "summary", true);
  holder.state.flags.summaryByCharsPrompted = false;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: GUIDANCE_EVENTS.summaryScheduledByToolBurstThreshold,
    detail: { threshold, toolCallCount: calls.length, toolNames },
  });
  return true;
}

function isMainPlanReadyForGuidanceAnalysis(bucket = {}, state = {}) {
  if (state?.flags?.planningCaptured !== true) return false;
  if (String(bucket?.planText || "").trim()) return true;
  if (Array.isArray(bucket?.planDocument?.mainPlans) && bucket.planDocument.mainPlans.length > 0) {
    return true;
  }
  return Array.isArray(bucket?.taskChecklist) && bucket.taskChecklist.length > 0;
}

function maybeScheduleGuidanceAnalysis(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder?.state) return false;
  const state = holder.state;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  if (!isMainPlanReadyForGuidanceAnalysis(holder.bucket, state)) return false;
  if (state.pending?.analysis === true) return false;
  const currentTurn = Number(ctx?.turn);
  const previousTurn = Number(state.counters.lastGuidanceAnalysisCounterTurn || 0);
  let turnIncrement = 1;
  if (Number.isFinite(currentTurn) && currentTurn > 0) {
    const normalizedTurn = Math.trunc(currentTurn);
    if (Number.isFinite(previousTurn) && previousTurn > 0) {
      if (normalizedTurn <= Math.trunc(previousTurn)) return false;
      turnIncrement = Math.max(1, normalizedTurn - Math.trunc(previousTurn));
    }
    state.counters.lastGuidanceAnalysisCounterTurn = normalizedTurn;
  }
  state.counters.analysisTurns = Number(state.counters.analysisTurns || 0) + turnIncrement;
  const threshold = resolveGuidanceAnalysisTurnsThreshold(ctx, meta);
  if (state.counters.analysisTurns < threshold.turnsThreshold) {
    return false;
  }
  setPendingStateWithMeta(state, "analysis", true);
  state.counters.analysisTurns = 0;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: GUIDANCE_EVENTS.analysisScheduledByTurnThreshold,
    detail: {
      triggerTurns: threshold.turnsThreshold,
      thresholdMode: threshold.mode,
      thresholdSource: threshold.source,
    },
  });
  return true;
}

function resolveDetailPath(meta = {}, ctx = {}) {
  return resolveAttachmentDisplayPath(meta, ctx);
}

function buildSummaryDetailPathRelayContent(ctx = {}, locale = LOCALE.ZH_CN, detailAttachments = []) {
  const metas = Array.isArray(detailAttachments) ? detailAttachments : [];
  if (!metas.length) return "";
  const lines = metas.map((item = {}) => resolveDetailPath(item, ctx)).filter(Boolean);
  if (!lines.length) return "";
  const header = translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.SUMMARY_DETAIL_PATHS_HEADER);
  const footer = translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.SUMMARY_DETAIL_PATHS_FOOTER);
  return [
    header,
    ...lines.map((item) => `DETAIL_PATH: ${item}`),
    footer,
  ].join("\n");
}

function resolveWorkflowActionName(action = "", stage = "", mode = "inject") {
  const normalizedMode = String(mode || "").trim() === "separate_model" ? "separate_model" : "inject";
  if (action === GUIDANCE_DECISION.action.planUpdate) {
    const revisionStage = String(stage || "").trim().toLowerCase() === GUIDANCE_DECISION.stage.revision;
    if (revisionStage) {
      return normalizedMode === "separate_model"
        ? GUIDANCE_DECISION.requestedAction.planUpdateRevisionSeparateModel
        : GUIDANCE_DECISION.requestedAction.planUpdateRevisionInject;
    }
    return normalizedMode === "separate_model"
      ? GUIDANCE_DECISION.requestedAction.planUpdateRefinementSeparateModel
      : GUIDANCE_DECISION.requestedAction.planUpdateRefinementInject;
  }
  if (action === GUIDANCE_DECISION.action.summary) {
    return normalizedMode === "separate_model"
      ? GUIDANCE_DECISION.requestedAction.summarySeparateModel
      : GUIDANCE_DECISION.requestedAction.summaryInject;
  }
  if (action === GUIDANCE_DECISION.action.guidance) {
    return normalizedMode === "separate_model"
      ? GUIDANCE_DECISION.requestedAction.guidanceSeparateModel
      : GUIDANCE_DECISION.requestedAction.guidanceInject;
  }
  if (action === GUIDANCE_DECISION.action.analysis) {
    return normalizedMode === "separate_model"
      ? GUIDANCE_DECISION.requestedAction.analysisSeparateModel
      : GUIDANCE_DECISION.requestedAction.analysisInject;
  }
  return GUIDANCE_DECISION.requestedAction.none;
}

async function executeGuidanceWorkflowAction({
  nextAction = { action: "none", stage: "", reason: "idle" },
  ctx = {},
  meta = {},
} = {}) {
  const mode = resolveWorkflowMode(meta);
  let changed = false;
  let executedPrimary = false;
  let executedFollowup = false;

  if (mode === "separate_model") {
    if (nextAction.action === GUIDANCE_DECISION.action.summary) {
      const result = await runGuidanceBySeparateModel(ctx, meta, { action: nextAction.action });
      changed = result || changed;
      executedPrimary = result === true;
    } else if (nextAction.action === GUIDANCE_DECISION.action.guidance) {
      const result = await runGuidanceBySeparateModel(ctx, meta, { action: nextAction.action });
      changed = result || changed;
      executedPrimary = result === true;
    } else if (nextAction.action === GUIDANCE_DECISION.action.analysis) {
      const result = await runGuidanceBySeparateModel(ctx, meta, { action: nextAction.action });
      changed = result || changed;
      executedPrimary = result === true;
    } else if (nextAction.action === GUIDANCE_DECISION.action.planUpdate) {
      const firstChanged = await runPendingPlanUpdateBySeparateModel(ctx, meta);
      changed = firstChanged || changed;
      executedPrimary = firstChanged === true;

      const holder = ensureHarnessBucket(ctx);
      const pending = holder?.state?.pending && typeof holder.state.pending === "object"
        ? holder.state.pending
        : {};
      const hasGuidanceFollowupPending =
        pending.summary === true || Boolean(pending.guidance) || pending.analysis === true;
      if (hasGuidanceFollowupPending) {
        const followupAction = resolveNextGuidanceAction(holder?.state || {});
        const followupChanged = await runGuidanceBySeparateModel(ctx, meta, { action: followupAction.action });
        changed = followupChanged || changed;
        executedFollowup = followupChanged === true;
      }
    }
  } else if (nextAction.action === "summary" || nextAction.action === "guidance") {
    const result = maybeInjectGuidanceOrSummaryPrompt(ctx, { action: nextAction.action, meta });
    changed = result || changed;
    executedPrimary = result === true;
  } else if (nextAction.action === "plan_update") {
    const result = maybeInjectPlanUpdatePrompt(ctx, meta);
    changed = result || changed;
    executedPrimary = result === true;
  }

  return {
    mode,
    changed,
    executedPrimary,
    executedFollowup,
    actionName: resolveWorkflowActionName(nextAction.action, nextAction.stage, mode),
  };
}

export function createGuidanceHandler({ shouldProcessPrimaryToolHooks }) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (point === "before_llm_call") {
      const invariantChanged = enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.GUIDANCE }) === true;
      const summaryScheduleChanged = maybeScheduleGuidanceSummary(ctx) === true;
      const scheduleChanged = maybeScheduleGuidanceAnalysis(ctx, meta) === true;
      const holder = ensureHarnessBucket(ctx);
      const nextAction = resolveNextGuidanceAction(holder?.state || {});
      const decision = resolveGuidancePriorityDecision(holder?.state || {});
      const mode = resolveWorkflowMode(meta);
      const lifecycle = await runWorkflowLifecycle(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        point: "before_llm_call",
        mode,
        resolveDecision: () => ({
          chosenAction: decision.chosenAction,
          chosenReason: decision.chosenReason,
          chosenReasonLabel: decision.chosenReasonLabel,
          chosenStage: decision.chosenStage,
          candidateActions: decision.candidateActions,
          deferredActions: decision.deferredActions,
          blockedActions: decision.blockedActions,
          blockedReasons: decision.blockedReasons,
          blockedReasonLabels: decision.blockedReasonLabels,
          pending: decision.pendingSnapshot,
        }),
        execute: async () => {
          const execution = await executeGuidanceWorkflowAction({
            nextAction,
            ctx,
            meta,
          });
          return {
            requestedAction: execution.actionName,
            executedPrimary: execution.executedPrimary,
            executedFollowup: execution.executedFollowup,
            changed: execution.changed || invariantChanged || summaryScheduleChanged || scheduleChanged,
          };
        },
      });
      changed = lifecycle.execution.changed || changed;
    }
    if (point === "after_tool_call" && shouldProcessPrimaryToolHooks(ctx)) {
      changed = markToolSignals(ctx) || changed;
      const failed = ctx?.success === false;
      changed = updateFailureCounters(ctx, failed) || changed;
    }
    if (point === "tool_call_error" && shouldProcessPrimaryToolHooks(ctx)) {
      changed = updateFailureCounters(ctx, true) || changed;
    }
    if (point === "after_tool_calls" && shouldProcessPrimaryToolHooks(ctx)) {
      changed = maybeScheduleSummaryByToolBurst(ctx, meta) || changed;
    }
    if (point === "after_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      if (holder?.state?.flags?.guidanceSummaryMarkPending === true) {
        holder.state.flags.guidanceSummaryMarkPending = false;
        const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
        appendCapabilityLog(ctx, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          event: GUIDANCE_EVENTS.summaryMessagesMarked,
          detail: { markedCount },
        });
        const rawSummaryText = extractRawTextContent(ctx?.ai?.content) || extractRawTextContent(ctx?.modelResponse?.content) || "";
        const locale = holder.state?.locale || LOCALE.ZH_CN;
        const parsedSummary = parseSummaryOverviewAndDetailFromText(rawSummaryText);
        const summaryOverviewText = String(parsedSummary?.overviewText || "").trim() || rawSummaryText;
        const saveDetailToAttachment = shouldSaveSummaryDetailToAttachment(meta);
        const summaryDetailAttachmentText = resolveSummaryDetailAttachmentText(parsedSummary);
        const detailAttachments = saveDetailToAttachment && summaryDetailAttachmentText
          ? await saveCapabilityOutputAsTransferArtifacts(ctx, {
            purpose: "summary_detail",
            content: summaryDetailAttachmentText,
            generationSource: "harness_summary_detail",
            domain: CAPABILITY_DOMAIN.GUIDANCE,
          })
          : [];
        recordSummaryDetailAttachments(ctx, detailAttachments);
        const detailPathRelay = buildSummaryDetailPathRelayContent(
          ctx,
          locale,
          detailAttachments,
        );
        if (detailPathRelay) {
          relaySeparateModelOutputAsUserMessage(ctx, {
            locale,
            purpose: "summary_detail_path",
            content: detailPathRelay,
            dedupe: true,
            transferPayload: getTransferPayloadFromAttachments(detailAttachments),
          });
        }
        if (!saveDetailToAttachment && rawSummaryText) {
          const summaryInjectionContent = await transferSummaryInjectionMessage(ctx, {
            fullText: rawSummaryText,
            summaryText: summaryOverviewText,
            detailText: summaryDetailAttachmentText,
            injectMode: "full",
            meta,
          });
          relaySeparateModelOutputAsUserMessage(ctx, {
            locale,
            purpose: "summary",
            content: summaryInjectionContent || rawSummaryText,
            dedupe: true,
          });
        }
        recordLatestSummaryFullText(ctx, rawSummaryText);
        const summaryText = applySummaryText(ctx, summaryOverviewText);
        clearIncrementalCapabilityMessageCacheForContext(ctx);
        if (!isSummaryCompletionMarked(summaryText, locale)) {
          appendCapabilityLog(ctx, {
            domain: CAPABILITY_DOMAIN.GUIDANCE,
            event: GUIDANCE_EVENTS.summaryCompletionMarkerMissing,
          });
        }
        changed = markedCount > 0 || changed;
      }
      changed = (await maybeCapturePlanUpdateByInject(ctx)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}
