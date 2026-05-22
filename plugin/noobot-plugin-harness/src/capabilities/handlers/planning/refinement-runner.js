/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  ensureHarnessBucket,
  extractJsonObjectFromText,
  extractRawTextContent,
  getDefaultTaskOwner,
  parseRefinementChecklistFromModelOutput,
  parseTaskChecklistFromModelOutput,
  relaySeparateModelOutputAsUserMessage,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelName,
  resolveCapabilityModelMessages,
  resolveCapabilityToolAllowlist,
  translateI18nText,
} from "./deps.js";
import { createPlanRevisionHelpers } from "../shared/plan-revision-helpers.js";

const planRevisionHelpers = createPlanRevisionHelpers({
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
  extractJsonObjectFromText,
  getDefaultTaskOwner,
  parseRefinementChecklistFromModelOutput,
  parseTaskChecklistFromModelOutput,
  translateI18nText,
});

const resolveRefinementTargetMainSteps = planRevisionHelpers.resolveRefinementTargetMainSteps;
const applyRevisedPlanFromText = planRevisionHelpers.applyRevisedPlanFromText;
const buildPlanningRefinementPrompt = planRevisionHelpers.buildPlanningRefinementPrompt;
const buildNextPhaseRelayContent = planRevisionHelpers.buildNextPhaseRelayContent;

export async function runPlanningRefinementBySeparateModel(
  ctx = {},
  meta = {},
  { summaryText = "", source = "planning_refinement", baseMessages = null } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return { applied: false, status: "missing_harness_bucket" };
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_invoker_missing",
    });
    return { applied: false, status: "invoker_missing" };
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const refinementTargetMainSteps = resolveRefinementTargetMainSteps(bucket, state);
  if (!refinementTargetMainSteps.length) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_converged_no_target_main_step",
    });
    return { applied: false, status: "converged" };
  }

  const modelMessages = Array.isArray(baseMessages)
    ? baseMessages
    : resolveCapabilityModelMessages(meta, {
        ctx,
        purpose: "planning_refinement",
        messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
      });
  const refinementMessages = [...modelMessages];
  refinementMessages.push({
    role: "user",
    content: buildPlanningRefinementPrompt(
      locale,
      bucket,
      state,
      String(summaryText || "").trim(),
    ),
  });

  let refinementResponse = null;
  try {
    refinementResponse = await invoker({
      purpose: "planning_refinement",
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
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_model_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return {
      applied: false,
      status: "model_failed",
      error: String(error?.message || error || ""),
    };
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    purpose: "planning_refinement",
    response: refinementResponse,
  });
  const refinementText =
    extractRawTextContent(refinementResponse?.content) ||
    String(refinementResponse?.text || refinementResponse?.output || "").trim();
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
