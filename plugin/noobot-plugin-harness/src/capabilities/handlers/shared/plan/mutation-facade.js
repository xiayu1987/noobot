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
} from "./mutation-observability.js";

export function executePlanMutation({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "revision",
  source = "",
  currentPlanText = "",
  mutationText = "",
} = {}) {
  const mutationResult = runPlanMutationEngine({
    stage,
    currentPlanText,
    mutationText,
  });
  const logInput = { appendCapabilityLog, ctx, domain, stage, source, mutationResult };
  emitPlanMutationParsed(logInput);
  if (mutationResult.applied) emitPlanMutationApplied(logInput);
  else emitPlanMutationRejected(logInput);
  return mutationResult;
}
