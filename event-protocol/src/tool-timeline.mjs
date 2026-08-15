/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  projectMessageEventToolFacets,
  resolveMessageEventSequenceIdentity,
} from "./message-event.mjs";
import { normalizeSecurityRiskLevel } from "@noobot/security-assessment-protocol";

const text = (value) => String(value || "").trim();

export function isCanonicalToolMessageEvent(envelope = {}) {
  return [MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(
    envelope?.eventType,
  );
}

export function resolveCanonicalToolTimelineStatus(entry = {}) {
  if (!entry?.resultEvent) return "running";
  return entry.success === false ? "failed" : "completed";
}

function createToolEventFact(envelope = {}) {
  const sequenceIdentity = resolveMessageEventSequenceIdentity(envelope);
  return {
    eventId: text(envelope.eventId),
    sequence: Number(envelope.sequence || 0),
    sequenceScopeId: sequenceIdentity.sequenceScopeId,
    sequenceDomain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
    authority: "authoritative",
    timestamp: text(envelope.timestamp),
    sessionId: text(envelope.sessionId),
    dialogProcessId: text(envelope.dialogProcessId),
    turnScopeId: text(envelope.turnScopeId),
    ...(Array.isArray(envelope.attachments) && envelope.attachments.length
      ? { attachments: envelope.attachments }
      : {}),
  };
}

export function reduceCanonicalToolTimeline(timeline = [], envelope = {}) {
  if (!isCanonicalToolMessageEvent(envelope)) {
    return Array.isArray(timeline) ? timeline : [];
  }
  const toolCallId = text(envelope.toolCallId || envelope.tool_call_id);
  if (!toolCallId) return Array.isArray(timeline) ? timeline : [];

  const key = `call:${toolCallId}`;
  const next = Array.isArray(timeline) ? timeline.map((item) => ({ ...item })) : [];
  const index = next.findIndex((item) => item.key === key);
  const current = index >= 0 ? next[index] : { key, toolCallId };
  const { toolCall, toolResult } = projectMessageEventToolFacets(envelope);
  const eventFact = createToolEventFact(envelope);

  const updated =
    envelope.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START
      ? {
          ...current,
          tool: text(envelope.tool || toolCall?.name || current.tool),
          args: toolCall?.args ?? envelope.args ?? current.args ?? {},
          call: eventFact,
          riskLevel: normalizeSecurityRiskLevel(envelope?.securityAssessment?.effectiveRiskLevel),
          status: current.resultEvent ? resolveCanonicalToolTimelineStatus(current) : "running",
        }
      : (() => {
          const success = envelope.success;
          const entry = {
            ...current,
            tool: text(envelope.tool || toolResult?.name || current.tool),
            result: toolResult?.output ?? envelope.result,
            success,
            resultEvent: eventFact,
            riskLevel: normalizeSecurityRiskLevel(envelope?.securityAssessment?.effectiveRiskLevel),
          };
          return { ...entry, status: resolveCanonicalToolTimelineStatus(entry) };
        })();

  if (index >= 0) next[index] = updated;
  else next.push(updated);
  return next;
}
