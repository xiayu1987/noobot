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
import { isPlainObject, isFunction } from "@noobot/shared/value";

function committedDispatchContext(eventName, eventData) {
  const validation = validateSessionPersistenceScope(eventData.persistenceScope);
  if (!validation.valid) {
    throw new TypeError(`invalid ${eventName} persistenceScope: ${validation.errors.join(",")}`);
  }
  return { persistenceScope: validation.scope };
}

function auditEnvelopeIdentity(canonicalEnvelope, eventData) {
  if (!canonicalEnvelope) {
    return {
      sessionId: eventData.sessionId,
      dialogProcessId: eventData.dialogProcessId,
      turnScopeId: eventData.turnScopeId,
    };
  }
  const { protocol, identity, payload } = canonicalEnvelope;
  return {
    protocolName: protocol.name,
    protocolVersion: protocol.version,
    eventFamily: protocol.family,
    schemaVersion: protocol.schemaVersion,
    eventType: identity.eventType,
    payloadEventType: payload.eventType,
    sessionId: identity.sessionId,
    dialogProcessId: payload.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    presentationMessageId: payload.presentationMessageId,
    eventId: identity.eventId,
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
      nodeExecutionId: identity.executionId,
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
  getCurrentRunMeta,
  onRootRunning,
}) {
  if (
    eventName === AGENT_RUN_EVENT.LIFECYCLE_STATE_CHANGED &&
    eventData.state === "running" &&
    !childRunEvent
  ) {
    const eventSessionId = eventData.sessionId;
    const eventTurnScopeId = eventData.turnScopeId;
    if (
      eventSessionId === sessionId &&
      eventTurnScopeId &&
      eventTurnScopeId === getCurrentRunMeta()?.turnScopeId &&
      isFunction(onRootRunning)
    ) {
      onRootRunning(eventData);
    }
  }
}

export function createRunEventListener({
  sendEvent,
  sessionId,
  getCurrentRunMeta = () => null,
  onRootRunning = null,
  onCommittedTurnLifecycle = null,
  onAuthorityEventCommitted = null,
  onEventReceived = null,
  onDeliveryTiming = null,
} = {}) {
  if (onDeliveryTiming !== null && !isFunction(onDeliveryTiming)) {
    throw new TypeError("onDeliveryTiming must be a function when provided");
  }

  return {
    ...(onDeliveryTiming === null ? {} : { onDeliveryTiming }),
    onEvent: (eventPayload) => {
      const eventName = eventPayload?.event;
      if (!AGENT_RUN_EVENTS.has(eventName)) {
        throw new Error(`unsupported agent run event: ${eventName || "missing"}`);
      }
      const eventData = eventPayload.data;
      if (!isPlainObject(eventData)) {
        throw new TypeError(`invalid ${eventName} data: expected an object`);
      }
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
        getCurrentRunMeta,
        onRootRunning,
      });

      return;
    },
  };
}
