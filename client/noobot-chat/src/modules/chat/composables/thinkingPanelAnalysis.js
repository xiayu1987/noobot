/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { selectLatestAnalysisActivities } from "../runtime/engine/activityTimeline.js";
import { text } from "@noobot/shared/value";

function getAnalysisLogOutput(logItem = {}) {
  return text(logItem?.text);
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

  function getAnalysisActivityTimeline(messageItem = {}) {
    const projection =
      messageItem === props.messageItem
        ? currentAnalysisProjection.value
        : selectLatestAnalysisActivities(timelineMessage(messageItem));
    return projection.activityTimeline;
  }

  function summarizeAnalysisProjection(messageItem = {}) {
    const projection =
      messageItem === props.messageItem
        ? currentAnalysisProjection.value
        : selectLatestAnalysisActivities(timelineMessage(messageItem));
    const latestModelAnalysis = projection.latestModelAnalysis;
    return {
      activityTimelineCount: projection.activityTimelineCount,
      latestModelAnalysisEventId: String(latestModelAnalysis?.eventId || ""),
      latestModelAnalysisOutputLength: getAnalysisLogOutput(latestModelAnalysis || {}).length,
      latestModelAnalysisTimestamp: String(latestModelAnalysis?.timestamp || ""),
    };
  }

  return {
    getLatestModelAnalysisLog,
    getAnalysisActivityTimeline,
    summarizeAnalysisProjection,
  };
}

export function sourceToProjectionLatencyMs(timestamp = "", projectedAtMs = Date.now()) {
  const sourceAtMs = Date.parse(String(timestamp || ""));
  return Number.isFinite(sourceAtMs) ? Math.max(0, projectedAtMs - sourceAtMs) : null;
}
