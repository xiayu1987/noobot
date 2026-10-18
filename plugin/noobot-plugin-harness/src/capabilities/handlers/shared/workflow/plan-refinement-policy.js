/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveWorkflowThresholdModeFromContext } from "./prompts.js";
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { isObjectLike } from "@noobot/shared/value";

function resolvePlanRefinementEnabledForContext(ctx = {}, meta = {}) {
  const explicit = meta?.harness?.planRefinementEnabled;
  if (typeof explicit === "boolean") return explicit;
  const mode = resolveWorkflowThresholdModeFromContext(ctx);
  return WORKFLOW_PARAMS.modeThresholds[mode].planning.planRefinement.enabled === true;
}

export function syncPlanRefinementPolicyFlag(ctx = {}, state = {}, meta = {}) {
  const enabled = resolvePlanRefinementEnabledForContext(ctx, meta);
  if (isObjectLike(state)) {
    if (!isObjectLike(state.flags)) state.flags = {};
    state.flags.planRefinementEnabled = enabled;
  }
  return enabled;
}

export function clearPendingPlanRefinement(state = {}) {
  if (!isObjectLike(state)) return false;
  if (!isObjectLike(state.pending)) state.pending = {};
  state.pending.planRefinement = false;
  state.pending.planRefinementContext = null;
  return true;
}
