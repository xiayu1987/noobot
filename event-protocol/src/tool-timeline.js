/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { MESSAGE_EVENT_TYPE } from "./message-event.js";
import { selectCanonicalActivityTimeline } from "./activity-timeline.js";
import { normalizeSecurityRiskLevel } from "@noobot/security-assessment-protocol";
import {
  TASK_CHECK_PROTOCOL_VERSION,
  TASK_CHECK_TOOL_NAME,
  parseTaskCheckReceipt,
} from "@noobot/context-protocol/task/check-receipt";
import { decodeToolResultText } from "./tool-result.js";

const TOOL_EVENT_TYPES = Object.freeze(
  new Set([MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END]),
);

export function selectMessageToolTimeline(message) {
  return message.toolTimeline ?? [];
}

export function projectTaskCheckReceipt(entry) {
  if (entry.tool !== TASK_CHECK_TOOL_NAME || !entry.resultEvent || entry.success !== true) {
    return null;
  }
  const payload = decodeToolResultText(entry.result);
  if (payload.protocolVersion !== TASK_CHECK_PROTOCOL_VERSION) {
    throw new TypeError(`task_check result protocolVersion must be ${TASK_CHECK_PROTOCOL_VERSION}`);
  }
  return parseTaskCheckReceipt(payload.summary);
}

export function selectTaskCheckReceipt(entry) {
  if (Object.hasOwn(entry, "result")) return projectTaskCheckReceipt(entry);
  return entry.taskCheckReceipt ?? null;
}

export function countCanonicalToolTimelineEvents(timeline) {
  return timeline.reduce(
    (count, entry) => count + Number(Boolean(entry.call)) + Number(Boolean(entry.resultEvent)),
    0,
  );
}

export function countCanonicalThinkingDetailEvents(message) {
  return (
    countCanonicalToolTimelineEvents(selectMessageToolTimeline(message)) +
    selectCanonicalActivityTimeline(message).length
  );
}

export function isCanonicalToolMessageEvent(envelope) {
  return TOOL_EVENT_TYPES.has(envelope.payload.eventType);
}

export function resolveCanonicalToolTimelineStatus(entry) {
  if (!entry.resultEvent) return "running";
  if (typeof entry.success !== "boolean") {
    throw new TypeError("completed tool timeline entry requires boolean success");
  }
  return entry.success ? "completed" : "failed";
}

export function requireCanonicalToolTimelineIdentity(item) {
  const { key, toolCallId } = item;
  if (typeof toolCallId !== "string" || !toolCallId || key !== `call:${toolCallId}`) {
    throw new TypeError("tool timeline item requires key call:<toolCallId>");
  }
  return { key, toolCallId };
}

function pickPayloadResourceRefs(payload) {
  return payload.resourceRefs?.length ? { resourceRefs: payload.resourceRefs } : {};
}

function pickPayloadMutationRefs(payload) {
  return payload.mutationRefs?.length ? { mutationRefs: payload.mutationRefs } : {};
}

function createToolEventFact(envelope) {
  const { identity, ordering } = envelope;
  return {
    eventId: text(identity.eventId),
    sequence: ordering.sequence,
    sequenceScopeId: text(ordering.scopeId),
    sequenceDomain: text(ordering.domain),
    authority: "authoritative",
    timestamp: text(envelope.occurredAt),
    sessionId: text(identity.sessionId),
    dialogProcessId: text(envelope.payload.dialogProcessId),
    turnScopeId: text(identity.turnScopeId),
    ...pickPayloadResourceRefs(envelope.payload),
    ...pickPayloadMutationRefs(envelope.payload),
  };
}

export function applyCanonicalToolTimelineEvent(timeline, envelope, { indexByKey }) {
  if (!isCanonicalToolMessageEvent(envelope)) return timeline;
  const payload = envelope.payload;
  const toolCallId = payload.toolCallId;
  const key = `call:${toolCallId}`;
  const indexedPosition = indexByKey.get(key);
  const index =
    Number.isInteger(indexedPosition) && timeline[indexedPosition]?.key === key
      ? indexedPosition
      : timeline.findIndex((item) => item.key === key);
  if (index >= 0) indexByKey.set(key, index);
  const current = index >= 0 ? timeline[index] : { key, toolCallId };
  const eventFact = createToolEventFact(envelope);
  const riskLevel = normalizeSecurityRiskLevel(payload.securityAssessment?.effectiveRiskLevel);

  const updated =
    payload.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START
      ? {
          ...current,
          tool: payload.tool,
          args: payload.args,
          call: eventFact,
          riskLevel,
          status: current.resultEvent ? resolveCanonicalToolTimelineStatus(current) : "running",
        }
      : (() => {
          const entry = {
            ...current,
            tool: payload.tool,
            result: payload.result,
            success: payload.success,
            resultEvent: eventFact,
            riskLevel,
          };
          return { ...entry, status: resolveCanonicalToolTimelineStatus(entry) };
        })();

  if (index >= 0) timeline[index] = updated;
  else {
    timeline.push(updated);
    indexByKey.set(key, timeline.length - 1);
  }
  return timeline;
}

export function reduceCanonicalToolTimeline(timeline, envelope) {
  const next = timeline.map((item) => ({ ...item }));
  const indexByKey = new Map(next.map((item, position) => [item.key, position]));
  return applyCanonicalToolTimelineEvent(next, envelope, { indexByKey });
}
