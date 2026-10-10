/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nullishText as clean } from "./normalize.js";
import { requireDialogProcessKey } from "./identity.js";

export const EXECUTION_REPORT_PROTOCOL = "noobot.execution-report";
export const EXECUTION_REPORT_VERSION = 4;

export const EXECUTION_REPORT_STATUS = Object.freeze({
  COMPLETED: "completed",
  FAILED: "failed",
  USER_STOPPED: "user_stopped",
  INTERRUPTED: "interrupted",
});

const EXECUTION_REPORT_STATUSES = new Set(Object.values(EXECUTION_REPORT_STATUS));
function invalidReport(message) {
  const error = new TypeError(`invalid execution report: ${message}`);
  error.code = "EXECUTION_REPORT_INVALID";
  return error;
}

function encodeError(error) {
  if (!error) return null;
  return {
    name: clean(error.name) || "Error",
    code: clean(error.code),
    message: clean(error.message ?? error),
  };
}

function encodeSummary(executionSummary) {
  return {
    visibleTotal: executionSummary.visibleTotal,
    toolCallCount: executionSummary.toolCallCount,
    toolResultCount: executionSummary.toolResultCount,
    errorCount: executionSummary.errorCount,
    metrics: executionSummary.metrics,
  };
}

const SUMMARY_COUNT_FIELDS = Object.freeze([
  "visibleTotal",
  "toolCallCount",
  "toolResultCount",
  "errorCount",
]);

function assertSummaryShape(summary) {
  if (typeof summary !== "object" || Array.isArray(summary)) {
    throw invalidReport("summary must be an object");
  }
  for (const field of SUMMARY_COUNT_FIELDS) {
    if (!Number.isInteger(summary[field]) || summary[field] < 0) {
      throw invalidReport(`summary.${field} must be a non-negative integer`);
    }
  }
  if (!summary.metrics || typeof summary.metrics !== "object" || Array.isArray(summary.metrics)) {
    throw invalidReport("summary.metrics must be an object");
  }
}

function resolveDurationMs(startedAt, finishedAt) {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(finishedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, endMs - startMs);
}

function assertReportShape(report) {
  if (!EXECUTION_REPORT_STATUSES.has(report.status)) {
    throw invalidReport(`unknown status "${report.status}"`);
  }
  if (!report.sessionId) throw invalidReport("sessionId is required");
  requireDialogProcessKey(report.dialogProcessId);
  if ((report.summary === null) === (report.summaryError === null)) {
    throw invalidReport("exactly one of summary or summaryError is required");
  }
  if (report.summary !== null) assertSummaryShape(report.summary);
  if (report.status === EXECUTION_REPORT_STATUS.COMPLETED && report.error !== null) {
    throw invalidReport("completed report cannot carry error");
  }
  if (report.status !== EXECUTION_REPORT_STATUS.COMPLETED && report.error === null) {
    throw invalidReport(`${report.status} report requires error`);
  }
  return report;
}

export function buildExecutionReport({
  status,
  sessionId,
  parentSessionId = "",
  dialogProcessId,
  turnScopeId = "",
  caller = "",
  startedAt = "",
  finishedAt = "",
  executionSummary = null,
  summaryError = null,
  error = null,
}) {
  const normalizedStartedAt = clean(startedAt);
  const normalizedFinishedAt = clean(finishedAt);
  return assertReportShape({
    protocol: EXECUTION_REPORT_PROTOCOL,
    version: EXECUTION_REPORT_VERSION,
    status: clean(status),
    sessionId: clean(sessionId),
    parentSessionId: clean(parentSessionId),
    dialogProcessId: clean(dialogProcessId),
    turnScopeId: clean(turnScopeId),
    caller: clean(caller),
    startedAt: normalizedStartedAt,
    finishedAt: normalizedFinishedAt,
    durationMs: resolveDurationMs(normalizedStartedAt, normalizedFinishedAt),
    summary: executionSummary ? encodeSummary(executionSummary) : null,
    summaryError: encodeError(summaryError),
    error: encodeError(error),
  });
}

export function decodeExecutionReport(payload) {
  if (!payload || typeof payload !== "object") throw invalidReport("payload must be an object");
  if (payload.protocol !== EXECUTION_REPORT_PROTOCOL) {
    throw invalidReport(`unknown protocol "${payload.protocol}"`);
  }
  if (payload.version !== EXECUTION_REPORT_VERSION) {
    throw invalidReport(`unsupported version ${payload.version}`);
  }
  return assertReportShape(payload);
}
