/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readJson } from "../lib/store.js";
import { applyFsmTransitionEffects } from "./audit.js";
import {
  HARNESS_FSM_STATES,
  HARNESS_FSM_TERMINAL_STATES,
  normalizeFsmState,
  statusToFsmState,
  buildFsmTransitionPlan,
} from "./transitions.js";

const fsmStateCache = new Map(); // runId -> state
const fsmStateLastAccessed = new Map(); // runId -> timestamp
const FSM_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const FSM_CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let fsmCacheCleanupTimer = null;

function touchFsmState(runId = "") {
  if (!runId) return;
  fsmStateLastAccessed.set(runId, Date.now());
}

function getFsmState(runId = "") {
  if (!runId || !fsmStateCache.has(runId)) return null;
  touchFsmState(runId);
  return fsmStateCache.get(runId);
}

function setFsmState(runId = "", state = HARNESS_FSM_STATES.IDLE) {
  if (!runId) return;
  fsmStateCache.set(runId, state);
  touchFsmState(runId);
}

function deleteFsmState(runId = "") {
  if (!runId) return;
  fsmStateCache.delete(runId);
  fsmStateLastAccessed.delete(runId);
}

function cleanupStaleFsmStates() {
  const now = Date.now();
  for (const [runId, lastAccessed] of fsmStateLastAccessed.entries()) {
    if (now - lastAccessed <= FSM_CACHE_MAX_AGE_MS) continue;
    deleteFsmState(runId);
  }
}

function startFsmStateCleanupTimer() {
  if (fsmCacheCleanupTimer) return;
  fsmCacheCleanupTimer = setInterval(cleanupStaleFsmStates, FSM_CACHE_CLEANUP_INTERVAL_MS);
  if (fsmCacheCleanupTimer.unref) fsmCacheCleanupTimer.unref();
}

startFsmStateCleanupTimer();

async function resolveCurrentFsmState(paths, options = {}) {
  if (!paths?.runId || options.fsmEnabled === false) {
    return { state: HARNESS_FSM_STATES.IDLE, resumed: false };
  }
  const cached = getFsmState(paths.runId);
  if (cached) {
    return { state: cached, resumed: false };
  }
  const manifest = await readJson(paths.manifest, {});
  const fromManifest = normalizeFsmState(manifest?.fsmStatus || manifest?.fsm?.state);
  const inferred = fromManifest !== HARNESS_FSM_STATES.IDLE ? fromManifest : statusToFsmState(manifest?.status);
  const state = normalizeFsmState(inferred);
  setFsmState(paths.runId, state);
  const resumed = state !== HARNESS_FSM_STATES.IDLE && !HARNESS_FSM_TERMINAL_STATES.has(state);
  return { state, resumed };
}

export async function advanceFsmState(point, ctx = {}, paths = null, options = {}) {
  if (!paths || options.fsmEnabled === false) {
    return { state: HARNESS_FSM_STATES.IDLE, changed: false, rejected: false, resumed: false };
  }
  const { state: currentState, resumed } = await resolveCurrentFsmState(paths, options);
  const plan = buildFsmTransitionPlan(point, ctx, currentState, resumed, paths.runId);
  await applyFsmTransitionEffects(paths, ctx, options, plan, {
    set: setFsmState,
    delete: deleteFsmState,
  });
  return {
    state: plan.state,
    changed: plan.changed,
    rejected: plan.rejected,
    resumed: plan.resumed,
    attempted: plan.attempted || undefined,
  };
}
