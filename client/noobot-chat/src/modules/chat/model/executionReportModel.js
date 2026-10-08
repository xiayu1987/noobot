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
  return {
    text: statusView ? translate(statusView.key) : String(report.status || "-"),
    tone: statusView?.tone || "idle",
  };
}

function card(key, label, value, tone = "") {
  return { key, label, value: value ?? "-", tone };
}

function buildOverviewCards(report, metrics, translate) {
  const summary = report.summary || {};
  const errorCount = Number(summary.errorCount) || 0;
  const cards = [
    card(
      "duration",
      translate("message.executionReportDuration"),
      formatDuration(report.durationMs),
    ),
    card("toolCalls", translate("message.executionReportToolCalls"), summary.toolCallCount),
    card(
      "errors",
      translate("message.executionReportErrors"),
      errorCount,
      errorCount ? "error" : "",
    ),
  ];
  if (metrics?.model) {
    cards.push(
      card("llmCalls", translate("message.executionReportLlmCalls"), metrics.model.llmCalls),
    );
  }
  return cards;
}

function buildModelRows(model, translate) {
  if (!model) return [];
  return [
    row(translate("message.executionReportLlmCallsWithTools"), model.llmCallsWithTools),
    row(translate("message.executionReportLoopRounds"), model.maxLoopRound),
    row(translate("message.executionReportRetries"), model.retries),
    row(translate("message.executionReportModelSwitches"), model.switches),
    row(translate("message.executionReportModels"), formatCounter(model.models)),
  ];
}

function buildPhaseRows(metrics, translate) {
  if (!metrics) return [];
  return [
    row(
      translate("message.executionReportContextBuild"),
      formatDuration(metrics.phases?.contextBuildMs),
    ),
    row(
      translate("message.executionReportToolDuration"),
      formatDuration(metrics.tools?.totalToolDurationMs),
    ),
    row(
      translate("message.executionReportHookDuration"),
      formatDuration(metrics.hooks?.totalDurationMs),
    ),
    row(translate("message.executionReportHooks"), metrics.hooks?.count),
    row(translate("message.executionReportHookErrors"), metrics.hooks?.errorCount),
  ];
}

function buildToolRows(summary = {}) {
  const timings = summary.metrics?.tools?.toolTimings || {};
  const names = new Set([...Object.keys(summary.toolStats || {}), ...Object.keys(timings)]);
  const maxTotal = Math.max(
    0,
    ...Object.values(timings).map((timing) => timing?.totalDurationMs || 0),
  );
  return [...names].map((tool) => {
    const stats = summary.toolStats?.[tool] || {};
    const timing = timings[tool];
    return {
      tool,
      calls: Number(stats.calls) || 0,
      failures: Number(stats.failures) || 0,
      totalDuration: formatDuration(timing?.totalDurationMs),
      totalRatio: ratioOf(timing?.totalDurationMs, maxTotal),
      avgDuration: timing?.count ? formatDuration(timing.totalDurationMs / timing.count) : "-",
      maxDuration: formatDuration(timing?.maxDurationMs),
    };
  });
}

function buildRiskChips(riskLevels = {}) {
  const known = SECURITY_RISK_LEVELS.filter((level) => riskLevels[level]);
  const other = Object.keys(riskLevels).filter((level) => !SECURITY_RISK_LEVELS.includes(level));
  return [...known, ...other].map((level) => ({
    level,
    count: riskLevels[level],
    tone: RISK_TONES[level] || "idle",
  }));
}

function buildSlowestCalls(calls = []) {
  const maxDuration = Math.max(0, ...calls.map((call) => call.durationMs || 0));
  return calls.map((call) => ({
    key: call.toolCallId,
    tool: call.tool,
    subject: call.subject,
    duration: formatDuration(call.durationMs),
    ratio: ratioOf(call.durationMs, maxDuration),
    success: call.success !== false,
  }));
}

export function buildExecutionReportView(report, translate) {
  if (!report) return null;
  const summary = report.summary || {};
  const metrics = summary.metrics || null;
  return {
    status: buildStatus(report, translate),
    cards: buildOverviewCards(report, metrics, translate),
    error: report.error?.message || "",
    model: buildModelRows(metrics?.model, translate),
    phases: buildPhaseRows(metrics, translate),
    risks: buildRiskChips(metrics?.tools?.riskLevels),
    tools: buildToolRows(summary),
    slowest: buildSlowestCalls(metrics?.tools?.slowestToolCalls),
  };
}
