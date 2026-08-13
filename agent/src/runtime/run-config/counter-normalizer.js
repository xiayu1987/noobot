/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeSystemRuntimeCounters(systemRuntime, userMessage) {
  if (!systemRuntime || typeof systemRuntime !== "object") return;

  const phaseSummaryLoopCount = Number(systemRuntime.phaseSummaryLoopCount || 0);
  systemRuntime.phaseSummaryLoopCount =
    Number.isFinite(phaseSummaryLoopCount) && phaseSummaryLoopCount > 0 ? phaseSummaryLoopCount : 0;

  const otherCounters = [
    "taskCheckLoopCount",
    "helpPromptLoopCount",
    "toolConsecutiveFailureCount",
  ];
  for (const key of otherCounters) {
    const value = Number(systemRuntime[key] || 0);
    systemRuntime[key] = Number.isFinite(value) && value > 0 ? value : 0;
  }
  systemRuntime.modelLoopRound = 0;

  systemRuntime.needsPhaseSummary = systemRuntime.needsPhaseSummary === true;
  systemRuntime.phaseSummaryByCharsPrompted = systemRuntime.phaseSummaryByCharsPrompted === true;
  systemRuntime.mainFlowFinalNoToolsTurnActive = false;
  systemRuntime.currentTurnUserMessage = String(userMessage || "").trim();
}
