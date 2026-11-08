/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nullishText as clean } from "./normalize.js";
import { requireDialogProcessKey } from "./identity.js";
import { isPlainObject, isObjectLike } from "@noobot/shared/value";
import { defineVersionChain, runVersionChain } from "@noobot/shared/migration";
import { requireExecutionModelMeasurements } from "./execution-model-measurements.js";
export {
  createExecutionModelMeasurements,
  requireExecutionModelMeasurements,
} from "./execution-model-measurements.js";

export const EXECUTION_REPORT_PROTOCOL = "noobot.execution-report";
export const EXECUTION_REPORT_VERSION = 6;

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

const METRICS_SECTION_FIELDS = Object.freeze({
  model: ["llmCalls", "llmCallsWithTools", "maxLoopRound", "invocations", "retries", "switches"],
  tools: ["totalToolDurationMs", "totalPersistDurationMs"],
  hooks: ["count", "errorCount", "totalDurationMs"],
});

function assertMetricsShape(metrics, historical) {
  if (!isPlainObject(metrics)) throw invalidReport("summary.metrics must be an object");
  for (const [section, fields] of Object.entries(METRICS_SECTION_FIELDS)) {
    if (!isPlainObject(metrics[section])) {
      throw invalidReport(`summary.metrics.${section} must be an object`);
    }
    for (const field of fields) {
      if (!Number.isFinite(metrics[section][field])) {
        throw invalidReport(`summary.metrics.${section}.${field} must be a number`);
      }
    }
  }
  if (!isPlainObject(metrics.model.models)) {
    throw invalidReport("summary.metrics.model.models must be an object");
  }
  if (!historical) requireExecutionModelMeasurements(metrics.model.measurements);
  for (const field of ["toolStats", "riskLevels"]) {
    if (!isPlainObject(metrics.tools[field])) {
      throw invalidReport(`summary.metrics.tools.${field} must be an object`);
    }
  }
  if (!Array.isArray(metrics.tools.slowestToolCalls)) {
    throw invalidReport("summary.metrics.tools.slowestToolCalls must be an array");
  }
  if (!isPlainObject(metrics.phases))
    throw invalidReport("summary.metrics.phases must be an object");
  const { contextBuildMs } = metrics.phases;
  if (contextBuildMs !== null && !Number.isFinite(contextBuildMs)) {
    throw invalidReport("summary.metrics.phases.contextBuildMs must be a number or null");
  }
}

function assertSummaryShape(summary, historical) {
  if (typeof summary !== "object" || Array.isArray(summary)) {
    throw invalidReport("summary must be an object");
  }
  for (const field of SUMMARY_COUNT_FIELDS) {
    if (!Number.isInteger(summary[field]) || summary[field] < 0) {
      throw invalidReport(`summary.${field} must be a non-negative integer`);
    }
  }
  assertMetricsShape(summary.metrics, historical);
}

function resolveDurationMs(startedAt, finishedAt) {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(finishedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw invalidReport("startedAt and finishedAt must be ISO instants");
  }
  if (endMs < startMs) throw invalidReport("finishedAt precedes startedAt");
  return endMs - startMs;
}

function assertReportShape(report, historical = false) {
  if (!EXECUTION_REPORT_STATUSES.has(report.status)) {
    throw invalidReport(`unknown status "${report.status}"`);
  }
  if (!report.sessionId) throw invalidReport("sessionId is required");
  requireDialogProcessKey(report.dialogProcessId);
  if ((report.summary === null) === (report.summaryError === null)) {
    throw invalidReport("exactly one of summary or summaryError is required");
  }
  if (report.summary !== null) assertSummaryShape(report.summary, historical);
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
  startedAt,
  finishedAt,
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
  if (!isObjectLike(payload)) throw invalidReport("payload must be an object");
  if (payload.protocol !== EXECUTION_REPORT_PROTOCOL) {
    throw invalidReport(`unknown protocol "${payload.protocol}"`);
  }
  if (payload.version !== EXECUTION_REPORT_VERSION) {
    throw invalidReport(`unsupported version ${payload.version}`);
  }
  return assertReportShape(payload);
}

export const EXECUTION_REPORT_VERSION_CHAIN = defineVersionChain({
  kind: "execution-report",
  currentVersion: EXECUTION_REPORT_VERSION,
  readVersion: (report) => report?.version,
  schemas: {
    5: (report) => {
      if (report.protocol !== EXECUTION_REPORT_PROTOCOL) throw invalidReport("unknown protocol");
      assertReportShape(report, true);
      resolveDurationMs(report.startedAt, report.finishedAt);
    },
    [EXECUTION_REPORT_VERSION]: decodeExecutionReport,
  },
  steps: [
    {
      from: 5,
      to: 6,
      migrate: (report) => ({
        ...report,
        version: 6,
        summary:
          report.summary === null
            ? null
            : {
                ...report.summary,
                metrics: {
                  ...report.summary.metrics,
                  model: {
                    ...report.summary.metrics.model,
                    measurements: { state: "legacy_not_collected" },
                  },
                },
              },
      }),
    },
  ],
});

export function migrateExecutionReport(payload) {
  return runVersionChain(EXECUTION_REPORT_VERSION_CHAIN, payload);
}
