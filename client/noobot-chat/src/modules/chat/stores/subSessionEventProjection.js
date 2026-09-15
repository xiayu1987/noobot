/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  resolveMessageEventPresentationId,
} from "@noobot/event-protocol/message-event";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";

function text(value) {
  return String(value || "").trim();
}

function resolveOrderingIdentity(entry = {}) {
  return {
    sequenceKey: entry?.ordering?.scopeId,
    sequence: Number(entry?.ordering?.sequence || 0),
  };
}

function sameOrderingScopeWithDistinctSequence(left, right) {
  return (
    Boolean(left.sequenceKey) &&
    left.sequenceKey === right.sequenceKey &&
    left.sequence !== right.sequence
  );
}

function compareOccurredAt(left, right) {
  const leftTime = Date.parse(text(left?.occurredAt));
  const rightTime = Date.parse(text(right?.occurredAt));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return 0;
}

export function compareMessageEventOrder(left = {}, right = {}) {
  const leftIdentity = resolveOrderingIdentity(left);
  const rightIdentity = resolveOrderingIdentity(right);
  if (sameOrderingScopeWithDistinctSequence(leftIdentity, rightIdentity)) {
    return leftIdentity.sequence - rightIdentity.sequence;
  }
  return compareOccurredAt(left, right);
}

export function buildSubSessionContainerIdentity(eventData = {}, currentSession = {}) {
  return {
    parentSessionId: text(eventData?.parentSessionId || currentSession.parentSessionId),
    dialogProcessId: text(eventData?.dialogProcessId || currentSession.dialogProcessId),
    turnScopeId: text(eventData?.turnScopeId || currentSession.turnScopeId),
    workflowRunId: text(eventData?.workflowRunId || currentSession.workflowRunId),
    nodeExecutionId: text(eventData?.nodeExecutionId || currentSession.nodeExecutionId),
    updatedAt:
      currentSession.updatedAt ||
      text(eventData?.updatedAt || eventData?.createdAt || eventData?.timestamp),
  };
}

function maxNumber(left, right) {
  return Math.max(Number(left || 0), Number(right || 0));
}

function rejectGate(reason, current = null) {
  return current ? { ok: false, reason, current } : { ok: false, reason };
}

function validateEnvelopeFamily(eventData) {
  const envelopeValidation = validateProtocolEvent(eventData);
  const familyMatched =
    envelopeValidation.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE;
  if (envelopeValidation.valid && familyMatched) return null;
  return {
    ok: false,
    reason: "invalid_authoritative_message_event",
    errors: envelopeValidation.errors,
  };
}

function hasCompleteEventIdentity({ eventData, eventId, projectionEventName, ordering }) {
  if (!eventId || !projectionEventName) return false;
  if (!text(resolveMessageEventPresentationId(eventData?.payload))) return false;
  return Number(ordering.sequence) > 0;
}

function evaluateSequenceMonotonicity({ currentSession, sequenceKey, sequence }) {
  if (!sequenceKey || !(sequence > 0)) return null;
  const appliedSequence = Number(currentSession.sequenceByScopeKey?.[sequenceKey] || 0);
  if (appliedSequence === sequence) return rejectGate("duplicate_sequence", currentSession);
  if (sequence < appliedSequence) return rejectGate("stale", currentSession);
  return null;
}

export function evaluateSubSessionEventGate({ eventData, registry, createEmptySession }) {
  const familyRejection = validateEnvelopeFamily(eventData);
  if (familyRejection) return familyRejection;
  const { identity, payload, ordering } = eventData;
  if (!payload.workflowRunId || !payload.nodeExecutionId) {
    return rejectGate("not_workflow_message_event");
  }
  const sessionId = text(identity.sessionId);
  if (!sessionId) return rejectGate("missing_session");
  const currentSession = registry.sessions[sessionId] || createEmptySession(sessionId);
  const eventId = text(identity.eventId);
  const projectionEventName = text(payload.eventType);
  if (!hasCompleteEventIdentity({ eventData, eventId, projectionEventName, ordering })) {
    return rejectGate("invalid_authoritative_message_event");
  }
  if (currentSession.eventsById?.[eventId]) {
    return rejectGate("duplicate", currentSession);
  }
  const sequenceIdentity = {
    sequenceKey: ordering.scopeId,
    sequence: Number(ordering.sequence),
  };
  const monotonicityRejection = evaluateSequenceMonotonicity({
    currentSession,
    sequenceKey: sequenceIdentity.sequenceKey,
    sequence: sequenceIdentity.sequence,
  });
  if (monotonicityRejection) return monotonicityRejection;
  return {
    ok: true,
    sessionId,
    eventId,
    projectionEventName,
    currentSession,
    sequenceIdentity,
    sequenceDomain: text(ordering.domain),
  };
}

function sameMessageId(message = {}, targetId) {
  return text(message?.messageId || message?.id) === targetId;
}

export function findSubSessionMessageIndex(messages, targetId) {
  if (!targetId) return -1;
  return messages.findIndex((message = {}) => sameMessageId(message, targetId));
}

export function materializeTurnPresentationMessages({
  messages,
  turnPresentation,
  sessionId,
  occurredAt,
}) {
  for (const source of [turnPresentation?.userMessage, turnPresentation?.assistantMessage]) {
    if (!source) continue;
    const sourceId = text(source.messageId || source.id);
    const sourceIndex = findSubSessionMessageIndex(messages, sourceId);
    const materialized = {
      ...source,
      id: sourceId,
      messageId: sourceId,
      sessionId,
      createdAt: source.createdAt || source.ts || occurredAt,
    };
    if (sourceIndex >= 0) messages[sourceIndex] = { ...messages[sourceIndex], ...materialized };
    else messages.push(materialized);
  }
}

export function applySubSessionMessageIdentity({
  targetMessage,
  messageKey,
  identity,
  payload,
  occurredAt,
}) {
  targetMessage.sessionId = text(targetMessage.sessionId || identity.sessionId);
  targetMessage.parentSessionId = text(targetMessage.parentSessionId || payload.parentSessionId);
  targetMessage.dialogProcessId = text(targetMessage.dialogProcessId || payload.dialogProcessId);
  targetMessage.turnScopeId = text(targetMessage.turnScopeId || identity.turnScopeId);
  targetMessage.presentationMessageId = messageKey;
  targetMessage.sourceMessageId = text(targetMessage.sourceMessageId || identity.messageId);
  targetMessage.createdAt = targetMessage.createdAt || occurredAt;
  if (typeof targetMessage.pending !== "boolean") targetMessage.pending = true;
  if (!targetMessage.messageId) targetMessage.messageId = messageKey;
  if (!targetMessage.id) targetMessage.id = messageKey;
}

export function applySubSessionMessageOrdering({
  targetMessage,
  eventId,
  ordering,
  payload,
  sequenceDomain,
  occurredAt,
}) {
  targetMessage.updatedAt = occurredAt;
  targetMessage.eventId = eventId;
  targetMessage.sequence = Number(ordering.sequence);
  targetMessage.sequenceDomain = sequenceDomain;
  targetMessage.sequenceScopeId = text(ordering.scopeId);
  targetMessage.firstSequence = Number(targetMessage.firstSequence || ordering.sequence);
  targetMessage.workflowRunId = text(payload.workflowRunId || targetMessage.workflowRunId);
  targetMessage.nodeExecutionId = text(payload.nodeExecutionId || targetMessage.nodeExecutionId);
}

export function buildNextSubSessionState({
  currentSession,
  sessionId,
  identity,
  payload,
  ordering,
  eventId,
  eventData,
  messages,
  sequenceIdentity,
  sequenceDomain,
  occurredAt,
}) {
  const scopeKey = sequenceIdentity.sequenceKey;
  return {
    ...currentSession,
    sessionId,
    id: sessionId,
    parentSessionId: text(payload.parentSessionId || currentSession.parentSessionId),
    dialogProcessId: text(payload.dialogProcessId || currentSession.dialogProcessId),
    turnScopeId: text(identity.turnScopeId || currentSession.turnScopeId),
    workflowRunId: text(payload.workflowRunId || currentSession.workflowRunId),
    nodeExecutionId: text(payload.nodeExecutionId || currentSession.nodeExecutionId),
    messages,
    eventsById: {
      ...(currentSession.eventsById || {}),
      ...(eventId ? { [eventId]: eventData } : {}),
    },
    sequence: maxNumber(currentSession.sequence, ordering.sequence),
    sequenceDomain,
    sequenceByScopeKey: {
      ...(currentSession.sequenceByScopeKey || {}),
      [scopeKey]: maxNumber(currentSession.sequenceByScopeKey?.[scopeKey], ordering.sequence),
    },
    sequenceByDomain: {
      ...(currentSession.sequenceByDomain || {}),
      [MESSAGE_EVENT_SEQUENCE_DOMAIN]: maxNumber(
        currentSession.sequenceByDomain?.[MESSAGE_EVENT_SEQUENCE_DOMAIN],
        ordering.sequence,
      ),
    },
    revision: maxNumber(currentSession.revision, ordering.revision),
    revisionByDomain: {
      ...(currentSession.revisionByDomain || {}),
      [MESSAGE_EVENT_SEQUENCE_DOMAIN]: maxNumber(
        currentSession.revisionByDomain?.[MESSAGE_EVENT_SEQUENCE_DOMAIN],
        ordering.revision,
      ),
    },
    updatedAt: occurredAt,
  };
}
