/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { projectToolOperationSubject } from "@noobot/event-protocol/tool-presentation";
import { normalizeSecurityRiskLevel } from "@noobot/security-assessment-protocol";
import { resolveData, resolveTimestampMs, resolveToolName } from "./execution-log-fields.js";
import { text } from "@noobot/shared/value";
import { assertToolCallTiming } from "@noobot/event-protocol/tool-timing";
import {
  decodeToolResultText,
  projectToolResultExitCode,
} from "@noobot/event-protocol/tool-result";

const SLOWEST_TOOL_CALL_LIMIT = QUANTITY_THRESHOLDS.diagnostics.executionReportSlowestToolCalls;

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
    checkpointDurationMs: 0,
  };
}

function trackToolCall(acc, { log, data }, phase) {
  const toolCallId = text(data.toolCallId);
  if (!toolCallId) return;
  const entry = acc.toolCalls.get(toolCallId) || { tool: resolveToolName(log) };
  if (phase === "start" && entry.subject === undefined) {
    entry.subject = projectToolOperationSubject(entry.tool, data.args);
  }
  if (phase === "end") {
    entry.ended = true;
    entry.durationMs = data.durationMs;
    entry.persistDurationMs = data.persistDurationMs;
    entry.success = data.success === true;
    entry.exitCode = projectToolResultExitCode(decodeToolResultText(data.result));
    entry.riskLevel = normalizeSecurityRiskLevel(data.riskLevel);
  }
  acc.toolCalls.set(toolCallId, entry);
}

const EVENT_HANDLERS = {
  llm_call_start(acc, { data }) {
    acc.llmCalls += 1;
    acc.maxLoopRound = Math.max(acc.maxLoopRound, Number(data.modelLoopRound) || 0);
  },
  llm_call_end(acc, { data }) {
    if (data.toolCallCount > 0) acc.llmCallsWithTools += 1;
  },
  "model.invocation.started"(acc, { data }) {
    acc.invocations += 1;
    increment(acc.models, text(data?.model?.alias || data?.model?.model));
  },
  "model.invocation.completed"(acc, { data }) {
    acc.retries += Math.max(0, (Number(data.attemptCount) || 1) - 1);
  },
  model_switched(acc) {
    acc.modelSwitches += 1;
  },
  tool_call_start(acc, record) {
    trackToolCall(acc, record, "start");
  },
  tool_call_end(acc, record) {
    trackToolCall(acc, record, "end");
  },
  tool_call_timing(acc, { data }) {
    assertToolCallTiming(data);
    const entry = acc.toolCalls.get(data.toolCallId);
    if (!entry?.ended) throw new TypeError("tool_call_timing requires a completed tool call");
    if (Object.hasOwn(entry, "executionMs")) throw new TypeError("duplicate tool_call_timing");
    entry.executionMs = data.executionMs;
    entry.frameworkMs = data.frameworkMs;
  },
  timeline_checkpoint_persisted(acc, { data }) {
    if (Number.isFinite(data.durationMs)) acc.checkpointDurationMs += data.durationMs;
  },
  hook_summary(acc, { data }) {
    acc.hookCount += 1;
    acc.hookErrorCount += Number(data.errorCount) || 0;
    acc.hookDurationMs += Number(data.durationMs) || 0;
  },
  context_building(acc, { log }) {
    if (acc.contextStartMs == null) acc.contextStartMs = resolveTimestampMs(log);
  },
  context_ready(acc, { log }) {
    acc.contextReadyMs = resolveTimestampMs(log);
  },
};

function summarizeToolCalls(toolCalls) {
  const toolStats = {};
  const riskLevels = {};
  const timedCalls = [];
  let totalPersistDurationMs = 0;
  let totalExecutionMs = 0;
  let totalFrameworkMs = 0;
  let splitTimedCount = 0;
  for (const [toolCallId, entry] of toolCalls) {
    const stats = (toolStats[entry.tool] ||= {
      calls: 0,
      failures: 0,
      nonZeroExits: 0,
      timedCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    });
    stats.calls += 1;
    if (!entry.ended) continue;
    if (entry.success === false) stats.failures += 1;
    if (entry.exitCode) stats.nonZeroExits += 1;
    increment(riskLevels, entry.riskLevel);
    const { durationMs, persistDurationMs } = entry;
    if (!Number.isFinite(durationMs) || !Number.isFinite(persistDurationMs)) {
      throw new TypeError(`tool_call_end ${toolCallId} missing durationMs/persistDurationMs`);
    }
    totalPersistDurationMs += persistDurationMs;
    stats.timedCount += 1;
    stats.totalDurationMs += durationMs;
    stats.maxDurationMs = Math.max(stats.maxDurationMs, durationMs);
    const split = Number.isFinite(entry.executionMs) && Number.isFinite(entry.frameworkMs);
    if (split) {
      splitTimedCount += 1;
      totalExecutionMs += entry.executionMs;
      totalFrameworkMs += entry.frameworkMs;
      stats.totalExecutionMs = (stats.totalExecutionMs || 0) + entry.executionMs;
      stats.totalFrameworkMs = (stats.totalFrameworkMs || 0) + entry.frameworkMs;
    }
    timedCalls.push({
      toolCallId,
      tool: entry.tool,
      subject: entry.subject || "",
      durationMs,
      persistDurationMs,
      ...(split ? { executionMs: entry.executionMs, frameworkMs: entry.frameworkMs } : {}),
      success: entry.success,
    });
  }
  const slowestToolCalls = timedCalls
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, SLOWEST_TOOL_CALL_LIMIT);
  const totalToolDurationMs = timedCalls.reduce((sum, call) => sum + call.durationMs, 0);
  return {
    toolStats,
    riskLevels,
    slowestToolCalls,
    totalToolDurationMs,
    totalPersistDurationMs,
    ...(splitTimedCount ? { totalExecutionMs, totalFrameworkMs, splitTimedCount } : {}),
  };
}

export function summarizeExecutionMetrics(scopedLogs = []) {
  const acc = createAccumulator();
  for (const log of Array.isArray(scopedLogs) ? scopedLogs : []) {
    EVENT_HANDLERS[log.event]?.(acc, { log, data: resolveData(log) });
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
    phases: {
      contextBuildMs: resolveSpanMs(acc.contextStartMs, acc.contextReadyMs),
      checkpointDurationMs: acc.checkpointDurationMs,
    },
  };
}
