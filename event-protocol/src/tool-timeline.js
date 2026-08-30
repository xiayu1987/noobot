/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { MESSAGE_EVENT_TYPE, projectMessageEventToolFacets } from "./message-event.js";
import { normalizeSecurityRiskLevel } from "@noobot/security-assessment-protocol";

const text = (value) => String(value || "").trim();

export function countCanonicalToolTimelineEvents(timeline = []) {
  return (Array.isArray(timeline) ? timeline : []).reduce(
    (count, entry = {}) =>
      count + Number(Boolean(entry?.call)) + Number(Boolean(entry?.resultEvent)),
    0,
  );
}

export function countCanonicalThinkingDetailEvents({
  toolTimeline = [],
  activityTimeline = [],
} = {}) {
  return (
    countCanonicalToolTimelineEvents(toolTimeline) +
    (Array.isArray(activityTimeline) ? activityTimeline.length : 0)
  );
}

export function isCanonicalToolMessageEvent(envelope = {}) {
  return [MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(
    envelope?.payload?.eventType,
  );
}

export function resolveCanonicalToolTimelineStatus(entry = {}) {
  if (!entry?.resultEvent) return "running";
  return entry.success === false ? "failed" : "completed";
}

function createToolEventFact(envelope = {}) {
  return {
    eventId: text(envelope?.identity?.eventId),
    sequence: Number(envelope?.ordering?.sequence || 0),
    sequenceScopeId: text(envelope?.ordering?.scopeId),
    sequenceDomain: text(envelope?.ordering?.domain),
    authority: "authoritative",
    timestamp: text(envelope.occurredAt),
    sessionId: text(envelope?.identity?.sessionId),
    dialogProcessId: text(envelope?.payload?.dialogProcessId),
    turnScopeId: text(envelope?.identity?.turnScopeId),
    ...(Array.isArray(envelope?.payload?.attachments) && envelope.payload.attachments.length
      ? { attachments: envelope.payload.attachments }
      : {}),
  };
}

export function applyCanonicalToolTimelineEvent(
  timeline = [],
  envelope = {},
  { indexByKey = null } = {},
) {
  if (!isCanonicalToolMessageEvent(envelope)) {
    return Array.isArray(timeline) ? timeline : [];
  }
  const payload = envelope.payload;
  const toolCallId = text(payload.toolCallId);
  if (!toolCallId) return Array.isArray(timeline) ? timeline : [];

  const key = `call:${toolCallId}`;
  const next = Array.isArray(timeline) ? timeline : [];
  const indexedPosition = indexByKey instanceof Map ? indexByKey.get(key) : undefined;
  const index =
    Number.isInteger(indexedPosition) && next[indexedPosition]?.key === key
      ? indexedPosition
      : next.findIndex((item) => item.key === key);
  if (index >= 0 && indexByKey instanceof Map) indexByKey.set(key, index);
  const current = index >= 0 ? next[index] : { key, toolCallId };
  const eventFact = createToolEventFact(envelope);

  const updated =
    payload.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START
      ? {
          ...current,
          tool: text(payload.tool || current.tool),
          args: payload.args ?? current.args ?? {},
          call: eventFact,
          riskLevel: normalizeSecurityRiskLevel(payload?.securityAssessment?.effectiveRiskLevel),
          status: current.resultEvent ? resolveCanonicalToolTimelineStatus(current) : "running",
        }
      : (() => {
          const entry = {
            ...current,
            tool: text(payload.tool || current.tool),
            result: payload.result,
            success: payload.success,
            resultEvent: eventFact,
            riskLevel: normalizeSecurityRiskLevel(payload?.securityAssessment?.effectiveRiskLevel),
          };
          return { ...entry, status: resolveCanonicalToolTimelineStatus(entry) };
        })();

  if (index >= 0) next[index] = updated;
  else {
    next.push(updated);
    if (indexByKey instanceof Map) indexByKey.set(key, next.length - 1);
  }
  return next;
}

export function reduceCanonicalToolTimeline(timeline = [], envelope = {}) {
  const next = Array.isArray(timeline) ? timeline.map((item) => ({ ...item })) : [];
  return applyCanonicalToolTimelineEvent(next, envelope);
}
