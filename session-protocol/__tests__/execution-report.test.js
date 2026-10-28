/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExecutionReport,
  decodeExecutionReport,
  EXECUTION_REPORT_STATUS,
  EXECUTION_REPORT_VERSION,
} from "../src/execution-report.js";
import { isDialogProcessKey, requireDialogProcessKey } from "../src/identity.js";

const metrics = {
  model: {
    llmCalls: 1,
    llmCallsWithTools: 1,
    maxLoopRound: 1,
    invocations: 1,
    retries: 0,
    switches: 0,
    models: { m1: 1 },
  },
  tools: {
    toolStats: {},
    riskLevels: {},
    slowestToolCalls: [],
    totalToolDurationMs: 0,
    totalPersistDurationMs: 0,
  },
  hooks: { count: 0, errorCount: 0, totalDurationMs: 0 },
  phases: { contextBuildMs: null },
};

const summary = {
  visibleTotal: 3,
  toolCallCount: 2,
  toolResultCount: 2,
  errorCount: 1,
  metrics,
  steps: [{ index: 0 }],
};

function failedReport(overrides = {}) {
  return buildExecutionReport({
    status: EXECUTION_REPORT_STATUS.FAILED,
    sessionId: "s1",
    dialogProcessId: "dp1",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.500Z",
    executionSummary: summary,
    error: Object.assign(new Error("boom"), { code: "E1" }),
    ...overrides,
  });
}

test("buildExecutionReport keeps aggregate metrics, duration and error only", () => {
  const report = failedReport();
  assert.equal(report.protocol, "noobot.execution-report");
  assert.equal(report.version, EXECUTION_REPORT_VERSION);
  assert.equal(report.durationMs, 1500);
  assert.deepEqual(report.summary, {
    visibleTotal: 3,
    toolCallCount: 2,
    toolResultCount: 2,
    errorCount: 1,
    metrics,
  });
  assert.equal(report.summaryError, null);
  assert.deepEqual(report.error, { name: "Error", code: "E1", message: "boom" });
});

test("buildExecutionReport records an explicit summaryError instead of an empty summary", () => {
  const report = failedReport({ executionSummary: null, summaryError: new Error("disk") });
  assert.equal(report.summary, null);
  assert.deepEqual(report.summaryError, { name: "Error", code: "", message: "disk" });
});

test("buildExecutionReport requires exactly one of summary or summaryError", () => {
  assert.throws(() => failedReport({ executionSummary: null }), /summary or summaryError/);
  assert.throws(() => failedReport({ summaryError: new Error("x") }), /summary or summaryError/);
});

test("buildExecutionReport rejects a summary without the aggregate shape", () => {
  assert.throws(
    () => failedReport({ executionSummary: { durationMs: 0 } }),
    /summary\.visibleTotal/,
  );
  assert.throws(
    () => failedReport({ executionSummary: { ...summary, errorCount: -1 } }),
    /summary\.errorCount/,
  );
  assert.throws(
    () => failedReport({ executionSummary: { ...summary, metrics: null } }),
    /summary\.metrics/,
  );
  assert.throws(
    () => failedReport({ executionSummary: { ...summary, metrics: { ...metrics, hooks: null } } }),
    /summary\.metrics\.hooks must be an object/,
  );
  assert.throws(
    () =>
      failedReport({
        executionSummary: {
          ...summary,
          metrics: { ...metrics, tools: { ...metrics.tools, slowestToolCalls: null } },
        },
      }),
    /slowestToolCalls must be an array/,
  );
  assert.throws(
    () =>
      failedReport({
        executionSummary: { ...summary, metrics: { ...metrics, phases: { contextBuildMs: "1" } } },
      }),
    /contextBuildMs must be a number or null/,
  );
});

test("buildExecutionReport rejects missing identity and inconsistent status", () => {
  assert.throws(() => failedReport({ dialogProcessId: "" }), /dialogProcessId/);
  assert.throws(() => failedReport({ dialogProcessId: "../x" }), /dialogProcessId/);
  assert.throws(() => failedReport({ sessionId: "" }), /sessionId/);
  assert.throws(() => failedReport({ status: "done" }), /unknown status/);
  assert.throws(() => failedReport({ error: null }), /requires error/);
  assert.throws(
    () => failedReport({ status: EXECUTION_REPORT_STATUS.COMPLETED }),
    /cannot carry error/,
  );
});

test("buildExecutionReport leaves durationMs null without both timestamps", () => {
  assert.equal(failedReport({ finishedAt: "" }).durationMs, null);
});

test("decodeExecutionReport accepts current reports and rejects other versions", () => {
  const report = failedReport();
  assert.deepEqual(decodeExecutionReport(JSON.parse(JSON.stringify(report))), report);
  assert.throws(() => decodeExecutionReport({ ...report, version: 3 }), /unsupported version/);
  assert.throws(() => decodeExecutionReport({ ...report, protocol: "x" }), /unknown protocol/);
  const { summaryError: _omitted, ...missingField } = report;
  assert.throws(() => decodeExecutionReport(missingField), /summary or summaryError/);
});

test("requireDialogProcessKey is the single turn identity assertion", () => {
  assert.equal(requireDialogProcessKey(" dp-1_a "), "dp-1_a");
  assert.equal(isDialogProcessKey("dp-1_a"), true);
  for (const invalid of ["a/b", "..", "", undefined, null]) {
    assert.equal(isDialogProcessKey(invalid), false);
    assert.throws(() => requireDialogProcessKey(invalid), { code: "DIALOG_PROCESS_ID_INVALID" });
  }
});
