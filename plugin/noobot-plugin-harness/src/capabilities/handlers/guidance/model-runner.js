/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCapabilityActivity } from "@noobot/plugin-protocol";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { randomUUID } from "node:crypto";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  PROMPT_ENVELOPE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  buildCapabilityModelMessages,
  buildCapabilityProtocolModelMessages,
  ensureHarnessBucket,
  normalizeTransferPayload,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsTransferArtifacts,
  invokeCapabilityModel,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityModelName,
  resolveCapabilityToolAllowlist,
  shouldSkipAnalysisForTrailingToolCallContent,
} from "./deps.js";
import { isSummaryCompletionMarked } from "../model-response-parser.js";
import { runPlanningRefinementBySeparateModel } from "../planning/refinement-runner.js";
import {
  applyRevisedPlanFromText,
  buildNextPhaseRelayContent,
  buildPlanningRevisionPrompt,
  resolveRefinementTargetMainStepIndexesAfterRevision,
} from "../planning/revision-engine.js";
import { canAttemptPlanUpdate, setPendingPlanUpdate } from "../planning/plan-update-engine.js";
import { schedulePlanUpdateByInject } from "./revision-injector.js";
import { buildGuidancePromptContent } from "./prompt-injector.js";
import { resolvePendingPlanUpdate } from "../planning/plan-update-scheduler.js";
import {
  captureGuidanceSummaryCheckpoint,
  markGuidanceSummarizedMessages,
} from "./signal-tracker.js";
import {
  applySummaryText,
  recordLatestSummaryFullText,
  recordSummaryTransferEnvelopes,
  resolvePreviousSummaryContextText,
  shouldSaveSummaryToAttachment,
  transferSummaryInjectionMessage,
} from "./summary-manager.js";
import { parseSummaryOverviewAndDetailFromText } from "../shared/plan/summary-text-protocol.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  buildGuidanceSummaryPromptText,
  buildGuidanceAnalysisPromptText,
  getGuidanceAnalysisMarker,
  buildPreviousSummaryContextMessages,
  resolveScenarioPolicyFlagsFromContext,
  buildPostPlanUserFollowupPrompt,
  buildWorkflowResponsibilityConstraintUserPrompt,
  buildScenarioPolicyPromptText,
} from "../shared/workflow/prompts.js";
import { buildPlanChecklistContextMessages } from "../shared/plan/checklist-context.js";
import {
  formatOperationDirectoryForRelay,
  resolveOperationDirectoryContext,
} from "../shared/operation-directory.js";
import { applyDynamicPolicyPromptFromText } from "../shared/workflow/dynamic-policy-prompt.js";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;
const GUIDANCE_DECISION = WORKFLOW_PARAMS.guidance.decisions;

export async function runPendingPlanUpdateBySeparateModel(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  const pendingData = resolvePendingPlanUpdate(state);
  if (!pendingData?.active) return false;

  if (pendingData.stage === GUIDANCE_DECISION.stage.revision) {
    setPendingStateWithMeta(state, "planRevision", false);
  } else {
    setPendingStateWithMeta(state, "planRefinement", false);
  }
  setPendingPlanUpdate(state, { active: false, stage: pendingData.stage });

  if (pendingData.stage === GUIDANCE_DECISION.stage.refinement) {
    if (!canAttemptPlanUpdate(ctx, state, { increment: true, stage: "refinement" })) {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: GUIDANCE_EVENTS.refinementSkippedByMaxAttempts,
        detail: {
          refinementTargetMainStepIndexes: Array.isArray(pendingData.targetMainStepIndexes)
            ? pendingData.targetMainStepIndexes
            : [],
        },
      });
      return false;
    }
    const refinementResult = await runPlanningRefinementBySeparateModel(ctx, meta, {
      source: "planning_refinement",
      targetMainStepIndexes: Array.isArray(pendingData.targetMainStepIndexes)
        ? pendingData.targetMainStepIndexes
        : [],
    });
    return refinementResult.applied === true;
  }
  return runPlanUpdateAfterSummary(ctx, meta);
}

function buildPlanRevisionModelMessages({ ctx, meta, locale, bucket, state, modelMessages }) {
  const { programmingMode, textMode, dynamicPolicyPrompt } = resolveScenarioPolicyFlagsFromContext(
    ctx,
    meta,
  );
  const revisionContextMessages = buildPlanChecklistContextMessages({
    locale,
    planText: bucket?.planText || "",
    bucket,
    ctx,
  })
    .map((item = {}) => String(item?.content || "").trim())
    .filter(Boolean);
  return buildCapabilityProtocolModelMessages({
    locale,
    agentMessages: modelMessages,
    contextMessages: revisionContextMessages,
    protocolPrompt: buildPlanningRevisionPrompt(locale, bucket, state),
    workflowPolicyPrompt: buildScenarioPolicyPromptText(locale, {
      programmingMode,
      textMode,
      dynamicPolicyPrompt,
    }),
    responsibilityPrompt: buildWorkflowResponsibilityConstraintUserPrompt(locale, "revision", {
      programmingMode,
      textMode,
      dynamicPolicyPrompt,
      includeWorkflowPolicy: false,
    }),
  });
}

export async function runPlanUpdateAfterSummary(ctx = {}, meta = {}, { baseMessages = null } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    return schedulePlanUpdateByInject(ctx, "revision");
  }
  const pendingPlanUpdate = resolvePendingPlanUpdate(state);
  if (pendingPlanUpdate?.active) {
    return false;
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const fallbackMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "summary",
  });
  const modelMessages = [...(Array.isArray(baseMessages) ? baseMessages : fallbackMessages)];
  let changed = false;

  if (!canAttemptPlanUpdate(ctx, state, { increment: true, stage: "revision" })) {
    return changed;
  }
  const revisionMessagesFinal = buildPlanRevisionModelMessages({
    ctx,
    meta,
    locale,
    bucket,
    state,
    modelMessages,
  });
  let revisionResponse = null;
  try {
    revisionResponse = await invokeCapabilityModel({
      invoker,
      invokePayload: {
        purpose: "planning_revision",
        promptVersion: PROMPT_ENVELOPE.VERSION,
        envelopeType: PROMPT_ENVELOPE.TYPE,
        domain: CAPABILITY_DOMAIN.PLANNING,
        model: resolveCapabilityModelName(meta, {
          purpose: "planning_revision",
          domain: CAPABILITY_DOMAIN.PLANNING,
        }),
        locale,
        prompt: "",
        messages: revisionMessagesFinal,
        ctx,
        toolAllowlist: resolveCapabilityToolAllowlist(meta, "planning_revision"),
      },
      purpose: "planning_revision",
      domain: CAPABILITY_DOMAIN.PLANNING,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, {
          domain: CAPABILITY_DOMAIN.PLANNING,
          purpose: "planning_revision",
          response: retryResponse,
        });
      },
      ctx,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: GUIDANCE_EVENTS.revisionModelFailed,
      detail: { error: String(error?.message || error || "") },
    });
    return changed;
  }
  const revisionText = String(revisionResponse?.output?.text || "").trim();
  applyDynamicPolicyPromptFromText(ctx, revisionText, {
    source: "planning_revision",
    stage: "revision",
  });
  const revisionAttachments = await saveCapabilityOutputAsTransferArtifacts(ctx, {
    purpose: "planning_revision",
    content: revisionText,
    generationSource: "harness_planning_revision",
    domain: CAPABILITY_DOMAIN.PLANNING,
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "planning_revision",
    content: revisionText,
    dedupe: true,
    transferPayload: normalizeTransferPayload(revisionAttachments),
  });
  const revisionApplied = applyRevisedPlanFromText(ctx, revisionText, {
    source: "planning_revision",
    stage: "revision",
  });
  if (!revisionApplied) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: GUIDANCE_EVENTS.revisionNotApplied,
      detail: { hasResponseText: Boolean(revisionText) },
    });
    return changed;
  }
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "next_phase_plan",
    content: buildNextPhaseRelayContent(bucket, locale, "revision"),
    dedupe: true,
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "next_phase_plan_followup",
    content: buildPostPlanUserFollowupPrompt(locale, "revision"),
    dedupe: true,
  });
  changed = true;
  const refinementTargetMainStepIndexes = resolveRefinementTargetMainStepIndexesAfterRevision(
    bucket,
    state,
  );
  if (!refinementTargetMainStepIndexes.length) {
    return changed;
  }
  if (!canAttemptPlanUpdate(ctx, state, { increment: false, stage: "refinement" })) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: GUIDANCE_EVENTS.refinementSkippedByMaxAttempts,
      detail: {
        refinementTargetMainStepIndexes,
      },
    });
    return changed;
  }
  setPendingPlanUpdate(state, {
    active: true,
    stage: "refinement",
    targetMainStepIndexes: refinementTargetMainStepIndexes,
  });
  return true;
}

function resolveAnalysisFlowTags(workflowPurpose) {
  const isAnalysis = workflowPurpose === "analysis";
  return {
    pluginFlow: isAnalysis ? "analysis" : undefined,
    chain: isAnalysis ? "auxiliary" : undefined,
  };
}

function summaryCheckpointMessageCount(state) {
  return Array.isArray(state?.pending?.summaryCheckpointMessageIds)
    ? state.pending.summaryCheckpointMessageIds.length
    : 0;
}

function isActionAllowed(requestedAction, decisionAction) {
  return requestedAction === "auto" || requestedAction === decisionAction;
}

function selectSummaryRequest(ctx, state, policy) {
  captureGuidanceSummaryCheckpoint(ctx, state);
  return {
    purpose: "summary",
    workflowPurpose: "summary",
    reason: "",
    prompt: buildGuidanceSummaryPromptText({ ...policy, includeWorkflowPolicy: false }),
  };
}

function selectGuidanceAdviceRequest(state, policy) {
  const reason = state.pending.guidance;
  const { locale, ...flags } = policy;
  const prompt = buildGuidancePromptContent(locale, reason, {
    includeMarker: true,
    ...flags,
    includeWorkflowPolicy: false,
  });
  setPendingStateWithMeta(state, "guidance", null);
  state.counters.consecutiveToolFailures = 0;
  state.counters.totalToolFailures = 0;
  return { purpose: "guidance", workflowPurpose: "guidance", reason, prompt };
}

function selectAnalysisRequest(ctx, state, locale) {
  if (shouldSkipAnalysisForTrailingToolCallContent(ctx?.modelContext?.messages)) return null;
  const prompt = buildGuidanceAnalysisPromptText({
    locale,
    marker: getGuidanceAnalysisMarker(locale),
  });
  setPendingStateWithMeta(state, "analysis", false);
  return { purpose: "guidance", workflowPurpose: "analysis", reason: "", prompt };
}

function selectGuidanceRequest({ ctx, state, action, policy }) {
  const requestedAction = String(action || "auto")
    .trim()
    .toLowerCase();
  if (
    isActionAllowed(requestedAction, GUIDANCE_DECISION.action.summary) &&
    state.pending.summary === true
  )
    return selectSummaryRequest(ctx, state, policy);
  if (isActionAllowed(requestedAction, GUIDANCE_DECISION.action.guidance) && state.pending.guidance)
    return selectGuidanceAdviceRequest(state, policy);
  if (
    isActionAllowed(requestedAction, GUIDANCE_DECISION.action.analysis) &&
    state.pending.analysis === true
  )
    return selectAnalysisRequest(ctx, state, policy.locale);
  return null;
}

function buildGuidanceWorkflowContextContents({ ctx, bucket, locale, purpose }) {
  const planChecklistContextMessages = buildPlanChecklistContextMessages({
    locale,
    planText: bucket?.planText || "",
    bucket,
    ctx,
  });
  const workflowContextMessages =
    purpose === "summary"
      ? [
          ...planChecklistContextMessages,
          ...buildPreviousSummaryContextMessages({
            locale,
            previousSummaryContent: resolvePreviousSummaryContextText(ctx),
          }),
        ]
      : planChecklistContextMessages;
  return workflowContextMessages
    .map((item = {}) => String(item?.content || "").trim())
    .filter(Boolean);
}

function buildGuidanceInvokerMessages({ ctx, meta, bucket, policy, request }) {
  const { locale, ...flags } = policy;
  const { purpose, workflowPurpose, prompt } = request;
  const modelMessages = resolveCapabilityModelMessages(meta, { ctx, purpose });
  const workflowContextContents = buildGuidanceWorkflowContextContents({
    ctx,
    bucket,
    locale,
    purpose,
  });
  const workflowPolicyPrompt = buildScenarioPolicyPromptText(locale, flags);
  const responsibilityPrompt =
    workflowPurpose === "summary" || workflowPurpose === "analysis"
      ? buildWorkflowResponsibilityConstraintUserPrompt(locale, workflowPurpose, {
          ...flags,
          includeWorkflowPolicy: false,
        })
      : "";
  if (workflowPurpose === "guidance" || workflowPurpose === "analysis") {
    return buildCapabilityModelMessages({
      locale,
      agentMessages: modelMessages,
      task: prompt,
      taskRole: "user",
      postTaskSystemMessages: workflowPurpose === "guidance" ? [workflowPolicyPrompt] : [],
      postTaskMessages: [...workflowContextContents, responsibilityPrompt],
      postTaskRole: "user",
    });
  }
  return buildCapabilityProtocolModelMessages({
    locale,
    agentMessages: modelMessages,
    contextMessages: workflowContextContents,
    protocolPrompt: prompt,
    workflowPolicyPrompt,
    responsibilityPrompt,
  });
}

function logGuidanceModelFailure(ctx, { purpose, summaryStartedAt, error }) {
  if (purpose === "summary") {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_model_failed",
      detail: {
        durationMs: Date.now() - summaryStartedAt,
        error: String(error?.message || error || ""),
      },
    });
  }
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: GUIDANCE_EVENTS.separateModelCallFailed,
    detail: { purpose, error: String(error?.message || error || "") },
  });
}

async function invokeGuidanceModel({
  ctx,
  meta,
  state,
  invoker,
  locale,
  request,
  messages,
  relayCorrelationId,
}) {
  const { purpose, workflowPurpose } = request;
  const flowTags = resolveAnalysisFlowTags(workflowPurpose);
  const summaryStartedAt = purpose === "summary" ? Date.now() : 0;
  if (purpose === "summary") {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_model_started",
      detail: { requestedMessageCount: summaryCheckpointMessageCount(state) },
    });
  }
  try {
    const response = await invokeCapabilityModel({
      invoker,
      invokePayload: {
        purpose,
        activity:
          workflowPurpose === "analysis" ? defineCapabilityActivity("guidance_analysis") : null,
        ...flowTags,
        relayCorrelationId,
        promptVersion: PROMPT_ENVELOPE.VERSION,
        envelopeType: PROMPT_ENVELOPE.TYPE,
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        model: resolveCapabilityModelName(meta, { purpose, domain: CAPABILITY_DOMAIN.GUIDANCE }),
        locale,
        prompt: "",
        messages,
        ctx,
        toolAllowlist: resolveCapabilityToolAllowlist(meta, purpose),
      },
      purpose,
      ...flowTags,
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          purpose,
          ...flowTags,
          response: retryResponse,
        });
      },
      ctx,
      meta,
    });
    return { ok: true, response, summaryStartedAt };
  } catch (error) {
    logGuidanceModelFailure(ctx, { purpose, summaryStartedAt, error });
    return { ok: false, summaryStartedAt };
  }
}

async function prepareSummaryRelay(ctx, meta, responseText) {
  const parsedSummary = parseSummaryOverviewAndDetailFromText(responseText);
  const summaryMergeText = String(parsedSummary?.overviewText || "").trim() || responseText;
  const summaryTransferPayload =
    shouldSaveSummaryToAttachment(meta) && responseText
      ? await saveCapabilityOutputAsTransferArtifacts(ctx, {
          purpose: "summary",
          content: responseText,
          generationSource: "harness_summary",
          domain: CAPABILITY_DOMAIN.GUIDANCE,
        })
      : { transferEnvelopes: [] };
  recordSummaryTransferEnvelopes(ctx, summaryTransferPayload);
  const injectedText = await transferSummaryInjectionMessage(ctx, {
    fullText: responseText,
    summaryText: responseText,
    detailText: responseText,
    injectMode: "full",
    meta,
  });
  const relayText = [
    injectedText || responseText,
    formatOperationDirectoryForRelay(resolveOperationDirectoryContext(ctx)),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { relayText, relayAttachments: summaryTransferPayload, summaryMergeText };
}

async function prepareGuidanceRelay(ctx, meta, request, responseText) {
  const { purpose, workflowPurpose } = request;
  if (purpose === "summary") return prepareSummaryRelay(ctx, meta, responseText);
  const relayAttachments =
    workflowPurpose !== "analysis"
      ? await saveCapabilityOutputAsTransferArtifacts(ctx, {
          purpose,
          content: responseText,
          generationSource: `harness_${String(purpose || "").trim() || "guidance"}`,
          domain: CAPABILITY_DOMAIN.GUIDANCE,
        })
      : [];
  return { relayText: responseText, relayAttachments, summaryMergeText: responseText };
}

async function finalizeSummaryGuidance({
  ctx,
  meta,
  state,
  locale,
  responseText,
  summaryMergeText,
  summaryStartedAt,
}) {
  recordLatestSummaryFullText(ctx, responseText);
  const mergedSummaryText = applySummaryText(ctx, summaryMergeText);
  const checkpointRequestedMessageCount = summaryCheckpointMessageCount(state);
  const checkpointStartedAt = Date.now();
  const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
  setPendingStateWithMeta(state, "summary", false);
  state.counters.summaryTurns = 0;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: "summary_checkpoint_ready",
    detail: {
      modelDurationMs: Date.now() - summaryStartedAt,
      checkpointPreparationMs: Date.now() - checkpointStartedAt,
      requestedMessageCount: checkpointRequestedMessageCount,
      markedCount,
    },
  });
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: GUIDANCE_EVENTS.summaryMessagesMarked,
    detail: { markedCount },
  });
  if (!isSummaryCompletionMarked(mergedSummaryText, locale)) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: GUIDANCE_EVENTS.summaryCompletionMarkerMissing,
    });
  }
}

function guidanceGeneratedEvent(workflowPurpose) {
  if (workflowPurpose === "summary") return GUIDANCE_EVENTS.summaryGeneratedBySeparateModel;
  if (workflowPurpose === "analysis") return GUIDANCE_EVENTS.analysisGeneratedBySeparateModel;
  return GUIDANCE_EVENTS.guidanceGeneratedBySeparateModel;
}

function recordGuidanceOutput(bucket, request, flowTags, responseText) {
  if (!Array.isArray(bucket.guidanceOutputs)) {
    bucket.guidanceOutputs = [];
  }
  bucket.guidanceOutputs.push({
    purpose: request.purpose,
    ...flowTags,
    reason: request.reason || undefined,
    content: responseText,
    timestamp: new Date().toISOString(),
  });
}

export async function runGuidanceBySeparateModel(ctx = {}, meta = {}, { action = "auto" } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  const locale = state?.locale || LOCALE.ZH_CN;
  const { programmingMode, textMode, dynamicPolicyPrompt } = resolveScenarioPolicyFlagsFromContext(
    ctx,
    meta,
  );
  const policy = { locale, programmingMode, textMode, dynamicPolicyPrompt };
  const request = selectGuidanceRequest({ ctx, state, action, policy });
  if (!request) return false;
  const { purpose, workflowPurpose, reason } = request;
  const flowTags = resolveAnalysisFlowTags(workflowPurpose);
  const messages = buildGuidanceInvokerMessages({ ctx, meta, bucket, policy, request });
  const relayCorrelationId = `rc_${randomUUID()}`;
  const invocation = await invokeGuidanceModel({
    ctx,
    meta,
    state,
    invoker,
    locale,
    request,
    messages,
    relayCorrelationId,
  });
  if (!invocation.ok) return false;
  const responseText = String(invocation.response?.output?.text || "").trim();
  const { relayText, relayAttachments, summaryMergeText } = await prepareGuidanceRelay(
    ctx,
    meta,
    request,
    responseText,
  );
  recordGuidanceOutput(bucket, request, flowTags, responseText);
  const relayInjected = relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose,
    ...flowTags,
    relayCorrelationId,
    content: relayText,
    transferPayload: normalizeTransferPayload(relayAttachments),
  });
  if (!relayInjected) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: GUIDANCE_EVENTS.separateModelRelayFailed,
      detail: { purpose, workflowPurpose, hasResponseText: Boolean(responseText) },
    });
    return false;
  }
  if (purpose === "summary") {
    await finalizeSummaryGuidance({
      ctx,
      meta,
      state,
      locale,
      responseText,
      summaryMergeText,
      summaryStartedAt: invocation.summaryStartedAt,
    });
  }
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: guidanceGeneratedEvent(workflowPurpose),
    detail: { reason: reason || undefined },
  });
  return true;
}
