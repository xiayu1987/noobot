/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Normalizes systemRuntime counters to ensure they are valid numbers.
 * IMPORTANT: toolLoopExecutionCount MUST be normalized before
 * phaseSummaryLoopCount, because phaseSummaryLoopCount falls back to
 * the already-normalized toolLoopExecutionCount value.
 */
export function normalizeSystemRuntimeCounters(systemRuntime, userMessage) {
  if (!systemRuntime || typeof systemRuntime !== "object") return;

  const toolLoopExecutionCount = Number(systemRuntime.toolLoopExecutionCount || 0);
  systemRuntime.toolLoopExecutionCount =
    Number.isFinite(toolLoopExecutionCount) && toolLoopExecutionCount > 0
      ? toolLoopExecutionCount
      : 0;

  const phaseSummaryLoopCount = Number(
    systemRuntime.phaseSummaryLoopCount ??
      systemRuntime.toolLoopExecutionCount ??
      0,
  );
  systemRuntime.phaseSummaryLoopCount =
    Number.isFinite(phaseSummaryLoopCount) && phaseSummaryLoopCount > 0
      ? phaseSummaryLoopCount
      : 0;

  const otherCounters = ["helpPromptLoopCount", "toolConsecutiveFailureCount"];
  for (const key of otherCounters) {
    const value = Number(systemRuntime[key] || 0);
    systemRuntime[key] = Number.isFinite(value) && value > 0 ? value : 0;
  }

  systemRuntime.needsPhaseSummary = systemRuntime.needsPhaseSummary === true;
  systemRuntime.currentTurnUserMessage = String(userMessage || "").trim();
}
