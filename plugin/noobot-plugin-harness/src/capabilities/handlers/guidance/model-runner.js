/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
} from "./revision-engine.js";
import { canAttemptPlanUpdate } from "./plan-update-engine.js";
import { schedulePlanUpdateByInject } from "./revision-injector.js";
import { buildGuidancePromptContent } from "./prompt-injector.js";
import { markGuidanceSummarizedMessages } from "./signal-tracker.js";
import { applySummaryText } from "./summary-manager.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import { buildGuidanceSummaryPromptText } from "../shared/workflow-prompts.js";
import { buildPlanChecklistContextMessages } from "../shared/plan-checklist-context.js";

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
      event: "planning_revision_model_failed",
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
      event: "planning_revision_not_applied",
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
  changed = true;
  const mainPlanChanged = bucket?.lastMainPlanRevisionChanged === true;
  if (!mainPlanChanged) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_skipped_no_main_plan_change",
    });
    return changed;
  }

  if (!canAttemptPlanUpdate(ctx, state, { increment: true, stage: "refinement" })) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_skipped_by_max_attempts",
    });
    return changed;
  }
  const refinementResult = await runPlanningRefinementBySeparateModel(ctx, meta, {
    summaryText,
    source: "planning_refinement",
    baseMessages: modelMessages,
  });
  return refinementResult.applied === true ? true : changed;
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
      event: "guidance_separate_model_call_failed",
      detail: { purpose, error: String(error?.message || error || "") },
    });
    return false;
  }
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  const responseAttachmentMetas = await saveCapabilityOutputAsAttachmentMetas(ctx, {
    purpose,
    content: responseText,
    generationSource: `harness_${String(purpose || "").trim() || "guidance"}`,
    domain: CAPABILITY_DOMAIN.GUIDANCE,
  });
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
    content: responseText,
    attachmentMetas: responseAttachmentMetas,
  });
  if (purpose === "summary") {
    const mergedSummaryText = applySummaryText(ctx, responseText);
    const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_messages_marked",
      detail: { markedCount },
    });
    if (isSummaryCompletionMarked(mergedSummaryText, locale)) {
      await runPlanUpdateAfterSummary(ctx, meta, mergedSummaryText, { baseMessages: modelMessages });
    } else {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        event: "summary_completion_marker_missing",
      });
    }
  }
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
