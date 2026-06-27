/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureHarnessBucket } from "../bucket-utils.js";
import { resolveDialogProcessIdFromContext } from "./dialog-process-id.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

const TURN_END_POINTS = new Set(["after_turn", "on_abort", "on_error"]);
const TURN_START_POINTS = new Set(["before_turn", "before_context_build"]);
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
    // Per-turn acceptance/final-output guards should be reset at turn start.
    // Otherwise a previous turn that requested acceptance could suppress
    // final-output fallback acceptance in subsequent turns.
    state.flags.acceptanceRequested = false;
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
