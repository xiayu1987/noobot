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
import {
  MAIN_FLOW_CONTROL_REASON,
  requestMainFlowFinalNoToolsTurn,
} from "../main-flow-control.js";

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
  systemRuntime.phaseSummaryByCharsPrompted =
    systemRuntime.phaseSummaryByCharsPrompted === true;
  if (
    systemRuntime.phaseSummaryNoToolsNextTurn === true &&
    String(systemRuntime.mainFlowControlInstruction?.action || "").trim() !== "final_no_tools_turn"
  ) {
    requestMainFlowFinalNoToolsTurn({ systemRuntime }, {
      reason: MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY,
      source: "phase_summary_legacy_flag",
    });
  }
  systemRuntime.phaseSummaryNoToolsNextTurn = false;
  systemRuntime.mainFlowFinalNoToolsTurnActive = false;
  systemRuntime.currentTurnUserMessage = String(userMessage || "").trim();
}
