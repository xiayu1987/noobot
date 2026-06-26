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
  getTransferPayloadFromAttachments,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsTransferArtifacts,
  invokeWithReasoningRetry,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityModelName,
  resolveCapabilityToolAllowlist,
  translateI18nText,
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
import { markGuidanceSummarizedMessages } from "./signal-tracker.js";
import { getMessageId } from "../../../core/message-store.js";
import {
  applySummaryText,
  recordLatestSummaryFullText,
  recordSummaryDetailAttachments,
  resolvePreviousSummaryContextText,
  shouldSaveSummaryDetailToAttachment,
  transferSummaryInjectionMessage,
} from "./summary-manager.js";
import {
  parseSummaryOverviewAndDetailFromText,
  resolveSummaryDetailAttachmentText,
} from "../shared/plan/summary-text-protocol.js";
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

function resolveDetailPath(meta = {}) {
  const relativePath = String(meta?.relativePath || "").trim();
  if (relativePath) return relativePath;
  const path = String(meta?.path || "").trim();
  if (path) return path;
  const name = String(meta?.name || "").trim();
  return name;
}

function buildSummaryRelayContent({
  locale = LOCALE.ZH_CN,
  overviewText = "",
  detailAttachments = [],
} = {}) {
  const overview = String(overviewText || "").trim();
  const metas = Array.isArray(detailAttachments) ? detailAttachments : [];
  if (!metas.length) return overview;
  const lines = metas
    .map((item = {}) => resolveDetailPath(item))
    .filter(Boolean);
  if (!lines.length) return overview;
  const header = translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.SUMMARY_DETAIL_PATHS_HEADER);
  const footer = translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.SUMMARY_DETAIL_PATHS_FOOTER);
  const pathBlock = [
    header,
    ...lines.map((item) => `DETAIL_PATH: ${item}`),
    footer,
  ].join("\n");
  return [overview, pathBlock].filter(Boolean).join("\n\n").trim();
}

export async function runPendingPlanUpdateBySeparateModel(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  const pendingData = resolvePendingPlanUpdate(state);
  if (!pendingData?.active) return false;

  // Consume pending revision/refinement once dispatched to avoid repeated replay.
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

export async function runPlanUpdateAfterSummary(
  ctx = {},
  meta = {},
  { baseMessages = null } = {},
) {
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
  const {
    programmingMode,
    textMode,
    dynamicPolicyPrompt,
  } = resolveScenarioPolicyFlagsFromContext(ctx, meta);
  const fallbackMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "summary",
  });
  const modelMessages = [
    ...(Array.isArray(baseMessages) ? baseMessages : fallbackMessages),
  ];
  let changed = false;

  if (!canAttemptPlanUpdate(ctx, state, { increment: true, stage: "revision" })) {
    return changed;
  }
  const revisionTask = buildPlanningRevisionPrompt(locale, bucket, state);
  const revisionBaseMessages = [
    ...modelMessages,
    ...buildPlanChecklistContextMessages({
      locale,
      planText: bucket?.planText || "",
      bucket,
      ctx,
    }),
  ];
  const revisionWorkflowPolicyPrompt = buildScenarioPolicyPromptText(locale, {
    programmingMode,
    textMode,
    dynamicPolicyPrompt,
  });
  const revisionMessagesFinal = buildCapabilityProtocolModelMessages({
    locale,
    agentMessages: revisionBaseMessages,
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
    revisionResponse = await invokeWithReasoningRetry({
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
      maxReasoningRetries: 1,
      purpose: "planning_revision",
      domain: CAPABILITY_DOMAIN.PLANNING,
      appendCapabilityLog,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, meta, {
          domain: CAPABILITY_DOMAIN.PLANNING,
          purpose: "planning_revision",
          response: retryResponse,
        });
      },
      ctx,
      meta,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: GUIDANCE_EVENTS.revisionModelFailed,
      detail: { error: String(error?.message || error || "") },
    });
    return changed;
  }
  const revisionText =
    extractRawTextContent(revisionResponse?.content) ||
    String(revisionResponse?.text || revisionResponse?.output || "").trim();
  applyDynamicPolicyPromptFromText(ctx, revisionText, {
    source: "planning_revision",
    stage: "revision",
  });
  const flagsAfterRevision = resolveScenarioPolicyFlagsFromContext(ctx, meta);
  const dynamicPolicyPromptAfterRevision = flagsAfterRevision.dynamicPolicyPrompt || dynamicPolicyPrompt;
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
    transferPayload: getTransferPayloadFromAttachments(revisionAttachments),
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
  const {
    programmingMode,
    textMode,
    dynamicPolicyPrompt,
  } = resolveScenarioPolicyFlagsFromContext(ctx, meta);

  const requestedAction = String(action || "auto").trim().toLowerCase();
  const allowSummary = requestedAction === "auto" || requestedAction === GUIDANCE_DECISION.action.summary;
  const allowGuidance = requestedAction === "auto" || requestedAction === GUIDANCE_DECISION.action.guidance;
  const allowAnalysis = requestedAction === "auto" || requestedAction === GUIDANCE_DECISION.action.analysis;

  let purpose = "";
  let prompt = "";
  let reason = "";
  if (allowSummary && state.pending.summary === true) {
    purpose = "summary";
    // Snapshot current message boundary for summary marking. In separate_model
    // mode, marking happens later (after external model returns), so without
    // this checkpoint newly appended turns may be summarized by mistake.
    state.pending.summaryCheckpointMessageCount = Array.isArray(ctx?.messages)
      ? ctx.messages.length
      : null;
    state.pending.summaryCheckpointMessageIds = Array.isArray(ctx?.messages)
      ? ctx.messages.map((message) => getMessageId(message)).filter(Boolean)
      : null;
    prompt = buildGuidanceSummaryPromptText({
      locale,
      programmingMode,
      textMode,
      dynamicPolicyPrompt,
      includeWorkflowPolicy: false,
    });
    setPendingStateWithMeta(state, "summary", false);
    state.counters.llmTurns = 0;
  } else if (allowGuidance && state.pending.guidance) {
    purpose = "guidance";
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
    purpose = "analysis";
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
  const modelMessagesWithChecklist =
    purpose === "summary"
      ? [
          ...modelMessages,
          ...planChecklistContextMessages,
          ...buildPreviousSummaryContextMessages({
            locale,
            previousSummaryContent: resolvePreviousSummaryContextText(ctx),
          }),
        ]
      : [
          ...modelMessages,
          ...planChecklistContextMessages,
        ];
  const workflowPolicyPrompt = buildScenarioPolicyPromptText(locale, {
    programmingMode,
    textMode,
    dynamicPolicyPrompt,
  });
  const responsibilityPrompt =
    purpose === "summary" || purpose === "analysis"
      ? buildWorkflowResponsibilityConstraintUserPrompt(locale, purpose, {
          programmingMode,
          textMode,
          dynamicPolicyPrompt,
          includeWorkflowPolicy: false,
        })
      : "";
  const invokerMessages = purpose === "analysis"
    ? buildCapabilityModelMessages({
        locale,
        agentMessages: modelMessagesWithChecklist,
        task: prompt,
        taskRole: "user",
        postTaskMessages: [responsibilityPrompt],
        postTaskRole: "user",
      })
    : buildCapabilityProtocolModelMessages({
        locale,
        agentMessages: modelMessagesWithChecklist,
        protocolPrompt: prompt,
        workflowPolicyPrompt,
        responsibilityPrompt,
      });

  let response = null;
  try {
    response = await invokeWithReasoningRetry({
      invoker,
      invokePayload: {
        purpose,
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
      maxReasoningRetries: 1,
      purpose,
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      appendCapabilityLog,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, meta, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          purpose,
          response: retryResponse,
        });
      },
      ctx,
      meta,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: GUIDANCE_EVENTS.separateModelCallFailed,
      detail: { purpose, error: String(error?.message || error || "") },
    });
    return false;
  }
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  let relayText = responseText;
  let relayAttachments = [];
  let summaryMergeText = responseText;
  if (purpose === "summary") {
    const parsedSummary = parseSummaryOverviewAndDetailFromText(responseText);
    const summaryOverviewText = String(parsedSummary?.overviewText || "").trim() || responseText;
    summaryMergeText = summaryOverviewText;
    const saveDetailToAttachment = shouldSaveSummaryDetailToAttachment(meta);
    const summaryDetailAttachmentText = resolveSummaryDetailAttachmentText(parsedSummary);
    const summaryDetailAttachments = saveDetailToAttachment && summaryDetailAttachmentText
      ? await saveCapabilityOutputAsTransferArtifacts(ctx, {
        purpose: "summary_detail",
        content: summaryDetailAttachmentText,
        generationSource: "harness_summary_detail",
        domain: CAPABILITY_DOMAIN.GUIDANCE,
      })
      : [];
    recordSummaryDetailAttachments(ctx, summaryDetailAttachments);
    const baseRelayText = saveDetailToAttachment
      ? buildSummaryRelayContent({
          locale,
          overviewText: summaryOverviewText,
          detailAttachments: summaryDetailAttachments,
        })
      : responseText;
    relayText = await transferSummaryInjectionMessage(ctx, {
      fullText: responseText,
      summaryText: baseRelayText,
      detailText: summaryDetailAttachmentText,
      injectMode: saveDetailToAttachment ? "summary" : "full",
      meta,
    });
    relayText = [
      relayText || baseRelayText,
      formatOperationDirectoryForRelay(resolveOperationDirectoryContext(ctx)),
    ].filter(Boolean).join("\n\n");
    relayAttachments = summaryDetailAttachments;
  } else if (purpose !== "analysis") {
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
    reason: reason || undefined,
    content: responseText,
    timestamp: new Date().toISOString(),
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose,
    content: relayText,
    transferPayload: getTransferPayloadFromAttachments(relayAttachments),
  });
  if (purpose === "summary") {
    recordLatestSummaryFullText(ctx, responseText);
    const mergedSummaryText = applySummaryText(ctx, summaryMergeText);
    const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
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
      purpose === "summary"
        ? GUIDANCE_EVENTS.summaryGeneratedBySeparateModel
        : purpose === "analysis"
          ? GUIDANCE_EVENTS.analysisGeneratedBySeparateModel
          : GUIDANCE_EVENTS.guidanceGeneratedBySeparateModel,
    detail: { reason: reason || undefined },
  });
  return true;
}
