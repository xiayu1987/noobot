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
import { isObjectLike } from "@noobot/shared/value";

function resolveExplicitPlanRefinementEnabledFromSource(source = {}) {
  if (!isObjectLike(source)) return undefined;
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

function resolveExplicitPlanRefinementEnabled(ctx = {}, meta = {}) {
  const harnessPayload = ctx?.agentContext?.bindings?.extensions?.harness;
  const sources = [meta?.harness, meta, harnessPayload?.options, harnessPayload];
  for (const source of sources) {
    const value = resolveExplicitPlanRefinementEnabledFromSource(source);
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function resolvePlanRefinementEnabledForContext(ctx = {}, meta = {}) {
  const explicit = resolveExplicitPlanRefinementEnabled(ctx, meta);
  if (typeof explicit === "boolean") return explicit;
  const mode = resolveWorkflowThresholdModeFromContext(ctx);
  const modeEnabled = WORKFLOW_PARAMS.modeThresholds?.[mode]?.planning?.planRefinement?.enabled;
  if (typeof modeEnabled === "boolean") return modeEnabled;
  return resolveProgrammingModeFromContext(ctx) !== true;
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
