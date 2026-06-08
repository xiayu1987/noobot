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
  saveCapabilityOutputAsTransferArtifacts,
  invokeWithReasoningRetry,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelName,
  resolveCapabilityModelMessages,
  resolveCapabilityToolAllowlist,
} from "./deps.js";
import { createPlanRevisionHelpers } from "../shared/plan/revision-helpers.js";
import { buildPlanChecklistContextMessages } from "../shared/plan/checklist-context.js";
import {
  buildPostPlanUserFollowupPrompt,
  buildWorkflowResponsibilityConstraintUserPrompt,
} from "../shared/workflow/prompts.js";

const PLANNING_EVENTS = WORKFLOW_PARAMS.logging.events.planning;

const planRevisionHelpers = createPlanRevisionHelpers({
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
});

const resolveRefinementTargetMainSteps = planRevisionHelpers.resolveRefinementTargetMainSteps;
const applyRevisedPlanFromText = planRevisionHelpers.applyRevisedPlanFromText;
const buildPlanningRefinementPrompt = planRevisionHelpers.buildPlanningRefinementPrompt;
const buildNextPhaseRelayContent = planRevisionHelpers.buildNextPhaseRelayContent;

export async function runPlanningRefinementBySeparateModel(
  ctx = {},
  meta = {},
  { summaryText = "", source = "planning_refinement", baseMessages = null, targetMainStepIndexes = [] } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return { applied: false, status: "missing_harness_bucket" };
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: PLANNING_EVENTS.refinementInvokerMissing,
    });
    return { applied: false, status: "invoker_missing" };
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const explicitTargetIndexes = Array.isArray(targetMainStepIndexes)
    ? targetMainStepIndexes.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
    : [];
  const refinementTargetMainSteps = resolveRefinementTargetMainSteps(bucket, state, {
    preferredTargetMainStepIndexes: explicitTargetIndexes,
  });
  if (!refinementTargetMainSteps.length) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: PLANNING_EVENTS.refinementConvergedNoTargetMainStep,
      detail: {
        requestedTargetMainStepIndexes: explicitTargetIndexes,
      },
    });
    return { applied: false, status: "converged" };
  }

  const refinementTask = buildPlanningRefinementPrompt(
    locale,
    bucket,
    state,
    String(summaryText || "").trim(),
    { targetMainStepIndexes: refinementTargetMainSteps.map((item) => item.index) },
  );
  const agentMessagesBase = Array.isArray(baseMessages)
    ? baseMessages
    : resolveCapabilityModelMessages(meta, {
        ctx,
        purpose: "planning_refinement",
      });
  const agentMessages = [
    ...agentMessagesBase,
    ...buildPlanChecklistContextMessages({
      locale,
      planText: bucket?.planText || "",
      bucket,
    }),
  ];
  const refinementMessages = buildCapabilityModelMessages({
    locale,
    agentMessages,
    task: refinementTask,
    postTaskMessages: [
      buildWorkflowResponsibilityConstraintUserPrompt(locale, "refinement"),
    ],
  });

  let refinementResponse = null;
  try {
    refinementResponse = await invokeWithReasoningRetry({
      invoker,
      invokePayload: {
        purpose: "planning_refinement",
        promptVersion: PROMPT_ENVELOPE.VERSION,
        envelopeType: PROMPT_ENVELOPE.TYPE,
        domain: CAPABILITY_DOMAIN.PLANNING,
        model: resolveCapabilityModelName(meta, {
          purpose: "planning_refinement",
          domain: CAPABILITY_DOMAIN.PLANNING,
        }),
        locale,
        prompt: "",
        messages: refinementMessages,
        ctx,
        toolAllowlist: resolveCapabilityToolAllowlist(meta, "planning_refinement"),
      },
      maxReasoningRetries: 1,
      purpose: "planning_refinement",
      domain: CAPABILITY_DOMAIN.PLANNING,
      appendCapabilityLog,
      appendModelTrace: async (retryResponse = null) => {
        await appendCapabilityModelTraceLog(ctx, meta, {
          domain: CAPABILITY_DOMAIN.PLANNING,
          purpose: "planning_refinement",
          response: retryResponse,
        });
      },
      ctx,
      meta,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: PLANNING_EVENTS.refinementModelFailed,
      detail: { error: String(error?.message || error || "") },
    });
    return {
      applied: false,
      status: "model_failed",
      error: String(error?.message || error || ""),
    };
  }
  const refinementText =
    extractRawTextContent(refinementResponse?.content) ||
    String(refinementResponse?.text || refinementResponse?.output || "").trim();
  const refinementAttachmentMetas = await saveCapabilityOutputAsTransferArtifacts(ctx, {
    purpose: "planning_refinement",
    content: refinementText,
    generationSource: "harness_planning_refinement",
    domain: CAPABILITY_DOMAIN.PLANNING,
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "planning_refinement",
    content: refinementText,
    dedupe: true,
    attachmentMetas: refinementAttachmentMetas,
  });
  const refinementApplied = applyRevisedPlanFromText(ctx, refinementText, {
    summary: String(summaryText || "").trim(),
    source,
    stage: "refinement",
    targetMainStepIndexes: refinementTargetMainSteps.map((item) => item.index),
  });
  if (refinementApplied) {
    relaySeparateModelOutputAsUserMessage(ctx, {
      locale,
      purpose: "next_phase_plan_refinement",
      content: buildNextPhaseRelayContent(bucket, locale, "refinement"),
      dedupe: true,
    });
    relaySeparateModelOutputAsUserMessage(ctx, {
      locale,
      purpose: "next_phase_plan_refinement_followup",
      content: buildPostPlanUserFollowupPrompt(locale, "refinement"),
      dedupe: true,
    });
    return {
      applied: true,
      status: "completed",
      targetMainStepIndexes: refinementTargetMainSteps.map((item) => item.index),
    };
  }
  return {
    applied: false,
    status: "invalid_refinement_payload",
    targetMainStepIndexes: refinementTargetMainSteps.map((item) => item.index),
  };
}
