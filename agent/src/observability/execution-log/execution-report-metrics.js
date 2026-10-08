/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { projectToolOperationSubject } from "@noobot/event-protocol/tool-presentation";
import { resolveData, resolveEvent, resolveToolName } from "./execution-log-fields.js";

const SLOWEST_TOOL_CALL_LIMIT = QUANTITY_THRESHOLDS.diagnostics.executionReportSlowestToolCalls;

function resolveTimestampMs(log = {}) {
  const ms = Date.parse(String(log?.ts || resolveData(log).ts || ""));
  return Number.isFinite(ms) ? ms : null;
}

function resolveSpanMs(startMs, endMs) {
  if (startMs == null || endMs == null) return null;
  return Math.max(0, endMs - startMs);
}

function increment(counter, key) {
  if (!key) return;
  counter[key] = (counter[key] || 0) + 1;
}

function createAccumulator() {
  return {
    llmCalls: 0,
    llmCallsWithTools: 0,
    maxLoopRound: 0,
    invocations: 0,
    retries: 0,
    models: {},
    modelSwitches: 0,
    toolCalls: new Map(),
    hookCount: 0,
    hookErrorCount: 0,
    hookDurationMs: 0,
    contextStartMs: null,
    contextReadyMs: null,
  };
}

function trackToolCall(acc, log, data, phase) {
  const toolCallId = String(data.toolCallId || "").trim();
  if (!toolCallId) return;
  const entry = acc.toolCalls.get(toolCallId) || { tool: resolveToolName(log) };
  const ts = resolveTimestampMs(log);
  if (phase === "start" && entry.startMs == null) {
    entry.startMs = ts;
    entry.subject = projectToolOperationSubject(entry.tool, data.args);
  }
  if (phase === "end") {
    entry.endMs = ts;
    entry.success = data.success !== false && data.ok !== false;
    entry.riskLevel = String(data.riskLevel || "").trim();
  }
  acc.toolCalls.set(toolCallId, entry);
}

const EVENT_HANDLERS = {
  llm_call_start(acc, log, data) {
    acc.llmCalls += 1;
    acc.maxLoopRound = Math.max(acc.maxLoopRound, Number(data.modelLoopRound) || 0);
  },
  llm_call_end(acc, log, data) {
    if (data.hasToolCalls === true) acc.llmCallsWithTools += 1;
  },
  "model.invocation.started"(acc, log, data) {
    acc.invocations += 1;
    increment(acc.models, String(data?.model?.alias || data?.model?.model || "").trim());
  },
  "model.invocation.completed"(acc, log, data) {
    acc.retries += Math.max(0, (Number(data.attemptCount) || 1) - 1);
  },
  model_switched(acc) {
    acc.modelSwitches += 1;
  },
  tool_call_start(acc, log, data) {
    trackToolCall(acc, log, data, "start");
  },
  tool_call_end(acc, log, data) {
    trackToolCall(acc, log, data, "end");
  },
  hook_summary(acc, log, data) {
    acc.hookCount += 1;
    acc.hookErrorCount += Number(data.errorCount) || 0;
    acc.hookDurationMs += Number(data.durationMs) || 0;
  },
  context_building(acc, log) {
    if (acc.contextStartMs == null) acc.contextStartMs = resolveTimestampMs(log);
  },
  context_ready(acc, log) {
    acc.contextReadyMs = resolveTimestampMs(log);
  },
};

function summarizeToolCalls(toolCalls) {
  const toolStats = {};
  const riskLevels = {};
  const timedCalls = [];
  for (const [toolCallId, entry] of toolCalls) {
    const stats = (toolStats[entry.tool] ||= {
      calls: 0,
      failures: 0,
      timedCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    });
    stats.calls += 1;
    if (entry.endMs === undefined) continue;
    if (entry.success === false) stats.failures += 1;
    increment(riskLevels, entry.riskLevel);
    const durationMs = resolveSpanMs(entry.startMs, entry.endMs);
    if (durationMs == null) continue;
    stats.timedCount += 1;
    stats.totalDurationMs += durationMs;
    stats.maxDurationMs = Math.max(stats.maxDurationMs, durationMs);
    timedCalls.push({
      toolCallId,
      tool: entry.tool,
      subject: entry.subject || "",
      durationMs,
      success: entry.success,
    });
  }
  const slowestToolCalls = timedCalls
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, SLOWEST_TOOL_CALL_LIMIT);
  const totalToolDurationMs = timedCalls.reduce((sum, call) => sum + call.durationMs, 0);
  return { toolStats, riskLevels, slowestToolCalls, totalToolDurationMs };
}

export function summarizeExecutionMetrics(scopedLogs = []) {
  const acc = createAccumulator();
  for (const log of Array.isArray(scopedLogs) ? scopedLogs : []) {
    EVENT_HANDLERS[resolveEvent(log)]?.(acc, log, resolveData(log));
  }
  return {
    model: {
      llmCalls: acc.llmCalls,
      llmCallsWithTools: acc.llmCallsWithTools,
      maxLoopRound: acc.maxLoopRound,
      invocations: acc.invocations,
      retries: acc.retries,
      switches: acc.modelSwitches,
      models: acc.models,
    },
    tools: summarizeToolCalls(acc.toolCalls),
    hooks: {
      count: acc.hookCount,
      errorCount: acc.hookErrorCount,
      totalDurationMs: acc.hookDurationMs,
    },
    phases: { contextBuildMs: resolveSpanMs(acc.contextStartMs, acc.contextReadyMs) },
  };
}
