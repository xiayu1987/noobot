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
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

const AUDIT_LIST_LIMIT = QUANTITY_THRESHOLDS.diagnostics.eventAuditListLimit;

function trimmedText(value) {
  return String(value || "").trim();
}

function countOf(value) {
  return Number(value || 0);
}

function boundedList(value, mapItem) {
  return Array.isArray(value) ? value.slice(0, AUDIT_LIST_LIMIT).map(mapItem) : [];
}

function auditActivity(activity = {}) {
  return {
    eventId: trimmedText(activity?.eventId),
    activityKind: trimmedText(activity?.activityKind),
    sequence: countOf(activity?.sequence),
    sequenceDomain: trimmedText(activity?.sequenceDomain),
    sequenceScopeId: trimmedText(activity?.sequenceScopeId),
    authority: trimmedText(activity?.authority),
  };
}

function auditMessage(message = {}) {
  return {
    messageUid: trimmedText(message?.messageUid),
    messageId: trimmedText(message?.messageId),
    presentationMessageId: trimmedText(message?.presentationMessageId),
    role: trimmedText(message?.role),
    type: trimmedText(message?.type),
    activityTimelineCount: countOf(message?.activityTimelineCount),
    activityTimeline: boundedList(message?.activityTimeline, auditActivity),
  };
}

function auditEnvelopeIdentity(canonicalEnvelope, eventData, sessionId, turnScopeId) {
  const protocol = canonicalEnvelope?.protocol;
  const identity = canonicalEnvelope?.identity || {};
  const payload = canonicalEnvelope?.payload || eventData;
  return {
    protocolName: trimmedText(protocol?.name),
    protocolVersion: countOf(protocol?.version),
    eventFamily: trimmedText(protocol?.family),
    schemaVersion: countOf(protocol?.schemaVersion),
    eventType: trimmedText(identity.eventType || eventData?.eventType),
    sessionId: trimmedText(identity.sessionId || eventData?.sessionId || sessionId),
    dialogProcessId: trimmedText(payload?.dialogProcessId),
    turnScopeId: trimmedText(identity.turnScopeId || eventData?.turnScopeId || turnScopeId),
    messageId: trimmedText(identity.messageId),
    presentationMessageId: trimmedText(payload?.presentationMessageId),
    eventId: trimmedText(identity.eventId),
  };
}

function auditMessageCounts(eventData) {
  return {
    messageCount: countOf(eventData?.messageCount),
    assistantCount: countOf(eventData?.assistantCount),
    toolCount: countOf(eventData?.toolCount),
    activityTimelineCount: countOf(eventData?.activityTimelineCount),
    messages: boundedList(eventData?.messages, auditMessage),
  };
}

function auditWorkflow(eventData) {
  const sourceMessage = eventData?.sourceMessage;
  return {
    workflowRunId: trimmedText(eventData?.workflowRunId),
    nodeExecutionId: trimmedText(eventData?.nodeExecutionId),
    workflowStatus: trimmedText(eventData?.status),
    workflowRevision: countOf(eventData?.revision),
    workflowSequence: countOf(eventData?.sequence),
    nodeSessionCount: Array.isArray(eventData?.nodeSessions) ? eventData.nodeSessions.length : 0,
    semanticTextLength: String(eventData?.semanticText || "").length,
    sourceMessage: sourceMessage && typeof sourceMessage === "object" ? sourceMessage : null,
  };
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function auditOrderingAndFlags(eventName, canonicalEnvelope, eventData) {
  const ordering = canonicalEnvelope?.ordering || {};
  return {
    sequence: countOf(ordering.sequence),
    sequenceDomain: trimmedText(ordering.domain),
    sequenceScopeId: trimmedText(ordering.scopeId),
    hasTool: Boolean(eventData?.tool),
    hasResult: eventData?.result !== undefined,
    agentTransportConsumption:
      eventName === "agent_transport_parameters_consumed" && isPlainRecord(eventData)
        ? eventData
        : null,
  };
}

function buildEventAudit(eventName, eventData, sessionId, turnScopeId) {
  const canonicalEnvelope = asEventProtocolEnvelope(eventData);
  return {
    eventName,
    ...auditEnvelopeIdentity(canonicalEnvelope, eventData, sessionId, turnScopeId),
    ...auditMessageCounts(eventData),
    ...auditWorkflow(eventData),
    ...auditOrderingAndFlags(eventName, canonicalEnvelope, eventData),
    dataKeys: Object.keys(eventData).sort(),
  };
}

function syncRunState({
  eventName,
  eventData,
  childRunEvent,
  sessionId,
  currentRunMeta,
  currentRunHandle,
  registerActiveRun,
  resolveTurnScopeId,
  onRootRunning,
}) {
  if (
    eventName === AGENT_RUN_EVENT.LIFECYCLE_STATE_CHANGED &&
    String(eventData?.state || "")
      .trim()
      .toLowerCase() === "running" &&
    !childRunEvent
  ) {
    const eventSessionId = String(eventData?.sessionId || "").trim();
    const eventTurnScopeId = String(eventData?.turnScopeId || "").trim();
    if (
      eventSessionId === String(sessionId || "").trim() &&
      eventTurnScopeId &&
      eventTurnScopeId === resolveTurnScopeId() &&
      typeof onRootRunning === "function"
    ) {
      onRootRunning(eventData);
    }
  }
  const eventDialogProcessId = String(eventData?.dialogProcessId || "").trim();
  if (eventDialogProcessId && currentRunMeta && !childRunEvent) {
    currentRunMeta.dialogProcessId = eventDialogProcessId;
    if (currentRunHandle) {
      currentRunHandle.dialogProcessId = eventDialogProcessId;
      registerActiveRun(currentRunHandle);
    }
  }
}

export function createRunEventListener({
  sendEvent,
  sessionId,
  registerActiveRun,
  getCurrentRunMeta = () => null,
  getCurrentRunHandle = () => null,
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
      const eventName = String(eventPayload?.event || "").trim();
      if (!AGENT_RUN_EVENTS.has(eventName)) {
        throw new Error(`unsupported agent run event: ${eventName || "missing"}`);
      }
      const eventData = eventPayload?.data || {};
      onEventReceived?.(buildEventAudit(eventName, eventData, sessionId, resolveTurnScopeId()));
      const currentRunMeta = getCurrentRunMeta();
      const currentRunHandle = getCurrentRunHandle();
      if (eventName === AGENT_RUN_EVENT.TURN_LIFECYCLE_COMMITTED) {
        if (typeof onCommittedTurnLifecycle === "function") {
          return onCommittedTurnLifecycle(eventData?.envelope || eventData, {
            persistenceScope: eventData?.persistenceScope || null,
          });
        }
        return;
      }
      if (eventName === AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED) {
        const envelope = eventData?.envelope;
        const validation = validateProtocolEvent(envelope);
        if (!validation.valid) {
          throw new TypeError(`invalid committed authority event: ${validation.errors.join(",")}`);
        }
        if (typeof onAuthorityEventCommitted !== "function") {
          throw new Error("authority event dispatcher is required");
        }
        return onAuthorityEventCommitted(envelope, {
          persistenceScope: eventData?.persistenceScope || null,
        });
      }
      if (eventName === AGENT_RUN_EVENT.TURN_COMMITTED) {
        const committedTurn = assertTurnCommittedEventData({
          ...eventData,
          sessionId: String(eventData?.sessionId || sessionId || "").trim(),
          turnScopeId: String(eventData?.turnScopeId || resolveTurnScopeId() || "").trim(),
        });
        return sendEvent(TURN_COMMITTED_WIRE_EVENT, committedTurn);
      }
      if (eventName === AGENT_RUN_EVENT.TURN_ATTACHMENTS_BOUND) {
        const boundTurn = assertTurnAttachmentsBoundEventData({
          ...eventData,
          sessionId: String(eventData?.sessionId || sessionId || "").trim(),
          turnScopeId: String(eventData?.turnScopeId || resolveTurnScopeId() || "").trim(),
        });
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
        currentRunMeta,
        currentRunHandle,
        registerActiveRun,
        resolveTurnScopeId,
        onRootRunning,
      });

      return;
    },
  };
}
