/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";
import { relaySeparateModelOutputAsUserMessage } from "../shared/relay-model-output.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  saveCapabilityOutputAsTransferArtifacts,
  ensureHarnessBucket,
  extractRawTextContent,
  shouldSkipAnalysisForTrailingToolCallContent,
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
  recordSummaryDetailTransferEnvelopes,
  shouldSaveSummaryDetailToAttachment,
  transferSummaryInjectionMessage,
} from "./summary-manager.js";
import { appendCapabilityLog } from "../shared/attachment-log-utils.js";
import {
  resolveWorkflowMode,
  runWorkflowLifecycle,
} from "../shared/workflow/pattern.js";
import { resolveWorkflowThresholdModeFromContext } from "../shared/workflow/prompts.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";
import { clearIncrementalCapabilityMessageCacheForContext } from "../shared/model/incremental-message-cache.js";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;
const GUIDANCE_DECISION = WORKFLOW_PARAMS.guidance.decisions;
const TASK_SUMMARY_TOOL_NAME = WORKFLOW_PARAMS.planning.tools.summaryToolName;
const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = WORKFLOW_PARAMS.guidance.summary.messageCharsThreshold;

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

function resolveToolNameFromToolCall(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return String(fn.name || "").trim();
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

function resolveGuidanceSummaryThresholds(ctx = {}, meta = {}) {
  const modeThresholds = WORKFLOW_PARAMS.modeThresholds || {};
  const thresholdMode = resolveWorkflowThresholdModeFromContext(ctx);
  const scopedMode = modeThresholds[thresholdMode] || modeThresholds.full || {};
  const scoped = scopedMode?.guidance?.summary || {};
  const runtimeThreshold = meta?.harness?.frontendThresholdsEnabled === true
    ? normalizePositiveInteger(meta?.harness?.guidance?.summary?.turnsThreshold, 0)
    : 0;
  return {
    mode: modeThresholds[thresholdMode] ? thresholdMode : "full",
    turnsThreshold: runtimeThreshold || normalizePositiveInteger(
        scoped?.turnsThreshold,
        WORKFLOW_PARAMS.guidance.summary.turnsThreshold,
      ),
    source: runtimeThreshold ? "runtime" : "workflow_params",
  };
}

function maybeScheduleGuidanceSummary(ctx = {}, meta = {}) {
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
  const currentChars = resolveUnsummarizedMessageChars(ctx?.modelContext?.messages);
  const threshold = resolveGuidanceSummaryThresholds(ctx, meta);
  const reachedTurnsSummary = state.counters.summaryTurns > threshold.turnsThreshold;
  const reachedCharsSummary = currentChars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD;

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
      thresholdSource: threshold.source,
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
  const threshold = Number(resolveGuidanceSummaryThresholds(ctx, meta).turnsThreshold);
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

function isPlanningCapabilityEnabled(meta = {}) {
  return meta?.harness?.capabilityProfile?.planning?.enabled !== false;
}

function isMainPlanReadyForGuidanceAnalysis(bucket = {}, state = {}, meta = {}) {
  if (!isPlanningCapabilityEnabled(meta)) return true;
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
  if (shouldSkipAnalysisForTrailingToolCallContent(ctx?.modelContext?.messages)) return false;
  if (!isMainPlanReadyForGuidanceAnalysis(holder.bucket, state, meta)) return false;
  if (state.pending?.summary === true) return false;
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
    if (point === HOOK_POINT.AGENT.BEFORE_LLM_CALL) {
      const current = ensureHarnessBucket(ctx);
      if (current?.state?.flags?.acceptanceCompleted === true) {
        return { capability, point, status: "active", changed: false };
      }
      const invariantChanged = enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.GUIDANCE }) === true;
      const summaryScheduleChanged = maybeScheduleGuidanceSummary(ctx, meta) === true;
      const scheduleChanged = maybeScheduleGuidanceAnalysis(ctx, meta) === true;
      const holder = ensureHarnessBucket(ctx);
      const nextAction = resolveNextGuidanceAction(holder?.state || {});
      const decision = resolveGuidancePriorityDecision(holder?.state || {});
      const mode = resolveWorkflowMode(meta);
      const lifecycle = await runWorkflowLifecycle(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        point: HOOK_POINT.AGENT.BEFORE_LLM_CALL,
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
    if (point === HOOK_POINT.AGENT.AFTER_TOOL_CALL && shouldProcessPrimaryToolHooks(ctx)) {
      changed = markToolSignals(ctx) || changed;
      const failed = ctx?.success === false;
      changed = updateFailureCounters(ctx, failed) || changed;
    }
    if (point === HOOK_POINT.AGENT.TOOL_CALL_ERROR && shouldProcessPrimaryToolHooks(ctx)) {
      changed = updateFailureCounters(ctx, true) || changed;
    }
    if (point === HOOK_POINT.AGENT.AFTER_TOOL_CALLS && shouldProcessPrimaryToolHooks(ctx)) {
      changed = maybeScheduleSummaryByToolBurst(ctx, meta) || changed;
    }
    if (point === HOOK_POINT.AGENT.AFTER_LLM_CALL) {
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
        const detailTransferPayload = saveDetailToAttachment && summaryDetailAttachmentText
          ? await saveCapabilityOutputAsTransferArtifacts(ctx, {
            purpose: "summary_detail",
            content: summaryDetailAttachmentText,
            generationSource: "harness_summary_detail",
            domain: CAPABILITY_DOMAIN.GUIDANCE,
          })
          : { transferEnvelopes: [] };
        recordSummaryDetailTransferEnvelopes(ctx, detailTransferPayload);
        if (detailTransferPayload.transferEnvelopes.length) {
          relaySeparateModelOutputAsUserMessage(ctx, {
            locale,
            purpose: "summary_detail",
            content: summaryOverviewText,
            dedupe: true,
            transferPayload: detailTransferPayload,
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
