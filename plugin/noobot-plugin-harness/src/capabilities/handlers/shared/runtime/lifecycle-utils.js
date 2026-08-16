/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";
import { ensureHarnessBucket } from "../bucket-utils.js";
import { resolveDialogProcessIdFromContext } from "./dialog-process-id.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { clearIncrementalCapabilityMessageCacheForContext } from "../model/incremental-message-cache.js";

const TURN_END_POINTS = new Set([HOOK_POINT.AGENT.AFTER_TURN, HOOK_POINT.AGENT.ON_ABORT, HOOK_POINT.AGENT.ON_ERROR]);
const TURN_START_POINTS = new Set([HOOK_POINT.AGENT.BEFORE_TURN, HOOK_POINT.AGENT.BEFORE_CONTEXT_BUILD]);
const MAX_COMPLETED_DIALOG_IDS = QUANTITY_THRESHOLDS.harness.completedDialogIds;

function resolveDialogProcessId(ctx = {}) {
  return resolveDialogProcessIdFromContext(ctx);
}

export function markHarnessTurnLifecycle(point = "", ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const normalizedPoint = String(point || "").trim().toLowerCase();
  const dialogProcessId = resolveDialogProcessId(ctx);
  const completedIds = Array.isArray(bucket.completedDialogProcessIds)
    ? bucket.completedDialogProcessIds
    : (bucket.completedDialogProcessIds = []);

  if (TURN_START_POINTS.has(normalizedPoint)) {
    state.flags.agentTurnEnded = false;
    state.flags.acceptanceRequested = false;
    state.flags.acceptanceReviewing = false;
    state.flags.acceptanceCompleted = false;
    state.flags.planRefinementRequested = false;
    state.flags.checklistArtifactsAttached = false;
    if (dialogProcessId) {
      state.signals.activeDialogProcessId = dialogProcessId;
      const index = completedIds.indexOf(dialogProcessId);
      if (index >= 0) completedIds.splice(index, 1);
    }
    return true;
  }

  if (!TURN_END_POINTS.has(normalizedPoint)) return false;
  state.flags.agentTurnEnded = true;
  clearIncrementalCapabilityMessageCacheForContext(ctx);
  if (!dialogProcessId) return true;
  if (!completedIds.includes(dialogProcessId)) {
    completedIds.push(dialogProcessId);
    if (completedIds.length > MAX_COMPLETED_DIALOG_IDS) {
      completedIds.splice(0, completedIds.length - MAX_COMPLETED_DIALOG_IDS);
    }
  }
  return true;
}

export function isHarnessAgentTurnEnded(ctx = {}) {
  if (ctx?.runtime?.abortSignal?.aborted === true) return true;
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const dialogProcessId = resolveDialogProcessId(ctx);
  const activeDialogProcessId = String(state?.signals?.activeDialogProcessId || "").trim();
  const completedIds = Array.isArray(bucket.completedDialogProcessIds) ? bucket.completedDialogProcessIds : [];
  if (dialogProcessId) {
    if (completedIds.includes(dialogProcessId)) return true;
    if (activeDialogProcessId && activeDialogProcessId !== dialogProcessId) return true;
  }
  return state?.flags?.agentTurnEnded === true;
}
