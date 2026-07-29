/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isMessageEventEnvelope,
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
} from "./message-event-protocol.mjs";

export const WORKFLOW_RUNTIME_EVENT = Object.freeze({
  PLANNING: "workflow_planning_message_prepared",
  NODE_STATE: "workflow_node_state_committed",
  MESSAGE: "workflow_message_event",
  SESSION_SNAPSHOT: "workflow_session_snapshot_loaded",
});

export const WORKFLOW_SEQUENCE_DOMAIN = Object.freeze({
  PLANNING: "workflow-planning",
  NODE_STATE: "workflow-node-state",
  MESSAGE: MESSAGE_EVENT_SEQUENCE_DOMAIN,
  SESSION_SNAPSHOT: "workflow-session-snapshot",
  TRANSPORT: "transport",
});

export const WORKFLOW_RUNTIME_EVENT_PROTOCOL = "noobot.workflow_runtime_event";
export const WORKFLOW_RUNTIME_EVENT_VERSION = 1;

const text = (value) => String(value || "").trim();

function semanticEventName(record = {}, data = {}) {
  if (isMessageEventEnvelope(data)) return WORKFLOW_RUNTIME_EVENT.MESSAGE;
  return text(record?.event || record?.type || data?.event);
}

export function workflowSequenceDomainForEvent(event = "") {
  if (event === WORKFLOW_RUNTIME_EVENT.PLANNING) return WORKFLOW_SEQUENCE_DOMAIN.PLANNING;
  if (event === WORKFLOW_RUNTIME_EVENT.NODE_STATE) return WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE;
  if (event === WORKFLOW_RUNTIME_EVENT.MESSAGE) return WORKFLOW_SEQUENCE_DOMAIN.MESSAGE;
  if (event === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT) return WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT;
  return "";
}

export function normalizeWorkflowRuntimeEvent(record = {}, { source = "unknown" } = {}) {
  const data = record?.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data
    : record;
  const event = semanticEventName(record, data);
  const expectedDomain = workflowSequenceDomainForEvent(event);
  const declaredDomain = text(record?.sequenceDomain || data?.sequenceDomain);
  const sequenceDomain = declaredDomain || expectedDomain;
  const errors = [];
  if (!expectedDomain) errors.push("unsupported_event");
  if (declaredDomain && declaredDomain !== expectedDomain) errors.push("sequence_domain_mismatch");
  if (event === WORKFLOW_RUNTIME_EVENT.MESSAGE && !isMessageEventEnvelope(data)) {
    errors.push("invalid_message_envelope");
  }
  if (event === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT) {
    const sessionId = text(data?.sessionId || data?.id || data?.backendSessionId);
    if (!sessionId) errors.push("missing_snapshot_session");
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    if (messages.some((message = {}) => !text(message?.messageId || message?.id || message?.additional_kwargs?.noobotMessageId))) {
      errors.push("missing_snapshot_message_identity");
    }
  }
  const sequence = event === WORKFLOW_RUNTIME_EVENT.PLANNING
    ? 0
    : event === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT
      ? Number(data?.snapshotVersion || data?.sessionVersion || data?.revision || 1)
      : Number(data?.sequence || 0);
  if (![WORKFLOW_RUNTIME_EVENT.PLANNING, WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT].includes(event) && (!Number.isInteger(sequence) || sequence <= 0)) {
    errors.push("invalid_authoritative_sequence");
  }
  const canonicalData = {
    ...data,
    sequenceDomain,
    ...(event === WORKFLOW_RUNTIME_EVENT.PLANNING && Array.isArray(data?.nodeSessions)
      ? {
          nodeSessions: data.nodeSessions.map((node = {}) => ({
            ...node,
            sequenceDomain: text(node?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
          })),
        }
      : {}),
  };
  return Object.freeze({
    protocol: WORKFLOW_RUNTIME_EVENT_PROTOCOL,
    protocolVersion: WORKFLOW_RUNTIME_EVENT_VERSION,
    event,
    source: text(record?.source || source) || "unknown",
    sequenceDomain,
    sequence,
    revision: Number(data?.revision || 0),
    eventId: text(data?.eventId),
    transportSequence: Number(record?.transportSequence || 0),
    data: canonicalData,
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export function workflowRuntimeEventComparable(left = {}, right = {}) {
  const leftDomain = text(left?.sequenceDomain || left?.data?.sequenceDomain);
  const rightDomain = text(right?.sequenceDomain || right?.data?.sequenceDomain);
  if (!leftDomain || !rightDomain || leftDomain !== rightDomain) return false;
  return leftDomain !== WORKFLOW_SEQUENCE_DOMAIN.TRANSPORT;
}

export function compareWorkflowRuntimeFacts(incoming = {}, current = {}, { defaultDomain = "" } = {}) {
  const incomingDomain = text(incoming?.sequenceDomain || incoming?.data?.sequenceDomain) || text(defaultDomain);
  const currentDomain = text(current?.sequenceDomain || current?.data?.sequenceDomain) || text(defaultDomain);
  if (
    !incomingDomain ||
    !currentDomain ||
    incomingDomain !== currentDomain ||
    incomingDomain === WORKFLOW_SEQUENCE_DOMAIN.TRANSPORT
  ) {
    return Object.freeze({ comparable: false, order: 0, incomingDomain, currentDomain });
  }

  const incomingRevision = Number(incoming?.revision || incoming?.data?.revision || 0);
  const currentRevision = Number(current?.revision || current?.data?.revision || 0);
  if (incomingRevision !== currentRevision) {
    return Object.freeze({
      comparable: true,
      order: incomingRevision > currentRevision ? 1 : -1,
      incomingDomain,
      currentDomain,
    });
  }

  const incomingSequence = Number(incoming?.sequence || incoming?.seq || incoming?.data?.sequence || 0);
  const currentSequence = Number(current?.sequence || current?.seq || current?.data?.sequence || 0);
  return Object.freeze({
    comparable: true,
    order: incomingSequence === currentSequence ? 0 : (incomingSequence > currentSequence ? 1 : -1),
    incomingDomain,
    currentDomain,
  });
}
