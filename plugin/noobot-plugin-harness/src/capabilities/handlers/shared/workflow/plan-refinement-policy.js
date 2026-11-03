/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveWorkflowThresholdModeFromContext } from "./prompts.js";
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { assertHarnessState } from "../../../../core/bucket-contract.js";

function resolvePlanRefinementEnabledForContext(ctx = {}, meta = {}) {
  const explicit = meta?.harness?.planRefinementEnabled;
  if (typeof explicit === "boolean") return explicit;
  const mode = resolveWorkflowThresholdModeFromContext(ctx);
  return WORKFLOW_PARAMS.modePolicies[mode].planRefinementEnabled === true;
}

export function syncPlanRefinementPolicyFlag(ctx, state, meta = {}) {
  assertHarnessState(state);
  const enabled = resolvePlanRefinementEnabledForContext(ctx, meta);
  state.flags.planRefinementEnabled = enabled;
  return enabled;
}

export function clearPendingPlanRefinement(state) {
  assertHarnessState(state);
  state.pending.planRefinement = false;
  state.pending.planRefinementContext = null;
  return true;
}
