/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { selectLatestAnalysisActivities } from "../runtime/engine/activityTimeline.js";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";

function normalizeLogString(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function isPluginAnalysisResponseLog(logItem = {}) {
  const eventType = normalizeLogString(logItem?.eventType);
  const activityKind = normalizeLogString(logItem?.activityKind);
  const purpose = normalizeLogString(logItem?.purpose);
  const pluginFlow = normalizeLogString(logItem?.pluginFlow);
  const chain = normalizeLogString(logItem?.chain);
  return (
    eventType === MESSAGE_EVENT_TYPE.THINKING &&
    activityKind === "guidance_analysis" &&
    purpose === "guidance" &&
    pluginFlow === "analysis" &&
    chain === "auxiliary"
  );
}

export function isGuidanceAnalysisResponseLog(logItem = {}) {
  return (
    normalizeLogString(logItem?.eventType) === MESSAGE_EVENT_TYPE.THINKING &&
    normalizeLogString(logItem?.activityKind) === "guidance_analysis"
  );
}

export function isMainModelContentLog(logItem = {}) {
  return normalizeLogString(logItem?.eventType) === MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT;
}

function getMainModelContentLogOutput(logItem = {}) {
  return String(logItem?.text || "").trim();
}

function getPluginAnalysisLogOutput(logItem = {}) {
  return String(logItem?.text || "").trim();
}

export function createThinkingAnalysisProjection({
  props,
  currentAnalysisProjection,
  timelineMessage,
}) {
  function getLatestMainModelContentLog(messageItem = {}) {
    const projection =
      messageItem === props.messageItem
        ? currentAnalysisProjection.value
        : selectLatestAnalysisActivities(timelineMessage(messageItem));
    return getMainModelContentLogOutput(projection.latestModelAnalysis || {})
      ? projection.latestModelAnalysis
      : null;
  }

  function getLatestPluginAnalysisLog(messageItem = {}) {
    const projection =
      messageItem === props.messageItem
        ? currentAnalysisProjection.value
        : selectLatestAnalysisActivities(timelineMessage(messageItem));
    return getPluginAnalysisLogOutput(projection.latestGuidance || {})
      ? projection.latestGuidance
      : null;
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
      latestGuidanceOutputLength: getPluginAnalysisLogOutput(latestGuidance || {}).length,
      latestGuidanceTimestamp: String(latestGuidance?.timestamp || ""),
      latestModelAnalysisEventId: String(latestModelAnalysis?.eventId || ""),
      latestModelAnalysisOutputLength: getMainModelContentLogOutput(latestModelAnalysis || {})
        .length,
      latestModelAnalysisTimestamp: String(latestModelAnalysis?.timestamp || ""),
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
  return Number.isFinite(sourceAtMs) ? Math.max(0, projectedAtMs - sourceAtMs) : null;
}
