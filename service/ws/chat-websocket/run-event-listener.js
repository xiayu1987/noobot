/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_RUN_EVENT, AGENT_RUN_EVENTS, validateProtocolEvent } from "#agent/event";
import { isChildRunEventData } from "./child-run-events.js";
import {
  TURN_COMMITTED_WIRE_EVENT,
  assertTurnCommittedEventData,
} from "@noobot/session-protocol/turn-commit";

function buildEventAudit(eventName, eventData, sessionId, turnScopeId) {
  const canonicalEnvelope = eventData?.protocol?.name === "@noobot/event-protocol" ? eventData : null;
  const identity = canonicalEnvelope?.identity || {};
  const ordering = canonicalEnvelope?.ordering || {};
  const payload = canonicalEnvelope?.payload || eventData;
  return {
    eventName,
    protocolName: String(canonicalEnvelope?.protocol?.name || "").trim(),
    protocolVersion: Number(canonicalEnvelope?.protocol?.version || 0),
    eventFamily: String(canonicalEnvelope?.protocol?.family || "").trim(),
    schemaVersion: Number(canonicalEnvelope?.protocol?.schemaVersion || 0),
    eventType: String(identity.eventType || eventData?.eventType || "").trim(),
    sessionId: String(identity.sessionId || eventData?.sessionId || sessionId || "").trim(),
    dialogProcessId: String(payload?.dialogProcessId || "").trim(),
    turnScopeId: String(identity.turnScopeId || eventData?.turnScopeId || turnScopeId || "").trim(),
    messageId: String(identity.messageId || "").trim(),
    presentationMessageId: String(payload?.presentationMessageId || "").trim(),
    eventId: String(identity.eventId || "").trim(),
    messageCount: Number(eventData?.messageCount || 0),
    assistantCount: Number(eventData?.assistantCount || 0),
    toolCount: Number(eventData?.toolCount || 0),
    activityTimelineCount: Number(eventData?.activityTimelineCount || 0),
    messages: Array.isArray(eventData?.messages)
      ? eventData.messages.slice(0, 64).map((message = {}) => ({
          messageUid: String(message?.messageUid || "").trim(),
          messageId: String(message?.messageId || "").trim(),
          presentationMessageId: String(message?.presentationMessageId || "").trim(),
          role: String(message?.role || "").trim(),
          type: String(message?.type || "").trim(),
          activityTimelineCount: Number(message?.activityTimelineCount || 0),
          activityTimeline: Array.isArray(message?.activityTimeline)
            ? message.activityTimeline.slice(0, 64).map((activity = {}) => ({
                eventId: String(activity?.eventId || "").trim(),
                activityKind: String(activity?.activityKind || "").trim(),
                sequence: Number(activity?.sequence || 0),
                sequenceDomain: String(activity?.sequenceDomain || "").trim(),
                sequenceScopeId: String(activity?.sequenceScopeId || "").trim(),
                authority: String(activity?.authority || "").trim(),
              }))
            : [],
        }))
      : [],
    workflowRunId: String(eventData?.workflowRunId || "").trim(),
    nodeExecutionId: String(eventData?.nodeExecutionId || "").trim(),
    workflowStatus: String(eventData?.status || "").trim(),
    workflowRevision: Number(eventData?.revision || 0),
    workflowSequence: Number(eventData?.sequence || 0),
    nodeSessionCount: Array.isArray(eventData?.nodeSessions) ? eventData.nodeSessions.length : 0,
    semanticTextLength: String(eventData?.semanticText || "").length,
    sourceMessage:
      eventData?.sourceMessage && typeof eventData.sourceMessage === "object"
        ? eventData.sourceMessage
        : null,
    sequence: Number(ordering.sequence || 0),
    sequenceDomain: String(ordering.domain || "").trim(),
    sequenceScopeId: String(ordering.scopeId || "").trim(),
    hasTool: Boolean(eventData?.tool),
    hasResult: eventData?.result !== undefined,
    agentTransportConsumption:
      eventName === "agent_transport_parameters_consumed" &&
      eventData &&
      typeof eventData === "object" &&
      !Array.isArray(eventData)
        ? eventData
        : null,
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
} = {}) {
  const resolveTurnScopeId = () =>
    getCurrentRunMeta()?.turnScopeId || getCurrentTurnScopeId() || "";

  return {
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
      // Lifecycle state is local run coordination only. It must not be
      // projected as a websocket/domain event.
      return;
    },
  };
}
