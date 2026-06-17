/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveProgrammingModeFromContext,
  resolveWorkflowThresholdModeFromContext,
} from "./prompts.js";
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";

function resolveExplicitPlanRefinementEnabledFromSource(source = {}) {
  if (!source || typeof source !== "object") return undefined;
  const candidates = [
    source.planRefinementEnabled,
    source.enablePlanRefinement,
    source.planRefinement?.enabled,
    source.refinement?.enabled,
    source.planning?.refinement?.enabled,
    source.planning?.planRefinement?.enabled,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") return candidate;
  }
  return undefined;
}

export function resolveExplicitPlanRefinementEnabled(ctx = {}, meta = {}) {
  const harnessPayload = ctx?.agentContext?.payload?.harness;
  const sources = [
    meta?.harness,
    meta,
    harnessPayload?.options,
    harnessPayload,
  ];
  for (const source of sources) {
    const value = resolveExplicitPlanRefinementEnabledFromSource(source);
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

export function resolvePlanRefinementEnabledForContext(ctx = {}, meta = {}) {
  const explicit = resolveExplicitPlanRefinementEnabled(ctx, meta);
  if (typeof explicit === "boolean") return explicit;
  const mode = resolveWorkflowThresholdModeFromContext(ctx);
  const modeEnabled = WORKFLOW_PARAMS.modeThresholds?.[mode]?.planning?.planRefinement?.enabled;
  if (typeof modeEnabled === "boolean") return modeEnabled;
  return resolveProgrammingModeFromContext(ctx) !== true;
}

export function syncPlanRefinementPolicyFlag(ctx = {}, state = {}, meta = {}) {
  const enabled = resolvePlanRefinementEnabledForContext(ctx, meta);
  if (state && typeof state === "object") {
    if (!state.flags || typeof state.flags !== "object") state.flags = {};
    state.flags.planRefinementEnabled = enabled;
  }
  return enabled;
}

export function clearPendingPlanRefinement(state = {}) {
  if (!state || typeof state !== "object") return false;
  if (!state.pending || typeof state.pending !== "object") state.pending = {};
  state.pending.planRefinement = false;
  state.pending.planRefinementContext = null;
  return true;
}
