/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createMessageEventState } from "../model/messageEventState.js";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  isTransientMessageEvent,
  resolveMessageViewKey,
} from "@noobot/event-protocol/message-event";

function rejectGate(reason, current = null) {
  return current ? { ok: false, reason, current } : { ok: false, reason };
}

function evaluateSequenceMonotonicity({ currentSession, sequenceKey, sequence }) {
  const appliedSequence = currentSession.sequenceByScopeKey[sequenceKey] ?? 0;
  if (appliedSequence === sequence) return rejectGate("duplicate_sequence", currentSession);
  if (sequence < appliedSequence) return rejectGate("stale", currentSession);
  return null;
}

export function evaluateSubSessionEventGate({ eventData, registry, createEmptySession }) {
  const { identity, payload, ordering } = eventData;
  if (!payload.workflowRunId || !payload.nodeExecutionId) {
    return rejectGate("not_workflow_message_event");
  }
  const { sessionId, eventId } = identity;
  const currentSession = registry.sessions[sessionId] || createEmptySession(sessionId);
  if (currentSession.eventsById[eventId]) return rejectGate("duplicate", currentSession);
  const transient = isTransientMessageEvent(eventData);
  if (!transient) {
    const monotonicityRejection = evaluateSequenceMonotonicity({
      currentSession,
      sequenceKey: ordering.scopeId,
      sequence: ordering.sequence,
    });
    if (monotonicityRejection) return monotonicityRejection;
  }
  return { ok: true, currentSession, transient };
}

export function findSubSessionMessageIndex(messages, viewKey) {
  if (!viewKey) return -1;
  return messages.findIndex((message = {}) => resolveMessageViewKey(message) === viewKey);
}

export function materializeTurnPresentationMessages({ messages, turnPresentation }) {
  for (const source of [turnPresentation.userMessage, turnPresentation.assistantMessage]) {
    const sourceIndex = findSubSessionMessageIndex(messages, resolveMessageViewKey(source));
    if (sourceIndex >= 0) messages[sourceIndex] = { ...messages[sourceIndex], ...source };
    else messages.push({ ...source, messageEventState: createMessageEventState() });
  }
}

export function applySubSessionMessageIdentity({ targetMessage, envelope }) {
  const { identity, payload } = envelope;
  targetMessage.parentSessionId = payload.parentSessionId;
  targetMessage.dialogProcessId = payload.dialogProcessId;
  targetMessage.turnScopeId = identity.turnScopeId;
  targetMessage.presentationMessageId = payload.presentationMessageId;
}

export function applySubSessionMessageOrdering({ targetMessage, envelope }) {
  const { identity, ordering, payload, occurredAt } = envelope;
  targetMessage.updatedAt = occurredAt;
  targetMessage.eventId = identity.eventId;
  targetMessage.sequence = ordering.sequence;
  targetMessage.sequenceDomain = MESSAGE_EVENT_SEQUENCE_DOMAIN;
  targetMessage.sequenceScopeId = ordering.scopeId;
  targetMessage.firstSequence ??= ordering.sequence;
  targetMessage.workflowRunId = payload.workflowRunId;
  targetMessage.nodeExecutionId = payload.nodeExecutionId;
}

export function buildNextSubSessionState({ currentSession, envelope, messages, transient }) {
  const { identity, ordering, payload, occurredAt } = envelope;
  if (transient) return { ...currentSession, messages, updatedAt: occurredAt };
  return {
    ...currentSession,
    parentSessionId: payload.parentSessionId,
    dialogProcessId: payload.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    workflowRunId: payload.workflowRunId,
    nodeExecutionId: payload.nodeExecutionId,
    messages,
    eventsById: { ...currentSession.eventsById, [identity.eventId]: envelope },
    sequenceByScopeKey: {
      ...currentSession.sequenceByScopeKey,
      [ordering.scopeId]: ordering.sequence,
    },
    updatedAt: occurredAt,
  };
}
