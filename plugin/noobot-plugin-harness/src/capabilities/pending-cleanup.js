/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CAPABILITY_DOMAIN, appendCapabilityLog, ensureHarnessBucket } from "./handlers/shared.js";
import { HARNESS_HOOK_POINTS } from "../core/constants.js";

const DEFAULT_PENDING_TTL_HOOK_TURNS = 8;
const WARN_COOLDOWN_TURNS = 3;
const TRACKED_PENDING_KEYS = Object.freeze([
  "guidance",
  "analysis",
  "summary",
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
  HARNESS_HOOK_POINTS.BEFORE_LLM_CALL,
  HARNESS_HOOK_POINTS.AFTER_LLM_CALL,
  HARNESS_HOOK_POINTS.AFTER_TOOL_CALL,
  HARNESS_HOOK_POINTS.TOOL_CALL_ERROR,
  HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT,
]);

function normalizePendingTtlHookTurns(meta = {}) {
  const raw = Number(meta?.harness?.pendingTtlHookTurns);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_PENDING_TTL_HOOK_TURNS;
  return Math.trunc(raw);
}

function ensurePendingMeta(state = {}) {
  if (!state || typeof state !== "object") return { pending: {}, flags: {} };
  if (!state.pendingMeta || typeof state.pendingMeta !== "object" || Array.isArray(state.pendingMeta)) {
    state.pendingMeta = {};
  }
  if (!state.pendingMeta.pending || typeof state.pendingMeta.pending !== "object" || Array.isArray(state.pendingMeta.pending)) {
    state.pendingMeta.pending = {};
  }
  if (!state.pendingMeta.flags || typeof state.pendingMeta.flags !== "object" || Array.isArray(state.pendingMeta.flags)) {
    state.pendingMeta.flags = {};
  }
  return state.pendingMeta;
}

function resolveCurrentHookTurn(state = {}) {
  const turn = Number(state?.counters?.hookTurns || 0);
  return Number.isFinite(turn) && turn >= 0 ? Math.trunc(turn) : 0;
}

function isPendingKeyActive(key = "", value = null) {
  if (
    key === "summary" ||
    key === "analysis" ||
    key === "planRevision" ||
    key === "planRefinement" ||
    key === "phaseAcceptance"
  ) return value === true;
  if (key === "guidance" || key === "acceptanceSemanticValidation") return value !== null && value !== undefined;
  return Boolean(value);
}

export function setPendingStateWithMeta(state = {}, key = "", value = null) {
  if (!key || !state || typeof state !== "object") return false;
  if (!state.pending || typeof state.pending !== "object") state.pending = {};
  const pendingMeta = ensurePendingMeta(state);
  state.pending[key] = value;
  if (isPendingKeyActive(key, value)) {
    pendingMeta.pending[key] = resolveCurrentHookTurn(state);
  } else {
    delete pendingMeta.pending[key];
  }
  return true;
}

export function setCaptureFlagStateWithMeta(state = {}, key = "", active = false) {
  if (!key || !state || typeof state !== "object") return false;
  if (!state.flags || typeof state.flags !== "object") state.flags = {};
  const pendingMeta = ensurePendingMeta(state);
  const normalized = active === true;
  state.flags[key] = normalized;
  if (normalized) {
    pendingMeta.flags[key] = resolveCurrentHookTurn(state);
  } else {
    delete pendingMeta.flags[key];
    if (key === "planUpdateCapturePending") {
      delete state.flags.planUpdateCaptureStage;
      delete state.flags.planUpdateCaptureSummaryText;
      delete state.flags.planUpdateCaptureTargetMainStepIndexes;
    }
    if (key === "acceptanceSemanticValidationCapturePending") {
      delete state.flags.acceptanceSemanticValidationCaptureReportIndex;
    }
  }
  return true;
}

function shouldTickHookTurn(point = "") {
  return HOOK_TURN_TICK_POINTS.has(String(point || "").trim());
}

export function cleanupExpiredPendingOnHook(point = "", ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const ttlTurns = normalizePendingTtlHookTurns(meta);
  const { state } = holder;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
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
    if (!Number.isFinite(Number(pendingTurns[key]))) {
      pendingTurns[key] = currentTurn;
      continue;
    }
    const ageTurns = currentTurn - Number(pendingTurns[key]);
    if (ageTurns <= ttlTurns) continue;
    setPendingStateWithMeta(
      state,
      key,
      key === "summary" ||
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
    if (!Number.isFinite(Number(flagTurns[key]))) {
      flagTurns[key] = currentTurn;
      continue;
    }
    const ageTurns = currentTurn - Number(flagTurns[key]);
    if (ageTurns <= ttlTurns) continue;
    setCaptureFlagStateWithMeta(state, key, false);
    clearedCount += 1;
    clearedFlagKeys.push(key);
  }

  if (clearedCount > 0) {
    const lastWarnTurn = Number(state?.pendingMeta?.lastWarnHookTurn);
    const shouldWarn =
      !Number.isFinite(lastWarnTurn) || currentTurn - lastWarnTurn >= WARN_COOLDOWN_TURNS;
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
