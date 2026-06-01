/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";

const PLAN_MUTATION_EVENTS = WORKFLOW_PARAMS.logging.events.planning;

function buildBaseDetail({ stage = "", source = "", mutationResult = {} } = {}) {
  return {
    stage: String(stage || "").trim(),
    source: String(source || "").trim(),
    mutationClassification: String(mutationResult?.classification?.type || "").trim(),
  };
}

export function emitPlanMutationParsed({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "",
  source = "",
  mutationResult = {},
} = {}) {
  appendCapabilityLog?.(ctx, {
    domain,
    event: PLAN_MUTATION_EVENTS.planMutationParsed,
    detail: buildBaseDetail({ stage, source, mutationResult }),
  });
}

export function emitPlanMutationApplied({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "",
  source = "",
  mutationResult = {},
  mode = "",
} = {}) {
  appendCapabilityLog?.(ctx, {
    domain,
    event: PLAN_MUTATION_EVENTS.planMutationApplied,
    detail: {
      ...buildBaseDetail({ stage, source, mutationResult }),
      mode: String(mode || mutationResult?.mode || "").trim(),
    },
  });
}

export function emitPlanMutationRejected({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "",
  source = "",
  mutationResult = {},
} = {}) {
  const reason = String(mutationResult?.rejectedReason || "").trim();
  appendCapabilityLog?.(ctx, {
    domain,
    event: reason.includes("invariant")
      ? PLAN_MUTATION_EVENTS.planMutationInvariantBlocked
      : PLAN_MUTATION_EVENTS.planMutationRejected,
    detail: {
      ...buildBaseDetail({ stage, source, mutationResult }),
      rejectedReason: reason,
    },
  });
}

export function emitPlanMutationStageMismatchAutocoerced({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "",
  source = "",
  reason = "revision_contains_sub_plan_patch",
} = {}) {
  appendCapabilityLog?.(ctx, {
    domain,
    event: PLAN_MUTATION_EVENTS.planMutationStageMismatchAutocoerced,
    detail: {
      stage: String(stage || "").trim(),
      source: String(source || "").trim(),
      reason: String(reason || "").trim(),
    },
  });
}
