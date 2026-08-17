/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { MESSAGE_EVENT_TYPE, projectMessageEventToolFacets } from "./message-event.js";
import { normalizeSecurityRiskLevel } from "@noobot/security-assessment-protocol";

const text = (value) => String(value || "").trim();

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

export function reduceCanonicalToolTimeline(timeline = [], envelope = {}) {
  if (!isCanonicalToolMessageEvent(envelope)) {
    return Array.isArray(timeline) ? timeline : [];
  }
  const payload = envelope.payload;
  const toolCallId = text(payload.toolCallId);
  if (!toolCallId) return Array.isArray(timeline) ? timeline : [];

  const key = `call:${toolCallId}`;
  const next = Array.isArray(timeline) ? timeline.map((item) => ({ ...item })) : [];
  const index = next.findIndex((item) => item.key === key);
  const current = index >= 0 ? next[index] : { key, toolCallId };
  const { toolCall, toolResult } = projectMessageEventToolFacets(payload);
  const eventFact = createToolEventFact(envelope);

  const updated =
    payload.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START
      ? {
          ...current,
          tool: text(payload.tool || toolCall?.name || current.tool),
          args: toolCall?.args ?? payload.args ?? current.args ?? {},
          call: eventFact,
          riskLevel: normalizeSecurityRiskLevel(payload?.securityAssessment?.effectiveRiskLevel),
          status: current.resultEvent ? resolveCanonicalToolTimelineStatus(current) : "running",
        }
      : (() => {
          const entry = {
            ...current,
            tool: text(payload.tool || toolResult?.name || current.tool),
            result: toolResult?.output ?? payload.result,
            success: payload.success,
            resultEvent: eventFact,
            riskLevel: normalizeSecurityRiskLevel(payload?.securityAssessment?.effectiveRiskLevel),
          };
          return { ...entry, status: resolveCanonicalToolTimelineStatus(entry) };
        })();

  if (index >= 0) next[index] = updated;
  else next.push(updated);
  return next;
}
