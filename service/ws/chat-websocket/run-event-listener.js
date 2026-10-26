/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_RUN_EVENT,
  AGENT_RUN_EVENTS,
  asEventProtocolEnvelope,
  validateProtocolEvent,
} from "#agent/event";
import { isChildRunEventData } from "./child-run-events.js";
import {
  TURN_COMMITTED_WIRE_EVENT,
  assertTurnCommittedEventData,
} from "@noobot/session-protocol/turn-commit";
import {
  TURN_ATTACHMENTS_BOUND_WIRE_EVENT,
  assertTurnAttachmentsBoundEventData,
} from "@noobot/session-protocol/turn-attachment-bind";
import {
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_RUNTIME_FAMILY,
} from "@noobot/event-protocol/workflow-runtime-event";
import { validateSessionPersistenceScope } from "@noobot/session-protocol";
import { text, isFunction } from "@noobot/shared/value";

function committedDispatchContext(eventName, eventData) {
  const validation = validateSessionPersistenceScope(eventData.persistenceScope);
  if (!validation.valid) {
    throw new TypeError(`invalid ${eventName} persistenceScope: ${validation.errors.join(",")}`);
  }
  return { persistenceScope: validation.scope };
}

function trimmedText(value) {
  return text(value);
}

function countOf(value) {
  return Number(value || 0);
}

function auditEnvelopeIdentity(canonicalEnvelope, eventData) {
  const protocol = canonicalEnvelope?.protocol;
  const identity = canonicalEnvelope ? canonicalEnvelope.identity : eventData;
  const payload = canonicalEnvelope ? canonicalEnvelope.payload : eventData;
  return {
    protocolName: trimmedText(protocol?.name),
    protocolVersion: countOf(protocol?.version),
    eventFamily: trimmedText(protocol?.family),
    schemaVersion: countOf(protocol?.schemaVersion),
    eventType: trimmedText(identity?.eventType),
    payloadEventType: trimmedText(payload?.eventType),
    sessionId: trimmedText(identity?.sessionId),
    dialogProcessId: trimmedText(payload?.dialogProcessId),
    turnScopeId: trimmedText(identity?.turnScopeId),
    presentationMessageId: trimmedText(payload?.presentationMessageId),
    eventId: trimmedText(identity?.eventId),
  };
}

function auditWorkflowRuntime(canonicalEnvelope) {
  if (canonicalEnvelope?.protocol.family !== WORKFLOW_RUNTIME_FAMILY) return {};
  const { identity, ordering, payload } = canonicalEnvelope;
  const audit = { workflowRunId: payload.workflowRunId };
  if (identity.eventType === WORKFLOW_RUNTIME_EVENT.PLANNING) {
    return {
      ...audit,
      nodeSessionCount: payload.workflowPayload.nodeSessions.length,
      sourceMessage: payload.sourceMessage,
    };
  }
  if (identity.eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE) {
    return {
      ...audit,
      workflowRevision: ordering.revision,
      nodeExecutionId: payload.nodeExecutionId,
      workflowStatus: payload.status,
    };
  }
  return audit;
}

function auditOrdering(canonicalEnvelope) {
  if (!canonicalEnvelope) return {};
  const { ordering } = canonicalEnvelope;
  return {
    sequence: ordering.sequence,
    sequenceDomain: ordering.domain,
    sequenceScopeId: ordering.scopeId,
  };
}

function buildEventAudit(eventName, eventData) {
  const canonicalEnvelope = asEventProtocolEnvelope(eventData?.envelope);
  return {
    eventName,
    ...auditEnvelopeIdentity(canonicalEnvelope, eventData),
    ...auditWorkflowRuntime(canonicalEnvelope),
    ...auditOrdering(canonicalEnvelope),
    dataKeys: Object.keys(eventData).sort(),
  };
}

function syncRunState({
  eventName,
  eventData,
  childRunEvent,
  sessionId,
  resolveTurnScopeId,
  onRootRunning,
}) {
  if (
    eventName === AGENT_RUN_EVENT.LIFECYCLE_STATE_CHANGED &&
    text(eventData?.state).toLowerCase() === "running" &&
    !childRunEvent
  ) {
    const eventSessionId = text(eventData?.sessionId);
    const eventTurnScopeId = text(eventData?.turnScopeId);
    if (
      eventSessionId === text(sessionId) &&
      eventTurnScopeId &&
      eventTurnScopeId === resolveTurnScopeId() &&
      typeof onRootRunning === "function"
    ) {
      onRootRunning(eventData);
    }
  }
}

export function createRunEventListener({
  sendEvent,
  sessionId,
  getCurrentRunMeta = () => null,
  getCurrentTurnScopeId = () => "",
  onRootRunning = null,
  onCommittedTurnLifecycle = null,
  onAuthorityEventCommitted = null,
  onEventReceived = null,
  onDeliveryTiming = null,
} = {}) {
  const resolveTurnScopeId = () =>
    getCurrentRunMeta()?.turnScopeId || getCurrentTurnScopeId() || "";

  return {
    ...(typeof onDeliveryTiming === "function" ? { onDeliveryTiming } : {}),
    onEvent: (eventPayload) => {
      const eventName = text(eventPayload?.event);
      if (!AGENT_RUN_EVENTS.has(eventName)) {
        throw new Error(`unsupported agent run event: ${eventName || "missing"}`);
      }
      const eventData = eventPayload?.data || {};
      if (eventName === AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED) {
        const envelope = eventData.envelope;
        const validation = validateProtocolEvent(envelope);
        if (!validation.valid) {
          throw new TypeError(`invalid committed authority event: ${validation.errors.join(",")}`);
        }
        onEventReceived?.(buildEventAudit(eventName, eventData));
        if (!isFunction(onAuthorityEventCommitted)) {
          throw new Error("authority event dispatcher is required");
        }
        return onAuthorityEventCommitted(envelope, committedDispatchContext(eventName, eventData));
      }
      onEventReceived?.(buildEventAudit(eventName, eventData));
      if (eventName === AGENT_RUN_EVENT.TURN_LIFECYCLE_COMMITTED) {
        if (!isFunction(onCommittedTurnLifecycle)) {
          throw new Error("turn lifecycle dispatcher is required");
        }
        return onCommittedTurnLifecycle(
          eventData.envelope,
          committedDispatchContext(eventName, eventData),
        );
      }
      if (eventName === AGENT_RUN_EVENT.TURN_COMMITTED) {
        const committedTurn = assertTurnCommittedEventData(eventData);
        return sendEvent(TURN_COMMITTED_WIRE_EVENT, committedTurn);
      }
      if (eventName === AGENT_RUN_EVENT.TURN_ATTACHMENTS_BOUND) {
        const boundTurn = assertTurnAttachmentsBoundEventData(eventData);
        return sendEvent(TURN_ATTACHMENTS_BOUND_WIRE_EVENT, boundTurn);
      }
      const childRunEvent = isChildRunEventData(eventData, {
        rootSessionId: sessionId,
      });
      syncRunState({
        eventName,
        eventData,
        childRunEvent,
        sessionId,
        resolveTurnScopeId,
        onRootRunning,
      });

      return;
    },
  };
}
