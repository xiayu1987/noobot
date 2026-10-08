/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const EXECUTION_REPORT_PROTOCOL = "noobot.execution-report";
export const EXECUTION_REPORT_VERSION = 2;

export const EXECUTION_REPORT_STATUS = Object.freeze({
  COMPLETED: "completed",
  FAILED: "failed",
  USER_STOPPED: "user_stopped",
  INTERRUPTED: "interrupted",
});

function resolveDurationMs(startedAt, finishedAt) {
  const startMs = Date.parse(String(startedAt || ""));
  const endMs = Date.parse(String(finishedAt || ""));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, endMs - startMs);
}

function pickSummaryMetrics(executionSummary) {
  if (!executionSummary || typeof executionSummary !== "object") return null;
  return {
    visibleTotal: Number(executionSummary.visibleTotal) || 0,
    toolCallCount: Number(executionSummary.toolCallCount) || 0,
    toolResultCount: Number(executionSummary.toolResultCount) || 0,
    errorCount: Number(executionSummary.errorCount) || 0,
    toolStats: executionSummary.toolStats || {},
    metrics: executionSummary.metrics || null,
  };
}

function pickError(error) {
  if (!error) return null;
  return {
    name: String(error?.name || "Error"),
    code: String(error?.code || ""),
    message: String(error?.message || error),
  };
}

export function buildExecutionReport({
  status,
  sessionId = "",
  parentSessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
  caller = "",
  startedAt = "",
  finishedAt = "",
  executionSummary = null,
  error = null,
} = {}) {
  return {
    protocol: EXECUTION_REPORT_PROTOCOL,
    version: EXECUTION_REPORT_VERSION,
    status: String(status || ""),
    sessionId: String(sessionId || ""),
    parentSessionId: String(parentSessionId || ""),
    dialogProcessId: String(dialogProcessId || ""),
    turnScopeId: String(turnScopeId || ""),
    caller: String(caller || ""),
    startedAt: String(startedAt || ""),
    finishedAt: String(finishedAt || ""),
    durationMs: resolveDurationMs(startedAt, finishedAt),
    summary: pickSummaryMetrics(executionSummary),
    error: pickError(error),
  };
}

export async function saveExecutionReportBestEffort(
  saveExecutionReport,
  { userId, sessionId, parentSessionId = "", persistenceContext = null, report },
  runBestEffort,
) {
  if (typeof saveExecutionReport !== "function") return undefined;
  return runBestEffort(
    () => saveExecutionReport({ userId, sessionId, parentSessionId, report, persistenceContext }),
    { operationName: "executionReport.save", context: { sessionId, status: report?.status } },
  );
}
