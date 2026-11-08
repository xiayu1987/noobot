/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { SECURITY_RISK_LEVEL, SECURITY_RISK_LEVELS } from "@noobot/security-assessment-protocol";
import { buildExecutionReportUsageRows } from "./executionReportUsageModel.js";

const STATUS_VIEW = Object.freeze({
  completed: { key: "message.executionReportStatusCompleted", tone: "success" },
  failed: { key: "message.executionReportStatusFailed", tone: "error" },
  user_stopped: { key: "message.executionReportStatusUserStopped", tone: "warning" },
  interrupted: { key: "message.executionReportStatusInterrupted", tone: "warning" },
});

const RISK_TONES = Object.freeze({
  [SECURITY_RISK_LEVEL.LOW]: "success",
  [SECURITY_RISK_LEVEL.MEDIUM]: "warning",
  [SECURITY_RISK_LEVEL.HIGH]: "error",
  [SECURITY_RISK_LEVEL.CRITICAL]: "error",
});

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return "-";
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function row(key, value, translate) {
  return { key, label: translate(key), value: value ?? "-" };
}

function ratioOf(value, max) {
  return Number.isFinite(value) && max > 0 ? Math.min(1, value / max) : 0;
}

function formatCounter(counter = {}) {
  const entries = Object.entries(counter);
  if (!entries.length) return "-";
  return entries.map(([name, count]) => `${name} × ${count}`).join(", ");
}

function buildStatus(report, translate) {
  const statusView = STATUS_VIEW[report.status];
  return { text: translate(statusView.key), tone: statusView.tone };
}

function card(key, label, value, tone = "") {
  return { key, label, value: value ?? "-", tone };
}

function buildOverviewCards(report, translate) {
  const durationCard = card(
    "duration",
    translate("message.executionReportDuration"),
    formatDuration(report.durationMs),
  );
  const { summary } = report;
  if (!summary) return [durationCard];
  return [
    durationCard,
    card("toolCalls", translate("message.executionReportToolCalls"), summary.toolCallCount),
    card(
      "errors",
      translate("message.executionReportError"),
      summary.errorCount,
      summary.errorCount ? "error" : "",
    ),
    card("llmCalls", translate("message.executionReportLlmCalls"), summary.metrics.model.llmCalls),
  ];
}

function buildModelRows(model, translate) {
  return [
    row("message.executionReportLlmCallsWithTools", model.llmCallsWithTools, translate),
    row("message.executionReportLoopRounds", model.maxLoopRound, translate),
    row("message.executionReportRetries", model.retries, translate),
    row("message.executionReportModelSwitches", model.switches, translate),
    row("message.executionReportModels", formatCounter(model.models), translate),
  ];
}

function buildPhaseRows(metrics, translate) {
  return [
    ...[
      ["message.executionReportToolExecution", metrics.tools.totalExecutionMs],
      ["message.executionReportToolFramework", metrics.tools.totalFrameworkMs],
      ["message.executionReportCheckpointDuration", metrics.phases.checkpointDurationMs],
    ]
      .filter(([, value]) => Number.isFinite(value))
      .map(([key, value]) => row(key, formatDuration(value), translate)),
    row(
      "message.executionReportContextBuild",
      formatDuration(metrics.phases.contextBuildMs),
      translate,
    ),
    row(
      "message.executionReportToolDuration",
      formatDuration(metrics.tools.totalToolDurationMs),
      translate,
    ),
    row(
      "message.executionReportPersistDuration",
      formatDuration(metrics.tools.totalPersistDurationMs),
      translate,
    ),
    row(
      "message.executionReportHookDuration",
      formatDuration(metrics.hooks.totalDurationMs),
      translate,
    ),
    row("message.executionReportHooks", metrics.hooks.count, translate),
    row("message.executionReportHookErrors", metrics.hooks.errorCount, translate),
  ];
}

function buildToolRows(toolStats) {
  const entries = Object.entries(toolStats).sort(
    ([, left], [, right]) => right.totalDurationMs - left.totalDurationMs,
  );
  const maxTotal = Math.max(0, ...entries.map(([, stats]) => stats.totalDurationMs));
  return entries.map(([tool, stats]) => {
    const timed = stats.timedCount > 0;
    return {
      tool,
      calls: stats.calls,
      failures: stats.failures,
      nonZeroExits: stats.nonZeroExits,
      totalDuration: timed ? formatDuration(stats.totalDurationMs) : "-",
      totalRatio: ratioOf(stats.totalDurationMs, maxTotal),
      avgDuration: timed ? formatDuration(stats.totalDurationMs / stats.timedCount) : "-",
      maxDuration: timed ? formatDuration(stats.maxDurationMs) : "-",
    };
  });
}

function buildRiskChips(riskLevels) {
  return SECURITY_RISK_LEVELS.filter((level) => riskLevels[level]).map((level) => ({
    level,
    count: riskLevels[level],
    tone: RISK_TONES[level],
  }));
}

function buildSlowestCalls(calls) {
  const maxDuration = Math.max(0, ...calls.map((call) => call.durationMs));
  return calls.map((call, index) => ({
    key: call.toolCallId,
    rank: index + 1,
    tool: call.tool,
    subject: call.subject,
    duration: formatDuration(call.durationMs),
    persistDuration: formatDuration(call.persistDurationMs),
    ratio: ratioOf(call.durationMs, maxDuration),
    success: call.success,
  }));
}

function buildMetricsView(metrics, translate) {
  if (!metrics) return { model: [], usage: [], phases: [], risks: [], tools: [], slowest: [] };
  return {
    model: buildModelRows(metrics.model, translate),
    usage: buildExecutionReportUsageRows(metrics.model.measurements, translate),
    phases: buildPhaseRows(metrics, translate),
    risks: buildRiskChips(metrics.tools.riskLevels),
    tools: buildToolRows(metrics.tools.toolStats),
    slowest: buildSlowestCalls(metrics.tools.slowestToolCalls),
  };
}

export function buildExecutionReportView(report, translate) {
  if (report === null) return null;
  return {
    status: buildStatus(report, translate),
    cards: buildOverviewCards(report, translate),
    error: report.error?.message ?? "",
    summaryError: report.summaryError?.message ?? "",
    ...buildMetricsView(report.summary?.metrics ?? null, translate),
  };
}
