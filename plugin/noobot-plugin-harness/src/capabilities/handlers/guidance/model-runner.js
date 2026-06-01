/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  PROMPT_ENVELOPE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  buildCapabilityModelMessages,
  ensureHarnessBucket,
  extractRawTextContent,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsAttachmentMetas,
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
} from "./revision-engine.js";
import { canAttemptPlanUpdate, setPendingPlanUpdate } from "./plan-update-engine.js";
import { schedulePlanUpdateByInject } from "./revision-injector.js";
import { buildGuidancePromptContent } from "./prompt-injector.js";
import { resolvePendingPlanUpdate } from "./plan-update-scheduler.js";
import { markGuidanceSummarizedMessages } from "./signal-tracker.js";
import { applySummaryText, recordSummaryDetailAttachmentMetas } from "./summary-manager.js";
import {
  parseSummaryOverviewAndDetailFromText,
  resolveSummaryDetailAttachmentText,
} from "../shared/plan/summary-text-protocol.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  buildGuidanceSummaryPromptText,
  buildPostPlanUserFollowupPrompt,
  buildWorkflowResponsibilityConstraintUserPrompt,
} from "../shared/workflow/prompts.js";
import { buildPlanChecklistContextMessages } from "../shared/plan/checklist-context.js";

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
  detailAttachmentMetas = [],
} = {}) {
  const overview = String(overviewText || "").trim();
  const metas = Array.isArray(detailAttachmentMetas) ? detailAttachmentMetas : [];
  if (!metas.length) return overview;
  const lines = metas
    .map((item = {}) => resolveDetailPath(item))
    .filter(Boolean);
  if (!lines.length) return overview;
  const header = locale === LOCALE.EN_US
    ? "[SUMMARY_DETAIL_PATHS]"
    : "【SUMMARY_DETAIL_PATHS】";
  const footer = locale === LOCALE.EN_US
    ? "[SUMMARY_DETAIL_PATHS_END]"
    : "【SUMMARY_DETAIL_PATHS_END】";
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

  const summaryText = String(pendingData.summaryText || "").trim();
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
      summaryText,
      source: "planning_refinement",
      targetMainStepIndexes: Array.isArray(pendingData.targetMainStepIndexes)
        ? pendingData.targetMainStepIndexes
        : [],
    });
    return refinementResult.applied === true;
  }
  return runPlanUpdateAfterSummary(ctx, meta, summaryText);
}

export async function runPlanUpdateAfterSummary(
  ctx = {},
  meta = {},
  summaryText = "",
  { baseMessages = null } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    return schedulePlanUpdateByInject(ctx, summaryText, "revision");
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
  const modelMessages = [
    ...(Array.isArray(baseMessages) ? baseMessages : fallbackMessages),
  ];
  let changed = false;

  if (!canAttemptPlanUpdate(ctx, state, { increment: true, stage: "revision" })) {
    return changed;
  }
  const revisionTask = buildPlanningRevisionPrompt(locale, bucket, state, summaryText);
  const revisionBaseMessages = [
    ...modelMessages,
    ...buildPlanChecklistContextMessages({
      locale,
      planText: bucket?.planText || "",
      bucket,
    }),
  ];
  const revisionMessagesFinal = buildCapabilityModelMessages({
    locale,
    agentMessages: revisionBaseMessages,
    task: revisionTask,
    postTaskMessages: [
      buildWorkflowResponsibilityConstraintUserPrompt(locale, "revision"),
    ],
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
  const revisionAttachmentMetas = await saveCapabilityOutputAsAttachmentMetas(ctx, {
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
    attachmentMetas: revisionAttachmentMetas,
  });
  const revisionApplied = applyRevisedPlanFromText(ctx, revisionText, {
    summary: summaryText,
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
    summaryText,
    targetMainStepIndexes: refinementTargetMainStepIndexes,
  });
  return true;
}

export async function runGuidanceBySeparateModel(ctx = {}, meta = {}) {
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
    // Snapshot current message boundary for summary marking. In separate_model
    // mode, marking happens later (after external model returns), so without
    // this checkpoint newly appended turns may be summarized by mistake.
    state.pending.summaryCheckpointMessageCount = Array.isArray(ctx?.messages)
      ? ctx.messages.length
      : null;
    prompt = buildGuidanceSummaryPromptText({ locale });
    setPendingStateWithMeta(state, "summary", false);
    state.counters.llmTurns = 0;
  } else if (state.pending.guidance) {
    purpose = "guidance";
    reason = state.pending.guidance;
    prompt = buildGuidancePromptContent(locale, reason);
    setPendingStateWithMeta(state, "guidance", null);
    state.counters.consecutiveToolFailures = 0;
    state.counters.totalToolFailures = 0;
  } else {
    return false;
  }

  const modelMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose,
  });
  const modelMessagesWithChecklist =
    purpose === "summary"
      ? [
          ...modelMessages,
          ...buildPlanChecklistContextMessages({
            locale,
            planText: bucket?.planText || "",
            bucket,
          }),
        ]
      : modelMessages;
  const invokerMessages = buildCapabilityModelMessages({
    locale,
    agentMessages: modelMessagesWithChecklist,
    task: prompt,
    postTaskMessages:
      purpose === "summary"
        ? [buildWorkflowResponsibilityConstraintUserPrompt(locale, "summary")]
        : [],
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
  let relayAttachmentMetas = [];
  let summaryMergeText = responseText;
  if (purpose === "summary") {
    const parsedSummary = parseSummaryOverviewAndDetailFromText(responseText);
    const summaryOverviewText = String(parsedSummary?.overviewText || "").trim() || responseText;
    summaryMergeText = summaryOverviewText;
    const summaryDetailAttachmentText = resolveSummaryDetailAttachmentText(parsedSummary);
    const summaryDetailAttachmentMetas = summaryDetailAttachmentText
      ? await saveCapabilityOutputAsAttachmentMetas(ctx, {
        purpose: "summary_detail",
        content: summaryDetailAttachmentText,
        generationSource: "harness_summary_detail",
        domain: CAPABILITY_DOMAIN.GUIDANCE,
      })
      : [];
    recordSummaryDetailAttachmentMetas(ctx, summaryDetailAttachmentMetas);
    relayText = buildSummaryRelayContent({
      locale,
      overviewText: summaryOverviewText,
      detailAttachmentMetas: summaryDetailAttachmentMetas,
    });
    relayAttachmentMetas = summaryDetailAttachmentMetas;
  } else {
    relayAttachmentMetas = await saveCapabilityOutputAsAttachmentMetas(ctx, {
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
    attachmentMetas: relayAttachmentMetas,
  });
  if (purpose === "summary") {
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
        : GUIDANCE_EVENTS.guidanceGeneratedBySeparateModel,
    detail: { reason: reason || undefined },
  });
  return true;
}
