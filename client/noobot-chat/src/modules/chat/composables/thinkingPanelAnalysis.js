/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { selectLatestAnalysisActivities } from "../runtime/engine/activityTimeline.js";

function normalizeLogString(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isGuidanceAnalysisEventName(eventName = "") {
  return (
    eventName === "guidance_analysis_response" ||
    eventName === "guidance_analysis"
  );
}

export function isPluginAnalysisResponseLog(logItem = {}) {
  const eventName = normalizeLogString(logItem?.event || logItem?.type);
  const purpose = normalizeLogString(
    logItem?.purpose || logItem?.data?.purpose,
  );
  const pluginFlow = normalizeLogString(logItem?.pluginFlow);
  const chain = normalizeLogString(
    logItem?.chain ||
      logItem?.data?.chain ||
      logItem?.executionScope ||
      logItem?.data?.executionScope,
  );
  return (
    isGuidanceAnalysisEventName(eventName) &&
    purpose === "guidance" &&
    pluginFlow === "analysis" &&
    chain === "auxiliary"
  );
}

export function isGuidanceAnalysisResponseLog(logItem = {}) {
  const eventName = normalizeLogString(
    logItem?.event || logItem?.type || logItem?.rawEvent,
  );
  return isGuidanceAnalysisEventName(eventName);
}

export function isMainModelContentLog(logItem = {}) {
  const eventName = normalizeLogString(
    logItem?.event || logItem?.type || logItem?.rawEvent,
  );
  return eventName === "main_model_content";
}

function getMainModelContentLogOutput(logItem = {}) {
  return String(
    logItem?.output ??
      logItem?.data?.output ??
      logItem?.text ??
      logItem?.data?.text ??
      "",
  ).trim();
}

function getPluginAnalysisLogOutput(logItem = {}) {
  return String(logItem?.output || "").trim();
}

export function createThinkingAnalysisProjection({
  props,
  currentAnalysisProjection,
  getAllRealtimeLogs,
  getAllCompletedLogs,
  timelineMessage,
}) {
  function getLatestMainModelContentLog(messageItem = {}) {
    if (messageItem === props.messageItem) {
      const logItem = currentAnalysisProjection.value.latestModelAnalysis;
      const output = getMainModelContentLogOutput(logItem || {});
      if (output) return { ...logItem, output };
    }
    const logs = [
      ...getAllRealtimeLogs(messageItem),
      ...getAllCompletedLogs(messageItem),
    ].filter(isMainModelContentLog);
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const output = getMainModelContentLogOutput(logs[index]);
      if (output) return { ...logs[index], output };
    }
    return null;
  }

  function getLatestPluginAnalysisLog(messageItem = {}) {
    if (messageItem === props.messageItem) {
      const logItem = currentAnalysisProjection.value.latestGuidance;
      const output = getPluginAnalysisLogOutput(logItem || {});
      if (output) return { ...logItem, output };
    }
    const logs = [
      ...getAllRealtimeLogs(messageItem),
      ...getAllCompletedLogs(messageItem),
    ].filter(isPluginAnalysisResponseLog);
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const output = getPluginAnalysisLogOutput(logs[index]);
      if (output) return { ...logs[index], output };
    }
    return null;
  }

  function summarizeAnalysisProjection(messageItem = {}) {
    const projection = messageItem === props.messageItem
      ? currentAnalysisProjection.value
      : selectLatestAnalysisActivities(timelineMessage(messageItem));
    const latestGuidance = projection.latestGuidance;
    const latestModelAnalysis = projection.latestModelAnalysis;
    return {
      activityTimelineCount: projection.activityTimelineCount,
      latestGuidanceEventId: String(latestGuidance?.eventId || ""),
      latestGuidanceOutputLength: getPluginAnalysisLogOutput(latestGuidance || {}).length,
      latestGuidanceTimestamp: String(latestGuidance?.timestamp || latestGuidance?.ts || ""),
      latestModelAnalysisEventId: String(latestModelAnalysis?.eventId || ""),
      latestModelAnalysisOutputLength: getMainModelContentLogOutput(latestModelAnalysis || {}).length,
      latestModelAnalysisTimestamp: String(latestModelAnalysis?.timestamp || latestModelAnalysis?.ts || ""),
    };
  }

  return {
    getLatestMainModelContentLog,
    getLatestPluginAnalysisLog,
    summarizeAnalysisProjection,
  };
}

export function sourceToProjectionLatencyMs(timestamp = "", projectedAtMs = Date.now()) {
  const sourceAtMs = Date.parse(String(timestamp || ""));
  return Number.isFinite(sourceAtMs)
    ? Math.max(0, projectedAtMs - sourceAtMs)
    : null;
}
