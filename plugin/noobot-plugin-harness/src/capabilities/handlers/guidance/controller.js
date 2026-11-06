/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT, requireHookTurn } from "@noobot/hook-protocol";
import { requireResponseToolNameBindings } from "@noobot/model-protocol";
import { resolveToolCallName } from "@noobot/shared/tool-name";
import { resolveContextMessageSummarized } from "@noobot/context-protocol/message/codec";
import { relaySeparateModelOutputAsUserMessage } from "../shared/relay-model-output.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  CAPABILITY_DOMAIN,
  saveCapabilityOutputAsTransferArtifacts,
  ensureHarnessBucket,
  extractRawTextContent,
  readAfterLlmCallText,
  shouldSkipAnalysisForTrailingToolCallContent,
} from "./deps.js";
import { parseSummaryOverviewAndDetailFromText } from "../shared/plan/summary-text-protocol.js";
import {
  maybeInjectPlanUpdatePrompt,
  maybeCapturePlanUpdateByInject,
} from "./revision-injector.js";
import { maybeInjectGuidanceOrSummaryPrompt } from "./prompt-injector.js";
import { runPendingPlanUpdateBySeparateModel, runGuidanceBySeparateModel } from "./model-runner.js";
import {
  resolveGuidancePriorityDecision,
  resolveNextGuidanceAction,
} from "../planning/plan-update-scheduler.js";
import {
  markGuidanceSummarizedMessages,
  markToolSignals,
  updateFailureCounters,
} from "./signal-tracker.js";
import {
  applySummaryText,
  recordLatestSummaryFullText,
  recordSummaryTransferEnvelopes,
  shouldSaveSummaryToAttachment,
  transferSummaryInjectionMessage,
} from "./summary-manager.js";
import { appendCapabilityLog } from "../shared/attachment-log-utils.js";
import { runWorkflowLifecycle } from "../shared/workflow/pattern.js";
import { resolvePlanningGuidanceMode } from "../shared/model/utils.js";
import { HARNESS_PLANNING_GUIDANCE_MODE } from "../../../core/constants.js";
import { resolveWorkflowThresholdModeFromContext } from "../shared/workflow/prompts.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";
import {
  resolveAnalysisThresholdWithSource,
  resolveGatedThresholdWithSource,
} from "../shared/threshold-utils.js";
import { text, isObjectLike } from "@noobot/shared/value";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;
const GUIDANCE_DECISION = WORKFLOW_PARAMS.guidance.decisions;
const TASK_SUMMARY_TOOL_NAME = WORKFLOW_PARAMS.planning.tools.summaryToolName;

function resolveUnsummarizedMessageChars(messages = []) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, message) => {
    if (!isObjectLike(message)) return total;
    if (resolveContextMessageSummarized(message)) return total;
    const content = extractRawTextContent(message?.content ?? message);
    return total + String(content || "").length;
  }, 0);
}

function resolveGuidanceAnalysisTurnsThreshold(ctx = {}, meta = {}) {
  const thresholdMode = resolveWorkflowThresholdModeFromContext(ctx);
  const threshold = resolveAnalysisThresholdWithSource({
    runtimeValue: meta?.harness?.guidance?.analysis?.turnsThreshold,
    fallbackValue: TURN_THRESHOLDS.harness.modeThresholds[thresholdMode].analysisTurns,
  });
  return {
    mode: thresholdMode,
    turnsThreshold: threshold.value,
    source: threshold.source,
  };
}

function resolveGuidanceSummaryThresholds(ctx = {}, meta = {}) {
  const thresholdMode = resolveWorkflowThresholdModeFromContext(ctx);
  const summary = resolveGatedThresholdWithSource({
    meta,
    runtimeValue: meta?.harness?.guidance?.summary?.turnsThreshold,
    fallbackValue: TURN_THRESHOLDS.harness.modeThresholds[thresholdMode].summaryTurns,
  });
  return {
    mode: thresholdMode,
    turnsThreshold: summary.value,
    source: summary.source,
  };
}

function maybeScheduleGuidanceSummary(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder?.state) return false;
  const state = holder.state;
  if (state.pending?.summary === true) return false;
  const currentTurn = requireHookTurn(ctx);
  const previousTurn = state.counters.lastGuidanceSummaryCounterTurn;
  if (currentTurn <= previousTurn) return false;
  const turnIncrement = previousTurn > 0 ? currentTurn - previousTurn : 1;
  const threshold = resolveGuidanceSummaryThresholds(ctx, meta);
  state.counters.lastGuidanceSummaryCounterTurn = currentTurn;
  state.counters.summaryTurns += turnIncrement;
  const currentChars = resolveUnsummarizedMessageChars(ctx?.modelContext?.messages);
  const charsThreshold = LENGTH_THRESHOLDS.context.harnessSummaryMessageChars;
  const reachedTurnsSummary = state.counters.summaryTurns > threshold.turnsThreshold;
  const reachedCharsSummary = currentChars > charsThreshold;

  if (!reachedTurnsSummary && !reachedCharsSummary) {
    if (!reachedCharsSummary) state.flags.summaryByCharsPrompted = false;
    return false;
  }
  setPendingStateWithMeta(state, "summary", true);
  state.counters.summaryTurns = 0;
  state.flags.summaryByCharsPrompted = reachedCharsSummary === true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: reachedCharsSummary
      ? "summary_scheduled_by_char_threshold"
      : "summary_scheduled_by_turn_threshold",
    detail: {
      thresholdMode: threshold.mode,
      thresholdSource: threshold.source,
      triggerTurns: threshold.turnsThreshold,
      charsThreshold,
      unsummarizedChars: currentChars,
    },
  });
  return true;
}

function isSummaryOnToolBurstThresholdEnabled(meta = {}) {
  return meta?.harness?.summaryOnToolBurstThreshold === true;
}

function maybeScheduleSummaryByToolBurst(ctx = {}, meta = {}) {
  if (!isSummaryOnToolBurstThresholdEnabled(meta)) return false;
  const threshold = resolveGuidanceSummaryThresholds(ctx, meta).turnsThreshold;
  const calls = Array.isArray(ctx?.calls) ? ctx.calls : [];
  if (!Array.isArray(calls) || calls.length < threshold) return false;
  const holder = ensureHarnessBucket(ctx);
  if (!holder || holder.state?.pending?.summary === true) return false;
  const toolNames = calls.map((call) => resolveToolCallName(call)).filter(Boolean);
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
  return Boolean(text(bucket?.planText));
}

function maybeScheduleGuidanceAnalysis(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder?.state) return false;
  const state = holder.state;
  if (shouldSkipAnalysisForTrailingToolCallContent(ctx?.modelContext?.messages)) return false;
  if (!isMainPlanReadyForGuidanceAnalysis(holder.bucket, state, meta)) return false;
  if (state.pending?.summary === true) return false;
  if (state.pending?.analysis === true) return false;
  const currentTurn = requireHookTurn(ctx);
  const previousTurn = state.counters.lastGuidanceAnalysisCounterTurn;
  if (currentTurn <= previousTurn) return false;
  const turnIncrement = previousTurn > 0 ? currentTurn - previousTurn : 1;
  const threshold = resolveGuidanceAnalysisTurnsThreshold(ctx, meta);
  state.counters.lastGuidanceAnalysisCounterTurn = currentTurn;
  state.counters.analysisTurns += turnIncrement;
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

function resolveWorkflowActionName(action = "", stage = "", mode = "") {
  if (action === GUIDANCE_DECISION.action.planUpdate) {
    const revisionStage = text(stage).toLowerCase() === GUIDANCE_DECISION.stage.revision;
    if (revisionStage) {
      return mode === HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL
        ? GUIDANCE_DECISION.requestedAction.planUpdateRevisionSeparateModel
        : GUIDANCE_DECISION.requestedAction.planUpdateRevisionInject;
    }
    return mode === HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL
      ? GUIDANCE_DECISION.requestedAction.planUpdateRefinementSeparateModel
      : GUIDANCE_DECISION.requestedAction.planUpdateRefinementInject;
  }
  if (action === GUIDANCE_DECISION.action.summary) {
    return mode === HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL
      ? GUIDANCE_DECISION.requestedAction.summarySeparateModel
      : GUIDANCE_DECISION.requestedAction.summaryInject;
  }
  if (action === GUIDANCE_DECISION.action.guidance) {
    return mode === HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL
      ? GUIDANCE_DECISION.requestedAction.guidanceSeparateModel
      : GUIDANCE_DECISION.requestedAction.guidanceInject;
  }
  if (action === GUIDANCE_DECISION.action.analysis) {
    return mode === HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL
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
  const mode = resolvePlanningGuidanceMode(meta);
  let changed = false;
  let executedPrimary = false;
  let executedFollowup = false;

  if (mode === HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL) {
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
      const { pending } = holder.state;
      const hasGuidanceFollowupPending =
        pending.summary === true || Boolean(pending.guidance) || pending.analysis === true;
      if (hasGuidanceFollowupPending) {
        const followupAction = resolveNextGuidanceAction(holder.state);
        const followupChanged = await runGuidanceBySeparateModel(ctx, meta, {
          action: followupAction.action,
        });
        changed = followupChanged || changed;
        executedFollowup = followupChanged === true;
      }
    }
  } else if (nextAction.action === "summary" || nextAction.action === "guidance") {
    const result = maybeInjectGuidanceOrSummaryPrompt(ctx, { action: nextAction.action });
    changed = result || changed;
    executedPrimary = result === true;
  } else if (nextAction.action === "plan_update") {
    const result = maybeInjectPlanUpdatePrompt(ctx);
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

async function relayGuidanceSummary(ctx, { meta, locale, rawSummaryText }) {
  const toolNameBindings = requireResponseToolNameBindings(ctx.modelResponse);
  const persistSummaryAttachment = shouldSaveSummaryToAttachment(meta);
  if (persistSummaryAttachment && rawSummaryText) {
    const transferPayload = await saveCapabilityOutputAsTransferArtifacts(ctx, {
      purpose: "summary",
      content: rawSummaryText,
      generationSource: "harness_summary",
      domain: CAPABILITY_DOMAIN.GUIDANCE,
    });
    recordSummaryTransferEnvelopes(ctx, transferPayload);
    if (transferPayload.transferEnvelopes.length) {
      relaySeparateModelOutputAsUserMessage(ctx, {
        locale,
        purpose: "summary",
        content: rawSummaryText,
        toolNameBindings,
        dedupe: true,
        transferPayload,
      });
    }
    return;
  }
  recordSummaryTransferEnvelopes(ctx, { transferEnvelopes: [] });
  if (!rawSummaryText) return;
  const summaryInjectionContent = await transferSummaryInjectionMessage(ctx, {
    fullText: rawSummaryText,
    summaryText: rawSummaryText,
    detailText: rawSummaryText,
    injectMode: "full",
    meta,
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "summary",
    content: summaryInjectionContent || rawSummaryText,
    toolNameBindings,
    dedupe: true,
  });
}

async function applyPendingGuidanceSummary(ctx, meta, holder) {
  holder.state.flags.guidanceSummaryMarkPending = false;
  const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: GUIDANCE_EVENTS.summaryMessagesMarked,
    detail: { markedCount },
  });
  const rawSummaryText = readAfterLlmCallText(ctx);
  const { locale } = holder.state;
  await relayGuidanceSummary(ctx, { meta, locale, rawSummaryText });
  recordLatestSummaryFullText(ctx, rawSummaryText);
  const { overviewText } = parseSummaryOverviewAndDetailFromText(rawSummaryText);
  applySummaryText(ctx, overviewText || rawSummaryText);
  return markedCount > 0;
}

async function handleAfterLlmCall(ctx, meta) {
  const holder = ensureHarnessBucket(ctx);
  let changed = false;
  if (holder?.state?.flags?.guidanceSummaryMarkPending === true) {
    changed = await applyPendingGuidanceSummary(ctx, meta, holder);
  }
  return (await maybeCapturePlanUpdateByInject(ctx)) || changed;
}

async function handleBeforeLlmCall(ctx, meta) {
  resolveGuidanceSummaryThresholds(ctx, meta);
  resolveGuidanceAnalysisTurnsThreshold(ctx, meta);
  const holder = ensureHarnessBucket(ctx);
  if (holder?.state?.flags?.acceptanceReviewing === true) return false;
  const invariantChanged =
    enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.GUIDANCE }) === true;
  const summaryScheduleChanged = maybeScheduleGuidanceSummary(ctx, meta) === true;
  const scheduleChanged = maybeScheduleGuidanceAnalysis(ctx, meta) === true;
  const state = holder.state;
  const nextAction = resolveNextGuidanceAction(state);
  const decision = resolveGuidancePriorityDecision(state);
  const lifecycle = await runWorkflowLifecycle(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    point: HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    mode: resolvePlanningGuidanceMode(meta),
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
      const execution = await executeGuidanceWorkflowAction({ nextAction, ctx, meta });
      return {
        requestedAction: execution.actionName,
        executedPrimary: execution.executedPrimary,
        executedFollowup: execution.executedFollowup,
        changed: execution.changed || invariantChanged || summaryScheduleChanged || scheduleChanged,
      };
    },
  });
  return lifecycle.execution.changed;
}

function createGuidancePointHandlers(shouldProcessPrimaryToolHooks) {
  const primaryToolHook = (handler) => (ctx, meta) =>
    shouldProcessPrimaryToolHooks(ctx) ? handler(ctx, meta) : false;
  return {
    [HOOK_POINT.AGENT.BEFORE_LLM_CALL]: handleBeforeLlmCall,
    [HOOK_POINT.AGENT.AFTER_TOOL_CALL]: primaryToolHook((ctx) => {
      const signalChanged = markToolSignals(ctx);
      return updateFailureCounters(ctx, ctx.success === false) || signalChanged;
    }),
    [HOOK_POINT.AGENT.TOOL_CALL_ERROR]: primaryToolHook((ctx) => updateFailureCounters(ctx, true)),
    [HOOK_POINT.AGENT.AFTER_TOOL_CALLS]: primaryToolHook(maybeScheduleSummaryByToolBurst),
    [HOOK_POINT.AGENT.AFTER_LLM_CALL]: handleAfterLlmCall,
  };
}

export function createGuidanceHandler({ shouldProcessPrimaryToolHooks }) {
  const pointHandlers = createGuidancePointHandlers(shouldProcessPrimaryToolHooks);
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    const handlePoint = pointHandlers[point];
    const changed = handlePoint ? Boolean(await handlePoint(ctx, meta)) : false;
    return { capability, point, status: "active", changed };
  };
}
