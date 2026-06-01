/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { runPlanMutationEngine } from "./mutation-engine.js";
import {
  emitPlanMutationApplied,
  emitPlanMutationParsed,
  emitPlanMutationRejected,
  emitPlanMutationStageMismatchAutocoerced,
} from "./mutation-observability.js";

export function executePlanMutation({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "revision",
  source = "",
  currentPlanText = "",
  mutationText = "",
  policy = {},
  emitRejectedWhenNotApplied = true,
} = {}) {
  const mutationResult = runPlanMutationEngine({
    stage,
    currentPlanText,
    mutationText,
    policy,
  });

  emitPlanMutationParsed({
    appendCapabilityLog,
    ctx,
    domain,
    stage,
    source,
    mutationResult,
  });

  if (mutationResult.applied) {
    emitPlanMutationApplied({
      appendCapabilityLog,
      ctx,
      domain,
      stage,
      source,
      mutationResult,
    });
    if (
      String(stage || "").trim().toLowerCase() === "revision" &&
      mutationResult?.refinementPatchApplied?.changed === true
    ) {
      emitPlanMutationStageMismatchAutocoerced({
        appendCapabilityLog,
        ctx,
        domain,
        stage,
        source,
      });
    }
  } else if (emitRejectedWhenNotApplied) {
    emitPlanMutationRejected({
      appendCapabilityLog,
      ctx,
      domain,
      stage,
      source,
      mutationResult,
    });
  }

  return mutationResult;
}
