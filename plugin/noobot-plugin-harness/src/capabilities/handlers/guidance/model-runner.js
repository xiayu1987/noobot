/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  PROMPT_ENVELOPE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  buildCapabilityModelMessages,
  buildCapabilityProtocolModelMessages,
  ensureHarnessBucket,
  extractRawTextContent,
  normalizeTransferPayload,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsTransferArtifacts,
  invokeCapabilityModel,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityModelName,
  resolveCapabilityToolAllowlist,
  translateI18nText,
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
  const { programmingMode, textMode, dynamicPolicyPrompt } = resolveScenarioPolicyFlagsFromContext(
    ctx,
    meta,
  );
  const fallbackMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "summary",
  });
  const modelMessages = [...(Array.isArray(baseMessages) ? baseMessages : fallbackMessages)];
  let changed = false;

  if (!canAttemptPlanUpdate(ctx, state, { increment: true, stage: "revision" })) {
    return changed;
  }
  const revisionTask = buildPlanningRevisionPrompt(locale, bucket, state);
  const revisionContextMessages = buildPlanChecklistContextMessages({
    locale,
    planText: bucket?.planText || "",
    bucket,
    ctx,
  })
    .map((item = {}) => String(item?.content || "").trim())
    .filter(Boolean);
  const revisionWorkflowPolicyPrompt = buildScenarioPolicyPromptText(locale, {
    programmingMode,
    textMode,
    dynamicPolicyPrompt,
  });
  const revisionMessagesFinal = buildCapabilityProtocolModelMessages({
    locale,
    agentMessages: modelMessages,
    contextMessages: revisionContextMessages,
    protocolPrompt: revisionTask,
    workflowPolicyPrompt: revisionWorkflowPolicyPrompt,
    responsibilityPrompt: buildWorkflowResponsibilityConstraintUserPrompt(locale, "revision", {
      programmingMode,
      textMode,
      dynamicPolicyPrompt,
      includeWorkflowPolicy: false,
    }),
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
  const flagsAfterRevision = resolveScenarioPolicyFlagsFromContext(ctx, meta);
  const dynamicPolicyPromptAfterRevision =
    flagsAfterRevision.dynamicPolicyPrompt || dynamicPolicyPrompt;
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
    content: buildPostPlanUserFollowupPrompt(locale, "revision", {
      programmingMode: flagsAfterRevision.programmingMode,
      textMode: flagsAfterRevision.textMode,
      dynamicPolicyPrompt: dynamicPolicyPromptAfterRevision,
    }),
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

  const requestedAction = String(action || "auto")
    .trim()
    .toLowerCase();
  const allowSummary =
    requestedAction === "auto" || requestedAction === GUIDANCE_DECISION.action.summary;
  const allowGuidance =
    requestedAction === "auto" || requestedAction === GUIDANCE_DECISION.action.guidance;
  const allowAnalysis =
    requestedAction === "auto" || requestedAction === GUIDANCE_DECISION.action.analysis;

  let purpose = "";
  let workflowPurpose = "";
  let prompt = "";
  let reason = "";
  if (allowSummary && state.pending.summary === true) {
    purpose = "summary";
    workflowPurpose = "summary";
    captureGuidanceSummaryCheckpoint(ctx, state);
    prompt = buildGuidanceSummaryPromptText({
      locale,
      programmingMode,
      textMode,
      dynamicPolicyPrompt,
      includeWorkflowPolicy: false,
    });
    setPendingStateWithMeta(state, "summary", false);
    state.counters.summaryTurns = 0;
  } else if (allowGuidance && state.pending.guidance) {
    purpose = "guidance";
    workflowPurpose = "guidance";
    reason = state.pending.guidance;
    prompt = buildGuidancePromptContent(locale, reason, {
      programmingMode,
      textMode,
      dynamicPolicyPrompt,
      includeWorkflowPolicy: false,
    });
    setPendingStateWithMeta(state, "guidance", null);
    state.counters.consecutiveToolFailures = 0;
    state.counters.totalToolFailures = 0;
  } else if (allowAnalysis && state.pending.analysis === true) {
    if (shouldSkipAnalysisForTrailingToolCallContent(ctx?.modelContext?.messages)) {
      return false;
    }
    purpose = "guidance";
    workflowPurpose = "analysis";
    prompt = buildGuidanceAnalysisPromptText({
      locale,
      marker: getGuidanceAnalysisMarker(locale),
    });
    setPendingStateWithMeta(state, "analysis", false);
  } else {
    return false;
  }

  const modelMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose,
  });
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
  const workflowContextContents = workflowContextMessages
    .map((item = {}) => String(item?.content || "").trim())
    .filter(Boolean);
  const workflowPolicyPrompt = buildScenarioPolicyPromptText(locale, {
    programmingMode,
    textMode,
    dynamicPolicyPrompt,
  });
  const responsibilityPrompt =
    workflowPurpose === "summary" || workflowPurpose === "analysis"
      ? buildWorkflowResponsibilityConstraintUserPrompt(locale, workflowPurpose, {
          programmingMode,
          textMode,
          dynamicPolicyPrompt,
          includeWorkflowPolicy: false,
        })
      : "";
  const invokerMessages =
    workflowPurpose === "analysis"
      ? buildCapabilityModelMessages({
          locale,
          agentMessages: modelMessages,
          task: prompt,
          taskRole: "user",
          postTaskMessages: [...workflowContextContents, responsibilityPrompt],
          postTaskRole: "user",
        })
      : buildCapabilityProtocolModelMessages({
          locale,
          agentMessages: modelMessages,
          contextMessages: workflowContextContents,
          protocolPrompt: prompt,
          workflowPolicyPrompt,
          responsibilityPrompt,
        });

  let response = null;
  const summaryStartedAt = purpose === "summary" ? Date.now() : 0;
  if (purpose === "summary") {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_model_started",
      detail: {
        requestedMessageCount: Array.isArray(state?.pending?.summaryCheckpointMessageIds)
          ? state.pending.summaryCheckpointMessageIds.length
          : 0,
      },
    });
  }
  try {
    response = await invokeCapabilityModel({
      invoker,
      invokePayload: {
        purpose,
        pluginFlow: workflowPurpose === "analysis" ? "analysis" : undefined,
        chain: workflowPurpose === "analysis" ? "auxiliary" : undefined,
        promptVersion: PROMPT_ENVELOPE.VERSION,
        envelopeType: PROMPT_ENVELOPE.TYPE,
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        model: resolveCapabilityModelName(meta, {
          purpose,
          domain: CAPABILITY_DOMAIN.GUIDANCE,
        }),
        locale,
        prompt: "",
        messages: invokerMessages,
        ctx,
        toolAllowlist: resolveCapabilityToolAllowlist(meta, purpose),
      },
      purpose,
      pluginFlow: workflowPurpose === "analysis" ? "analysis" : undefined,
      chain: workflowPurpose === "analysis" ? "auxiliary" : undefined,
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          purpose,
          pluginFlow: workflowPurpose === "analysis" ? "analysis" : undefined,
          chain: workflowPurpose === "analysis" ? "auxiliary" : undefined,
          response: retryResponse,
        });
      },
      ctx,
      meta,
    });
  } catch (error) {
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
    return false;
  }
  const responseText = String(response?.output?.text || "").trim();
  let relayText = responseText;
  let relayAttachments = [];
  let summaryMergeText = responseText;
  if (purpose === "summary") {
    const parsedSummary = parseSummaryOverviewAndDetailFromText(responseText);
    const summaryOverviewText = String(parsedSummary?.overviewText || "").trim() || responseText;
    summaryMergeText = summaryOverviewText;
    const persistSummaryAttachment = shouldSaveSummaryToAttachment(meta);
    const summaryTransferPayload =
      persistSummaryAttachment && responseText
        ? await saveCapabilityOutputAsTransferArtifacts(ctx, {
            purpose: "summary",
            content: responseText,
            generationSource: "harness_summary",
            domain: CAPABILITY_DOMAIN.GUIDANCE,
          })
        : { transferEnvelopes: [] };
    recordSummaryTransferEnvelopes(ctx, summaryTransferPayload);
    relayText = await transferSummaryInjectionMessage(ctx, {
      fullText: responseText,
      summaryText: responseText,
      detailText: responseText,
      injectMode: "full",
      meta,
    });
    relayText = [
      relayText || responseText,
      formatOperationDirectoryForRelay(resolveOperationDirectoryContext(ctx)),
    ]
      .filter(Boolean)
      .join("\n\n");
    relayAttachments = summaryTransferPayload;
  } else if (workflowPurpose !== "analysis") {
    relayAttachments = await saveCapabilityOutputAsTransferArtifacts(ctx, {
      purpose,
      content: responseText,
      generationSource: `harness_${String(purpose || "").trim() || "guidance"}`,
      domain: CAPABILITY_DOMAIN.GUIDANCE,
    });
  }
  if (!Array.isArray(bucket.guidanceOutputs)) {
    bucket.guidanceOutputs = [];
  }
  bucket.guidanceOutputs.push({
    purpose,
    pluginFlow: workflowPurpose === "analysis" ? "analysis" : undefined,
    chain: workflowPurpose === "analysis" ? "auxiliary" : undefined,
    reason: reason || undefined,
    content: responseText,
    timestamp: new Date().toISOString(),
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose,
    pluginFlow: workflowPurpose === "analysis" ? "analysis" : undefined,
    chain: workflowPurpose === "analysis" ? "auxiliary" : undefined,
    content: relayText,
    transferPayload: normalizeTransferPayload(relayAttachments),
  });
  if (purpose === "summary") {
    recordLatestSummaryFullText(ctx, responseText);
    const mergedSummaryText = applySummaryText(ctx, summaryMergeText);
    const checkpointRequestedMessageCount = Array.isArray(
      state?.pending?.summaryCheckpointMessageIds,
    )
      ? state.pending.summaryCheckpointMessageIds.length
      : 0;
    const checkpointStartedAt = Date.now();
    const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
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
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event:
      workflowPurpose === "summary"
        ? GUIDANCE_EVENTS.summaryGeneratedBySeparateModel
        : workflowPurpose === "analysis"
          ? GUIDANCE_EVENTS.analysisGeneratedBySeparateModel
          : GUIDANCE_EVENTS.guidanceGeneratedBySeparateModel,
    detail: { reason: reason || undefined },
  });
  return true;
}
