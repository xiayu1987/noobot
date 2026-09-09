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

export function normalizeSystemRuntimeCounterValue(value = 0) {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
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
