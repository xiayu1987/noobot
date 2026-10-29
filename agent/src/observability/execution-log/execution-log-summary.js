/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  TOOL_CALL_END_EVENT,
  TOOL_CALL_START_EVENT,
  isFailedToolResult,
  resolveData,
  resolveToolName,
} from "./execution-log-fields.js";
import { summarizeExecutionMetrics } from "./execution-report-metrics.js";
import { text } from "@noobot/shared/value";

const TOOL_PHASE_BY_EVENT = Object.freeze({
  [TOOL_CALL_START_EVENT]: "call",
  [TOOL_CALL_END_EVENT]: "result",
});

const VISIBLE_CATEGORIES = new Set(["error", "semantic_transfer"]);
const TOOL_ERROR_TYPE = "tool_error";

function isVisibleExecutionLog(log) {
  if (TOOL_PHASE_BY_EVENT[log.event]) return Boolean(resolveToolName(log));
  return VISIBLE_CATEGORIES.has(log.category);
}

function countVisibleActivity(visibleLogs) {
  const seen = { call: new Set(), result: new Set() };
  const counts = { toolCallCount: 0, toolResultCount: 0, errorCount: 0 };
  for (const log of visibleLogs) {
    const phase = TOOL_PHASE_BY_EVENT[log.event];
    const toolCallId = text(resolveData(log).toolCallId);
    if (phase && toolCallId) {
      if (seen[phase].has(toolCallId)) continue;
      seen[phase].add(toolCallId);
    }
    if (phase === "call") counts.toolCallCount += 1;
    if (phase === "result") counts.toolResultCount += 1;
    const isNonToolError = log.category === "error" && log.type !== TOOL_ERROR_TYPE;
    if (isNonToolError || isFailedToolResult(log)) counts.errorCount += 1;
  }
  return counts;
}

export function summarizeExecutionLogs(logs) {
  const visibleLogs = logs.filter(isVisibleExecutionLog);
  return {
    visibleTotal: visibleLogs.length,
    ...countVisibleActivity(visibleLogs),
    metrics: summarizeExecutionMetrics(logs),
  };
}
