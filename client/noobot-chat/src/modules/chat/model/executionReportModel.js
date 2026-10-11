/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { SECURITY_RISK_LEVEL, SECURITY_RISK_LEVELS } from "@noobot/security-assessment-protocol";

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

export function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return "-";
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function row(label, value) {
  return { label, value: value ?? "-" };
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
    row(translate("message.executionReportLlmCallsWithTools"), model.llmCallsWithTools),
    row(translate("message.executionReportLoopRounds"), model.maxLoopRound),
    row(translate("message.executionReportRetries"), model.retries),
    row(translate("message.executionReportModelSwitches"), model.switches),
    row(translate("message.executionReportModels"), formatCounter(model.models)),
  ];
}

function buildPhaseRows(metrics, translate) {
  return [
    row(
      translate("message.executionReportContextBuild"),
      formatDuration(metrics.phases.contextBuildMs),
    ),
    row(
      translate("message.executionReportToolDuration"),
      formatDuration(metrics.tools.totalToolDurationMs),
    ),
    row(
      translate("message.executionReportHookDuration"),
      formatDuration(metrics.hooks.totalDurationMs),
    ),
    row(translate("message.executionReportHooks"), metrics.hooks.count),
    row(translate("message.executionReportHookErrors"), metrics.hooks.errorCount),
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
    ratio: ratioOf(call.durationMs, maxDuration),
    success: call.success,
  }));
}

function buildMetricsView(metrics, translate) {
  if (!metrics) return { model: [], phases: [], risks: [], tools: [], slowest: [] };
  return {
    model: buildModelRows(metrics.model, translate),
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
