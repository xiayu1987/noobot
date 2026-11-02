/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  appendCapabilityLog,
  ensureHarnessBucket,
} from "./handlers/shared/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { HarnessPendingTtlHookTurnsSchema } from "../core/options.js";
import { requireHarnessStateField } from "../core/bucket-contract.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { text, isObjectLike, isPlainObject } from "@noobot/shared/value";

const WARN_COOLDOWN_TURNS = TURN_THRESHOLDS.harness.pendingWarnCooldownTurns;
const TRACKED_PENDING_KEYS = Object.freeze([
  "guidance",
  "analysis",
  "planRevision",
  "planRefinement",
  "phaseAcceptance",
  "acceptanceSemanticValidation",
]);
const TRACKED_CAPTURE_FLAG_KEYS = Object.freeze([
  "planUpdateCapturePending",
  "phaseAcceptanceCapturePending",
  "acceptanceSemanticValidationCapturePending",
]);
const HOOK_TURN_TICK_POINTS = new Set([
  HOOK_POINT.AGENT.BEFORE_LLM_CALL,
  HOOK_POINT.AGENT.AFTER_LLM_CALL,
  HOOK_POINT.AGENT.AFTER_TOOL_CALL,
  HOOK_POINT.AGENT.TOOL_CALL_ERROR,
  HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
]);

function ensurePendingMeta(state = {}) {
  if (
    !isPlainObject(state.pendingMeta) ||
    !isPlainObject(state.pendingMeta.pending) ||
    !isPlainObject(state.pendingMeta.flags)
  )
    throw new TypeError("invalid_harness_state:pendingMeta");
  return state.pendingMeta;
}

function resolveCurrentHookTurn(state = {}) {
  const turn = state.counters.hookTurns;
  if (!Number.isSafeInteger(turn) || turn < 0)
    throw new TypeError("invalid_harness_state:hookTurns");
  return turn;
}

function isPendingKeyActive(key = "", value = null) {
  if (
    key === "summary" ||
    key === "analysis" ||
    key === "planRevision" ||
    key === "planRefinement" ||
    key === "phaseAcceptance"
  )
    return value === true;
  if (key === "guidance" || key === "acceptanceSemanticValidation")
    return value !== null && value !== undefined;
  return Boolean(value);
}

export function setPendingStateWithMeta(state, key, value) {
  requireHarnessStateField("pending", key, value);
  const pendingMeta = ensurePendingMeta(state);
  const active = isPendingKeyActive(key, value);
  const hookTurn = active ? resolveCurrentHookTurn(state) : null;
  state.pending[key] = value;
  if (active) {
    pendingMeta.pending[key] = hookTurn;
  } else {
    delete pendingMeta.pending[key];
  }
  return true;
}

export function clearPendingSummaryState(state = {}) {
  if (!isObjectLike(state)) return false;
  const hadPendingSummary = state?.pending?.summary === true;
  const hadCheckpoint = state.pending.summaryCheckpointMessageKeys !== null;
  const hadCharTrigger = state?.flags?.summaryByCharsPrompted === true;
  setPendingStateWithMeta(state, "summary", false);
  state.pending.summaryCheckpointMessageKeys = null;
  state.flags.summaryByCharsPrompted = false;
  return hadPendingSummary || hadCheckpoint || hadCharTrigger;
}

export function setCaptureFlagStateWithMeta(state, key, active) {
  requireHarnessStateField("flags", key, active);
  const pendingMeta = ensurePendingMeta(state);
  const hookTurn = active ? resolveCurrentHookTurn(state) : null;
  state.flags[key] = active;
  if (active) {
    pendingMeta.flags[key] = hookTurn;
  } else {
    delete pendingMeta.flags[key];
    if (key === "planUpdateCapturePending") {
      delete state.flags.planUpdateCaptureStage;
      delete state.flags.planUpdateCaptureTargetMainStepIndexes;
    }
    if (key === "acceptanceSemanticValidationCapturePending") {
      delete state.flags.acceptanceSemanticValidationCaptureReportIndex;
    }
  }
  return true;
}

function shouldTickHookTurn(point = "") {
  return HOOK_TURN_TICK_POINTS.has(text(point));
}

export function cleanupExpiredPendingOnHook(point = "", ctx = {}, meta = {}) {
  const ttlTurns = HarnessPendingTtlHookTurnsSchema.parse(meta.harness?.pendingTtlHookTurns);
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (shouldTickHookTurn(point)) {
    state.counters.hookTurns = resolveCurrentHookTurn(state) + 1;
  }
  const currentTurn = resolveCurrentHookTurn(state);
  if (ttlTurns <= 0) return false;

  const pendingMeta = ensurePendingMeta(state);
  const pendingTurns = pendingMeta.pending;
  const flagTurns = pendingMeta.flags;
  let clearedCount = 0;
  const clearedPendingKeys = [];
  const clearedFlagKeys = [];

  for (const key of TRACKED_PENDING_KEYS) {
    const active = isPendingKeyActive(key, state?.pending?.[key]);
    if (!active) {
      delete pendingTurns[key];
      continue;
    }
    if (pendingTurns[key] === undefined) throw new TypeError(`invalid_harness_pending_time:${key}`);
    if (pendingTurns[key] !== null && currentTurn - pendingTurns[key] <= ttlTurns) continue;
    setPendingStateWithMeta(
      state,
      key,
      key === "analysis" ||
        key === "planRevision" ||
        key === "planRefinement" ||
        key === "phaseAcceptance"
        ? false
        : null,
    );
    clearedCount += 1;
    clearedPendingKeys.push(key);
  }

  for (const key of TRACKED_CAPTURE_FLAG_KEYS) {
    const active = state?.flags?.[key] === true;
    if (!active) {
      delete flagTurns[key];
      continue;
    }
    if (flagTurns[key] === undefined) throw new TypeError(`invalid_harness_pending_time:${key}`);
    if (flagTurns[key] !== null && currentTurn - flagTurns[key] <= ttlTurns) continue;
    setCaptureFlagStateWithMeta(state, key, false);
    clearedCount += 1;
    clearedFlagKeys.push(key);
  }

  if (clearedCount > 0) {
    const lastWarnTurn = state.pendingMeta.lastWarnHookTurn;
    const shouldWarn = lastWarnTurn === null || currentTurn - lastWarnTurn >= WARN_COOLDOWN_TURNS;
    if (shouldWarn) {
      state.pendingMeta.lastWarnHookTurn = currentTurn;
      const logged = appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        event: "pending_state_ttl_cleaned",
        detail: {
          point: String(point || "unknown"),
          ttlTurns,
          hookTurns: currentTurn,
          clearedCount,
          clearedPendingKeys,
          clearedFlagKeys,
        },
      });
      if (!logged) {
        console.warn(
          `[harness] cleaned ${clearedCount} stale pending state(s) on ${String(point || "unknown")} after ${ttlTurns} hook turns`,
        );
      }
    }
    return true;
  }
  return false;
}
