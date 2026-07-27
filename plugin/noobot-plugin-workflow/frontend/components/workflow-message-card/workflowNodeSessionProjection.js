/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildActivityTimelineFromLegacyLogs,
  buildToolTimelineFromLegacyLogs,
} from "noobot-chat/plugin-api/session-domain";

export function workflowSessionText(value) {
  return String(value || "").trim();
}

export function normalizePersistedExecutionLogs(logs = [], { turnScopeId = "", dialogProcessId = "" } = {}) {
  const scopeId = workflowSessionText(turnScopeId);
  const normalizedDialogProcessId = workflowSessionText(dialogProcessId);
  return (Array.isArray(logs) ? logs : [])
    .map((record = {}) => {
      const data = record?.data && typeof record.data === "object" ? record.data : {};
      const event = workflowSessionText(record?.event || data?.eventType || data?.event);
      const displayText = workflowSessionText(
        record?.text || record?.output || data?.text || data?.output || data?.content ||
        (event === "agent_lifecycle_state_changed" ? data?.phase || data?.state : ""),
      );
      return {
        ...record,
        ...data,
        event,
        rawEvent: event,
        type: workflowSessionText(record?.type || data?.type || data?.eventType),
        text: displayText,
        timestamp: workflowSessionText(data?.timestamp || record?.timestamp || record?.ts),
        ts: workflowSessionText(record?.ts || data?.timestamp),
      };
    })
    .filter((record = {}) => {
      const recordScopeId = workflowSessionText(record?.turnScopeId);
      const recordDialogId = workflowSessionText(record?.dialogProcessId);
      if (scopeId && recordScopeId) return recordScopeId === scopeId;
      if (normalizedDialogProcessId && recordDialogId) return recordDialogId === normalizedDialogProcessId;
      return true;
    });
}

export function attachPersistedExecutionLogs(messages = [], executionLogs = [], identity = {}) {
  const normalizedLogs = normalizePersistedExecutionLogs(executionLogs, identity);
  if (!normalizedLogs.length) return messages;
  return (Array.isArray(messages) ? messages : []).map((message = {}) => {
    if (message?.workflowNodeRunningPlaceholder !== true) return message;
    return {
      ...message,
      rawEvents: normalizedLogs,
      activityTimeline: buildActivityTimelineFromLegacyLogs(normalizedLogs),
      toolTimeline: buildToolTimelineFromLegacyLogs(normalizedLogs),
    };
  });
}
