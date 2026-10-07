/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { selectLatestAnalysisActivities } from "../runtime/engine/activityTimeline.js";

function getAnalysisLogOutput(logItem = {}) {
  return String(logItem?.text || "").trim();
}

export function createThinkingAnalysisProjection({
  props,
  currentAnalysisProjection,
  timelineMessage,
}) {
  function getLatestModelAnalysisLog(messageItem = {}) {
    const projection =
      messageItem === props.messageItem
        ? currentAnalysisProjection.value
        : selectLatestAnalysisActivities(timelineMessage(messageItem));
    return getAnalysisLogOutput(projection.latestModelAnalysis || {})
      ? projection.latestModelAnalysis
      : null;
  }

  function getLatestGuidanceAnalysisLog(messageItem = {}) {
    const projection =
      messageItem === props.messageItem
        ? currentAnalysisProjection.value
        : selectLatestAnalysisActivities(timelineMessage(messageItem));
    return getAnalysisLogOutput(projection.latestGuidance || {}) ? projection.latestGuidance : null;
  }

  function summarizeAnalysisProjection(messageItem = {}) {
    const projection =
      messageItem === props.messageItem
        ? currentAnalysisProjection.value
        : selectLatestAnalysisActivities(timelineMessage(messageItem));
    const latestGuidance = projection.latestGuidance;
    const latestModelAnalysis = projection.latestModelAnalysis;
    return {
      activityTimelineCount: projection.activityTimelineCount,
      latestGuidanceEventId: String(latestGuidance?.eventId || ""),
      latestGuidanceOutputLength: getAnalysisLogOutput(latestGuidance || {}).length,
      latestGuidanceTimestamp: String(latestGuidance?.timestamp || ""),
      latestModelAnalysisEventId: String(latestModelAnalysis?.eventId || ""),
      latestModelAnalysisOutputLength: getAnalysisLogOutput(latestModelAnalysis || {}).length,
      latestModelAnalysisTimestamp: String(latestModelAnalysis?.timestamp || ""),
    };
  }

  return {
    getLatestModelAnalysisLog,
    getLatestGuidanceAnalysisLog,
    summarizeAnalysisProjection,
  };
}

export function sourceToProjectionLatencyMs(timestamp = "", projectedAtMs = Date.now()) {
  const sourceAtMs = Date.parse(String(timestamp || ""));
  return Number.isFinite(sourceAtMs) ? Math.max(0, projectedAtMs - sourceAtMs) : null;
}
