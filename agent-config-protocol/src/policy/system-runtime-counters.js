/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SYSTEM_RUNTIME_COUNTER_KEYS = Object.freeze([
  "phaseSummaryLoopCount",
  "taskCheckLoopCount",
  "helpPromptLoopCount",
  "toolConsecutiveFailureCount",
]);

export const SYSTEM_RUNTIME_TURN_PROGRESS_FLAG_KEYS = Object.freeze([
  "needsPhaseSummary",
  "phaseSummaryByCharsPrompted",
]);

export function normalizeSystemRuntimeCounterValue(value = 0) {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function projectSystemRuntimeTurnProgress(systemRuntime) {
  const source = systemRuntime && typeof systemRuntime === "object" ? systemRuntime : {};
  const progress = {};
  for (const key of SYSTEM_RUNTIME_COUNTER_KEYS) {
    progress[key] = normalizeSystemRuntimeCounterValue(source[key]);
  }
  for (const key of SYSTEM_RUNTIME_TURN_PROGRESS_FLAG_KEYS) {
    progress[key] = source[key] === true;
  }
  return progress;
}

export function applySystemRuntimeTurnProgress(systemRuntime, turnProgress) {
  if (!systemRuntime || typeof systemRuntime !== "object") return null;
  const normalized = projectSystemRuntimeTurnProgress(turnProgress);
  for (const key of SYSTEM_RUNTIME_COUNTER_KEYS) {
    systemRuntime[key] = normalized[key];
  }
  for (const key of SYSTEM_RUNTIME_TURN_PROGRESS_FLAG_KEYS) {
    systemRuntime[key] = normalized[key];
  }
  return normalized;
}

export function normalizeSystemRuntimeCounters(systemRuntime, userMessage) {
  if (!systemRuntime || typeof systemRuntime !== "object") return;

  for (const key of SYSTEM_RUNTIME_COUNTER_KEYS) {
    systemRuntime[key] = normalizeSystemRuntimeCounterValue(systemRuntime[key]);
  }
  systemRuntime.modelLoopRound = 0;

  systemRuntime.needsPhaseSummary = systemRuntime.needsPhaseSummary === true;
  systemRuntime.phaseSummaryByCharsPrompted = systemRuntime.phaseSummaryByCharsPrompted === true;
  systemRuntime.mainFlowFinalNoToolsTurnActive = false;
  systemRuntime.currentTurnUserMessage = String(userMessage || "").trim();
}
