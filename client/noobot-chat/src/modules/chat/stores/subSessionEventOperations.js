/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_EVENT_TYPE,
  projectTurnPresentation,
  resolveMessageEventPresentationId,
} from "@noobot/event-protocol/message-event";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  dispatchTurnEnvelope,
  TURN_PROJECTION_SOURCE,
} from "../runtime/engine/turnProjectionStore.js";
import {
  applySubSessionMessageIdentity,
  applySubSessionMessageOrdering,
  buildNextSubSessionState,
  compareMessageEventOrder,
  evaluateSubSessionEventGate,
  findSubSessionMessageIndex,
  materializeTurnPresentationMessages,
} from "./subSessionEventProjection.js";
import { createSubSessionSnapshotReducer } from "./subSessionSnapshotReducer.js";

function text(value) {
  return String(value || "").trim();
}

function eventTime(eventData = {}) {
  return eventData?.occurredAt || "";
}

function authoritativeSubSessionMessageId(eventData = {}) {
  return text(resolveMessageEventPresentationId(eventData?.payload));
}

export function createSubSessionMessageRegistry() {
  return { sessions: {} };
}

export function createSubSessionEventOperations({
  subSessionMessageRegistry,
  subSessionMessageRegistryVersion,
  applyTurnLifecycleSnapshot = null,
  applyTurnTimingSnapshot = null,
}) {
  function upsertSubSessionEvent(eventData = {}) {
    const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
    if (!registry.sessions) registry.sessions = {};
    const gate = evaluateSubSessionEventGate({
      eventData,
      registry,
      createEmptySession: (sessionId) => ({
        sessionId,
        messages: [],
        eventsById: {},
        sequence: 0,
      }),
    });
    if (!gate.ok) {
      return {
        applied: false,
        reason: gate.reason,
        ...(gate.errors ? { errors: gate.errors } : {}),
        ...(gate.current ? { current: gate.current } : {}),
      };
    }
    const { identity, payload, ordering } = eventData;
    const {
      sessionId,
      eventId,
      projectionEventName,
      currentSession,
      sequenceIdentity: incomingSequenceIdentity,
      sequenceDomain,
    } = gate;
    const messages = Array.isArray(currentSession.messages) ? [...currentSession.messages] : [];
    const incoming = eventData;
    const messageKey = authoritativeSubSessionMessageId(incoming);
    const turnPresentation = projectTurnPresentation(payload);
    if (projectionEventName === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
      materializeTurnPresentationMessages({
        messages,
        turnPresentation,
        sessionId,
        occurredAt: eventTime(eventData),
      });
    }
    const existingIndex = findSubSessionMessageIndex(messages, messageKey);
    const currentMessage = existingIndex >= 0 ? messages[existingIndex] : null;
    if (!currentMessage) return { applied: false, reason: "presentation_target_missing" };
    const nextMessage = currentMessage;
    applySubSessionMessageIdentity({
      targetMessage: nextMessage,
      messageKey,
      identity,
      payload,
      occurredAt: eventTime(eventData),
    });
    const reduction = dispatchTurnEnvelope({
      targetMessage: nextMessage,
      envelope: incoming,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
    });
    if (!reduction.applied) {
      return {
        applied: false,
        reason: reduction.result,
        errors: reduction.errors || [],
        current: currentSession,
        message: currentMessage,
      };
    }
    applySubSessionMessageOrdering({
      targetMessage: nextMessage,
      eventId,
      ordering,
      payload,
      sequenceDomain,
      occurredAt: eventTime(eventData),
    });
    if (existingIndex >= 0) messages[existingIndex] = nextMessage;
    else messages.push(nextMessage);
    messages.sort(compareMessageEventOrder);
    const nextSession = buildNextSubSessionState({
      currentSession,
      sessionId,
      identity,
      payload,
      ordering,
      eventId,
      eventData,
      messages,
      sequenceIdentity: incomingSequenceIdentity,
      sequenceDomain,
      occurredAt: eventTime(eventData),
    });
    registry.sessions[sessionId] = nextSession;
    subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
    if (subSessionMessageRegistryVersion) subSessionMessageRegistryVersion.value += 1;
    logWorkflowDiagnostics("frontend.workflowSubSession.registryCommitted", () => ({
      sessionId: text(payload.parentSessionId || sessionId),
      nodeSessionId: sessionId,
      dialogProcessId: text(payload.dialogProcessId),
      turnScopeId: text(identity.turnScopeId),
      workflowRunId: text(payload.workflowRunId),
      nodeExecutionId: text(payload.nodeExecutionId),
      eventId,
      messageId: messageKey,
      eventType: projectionEventName,
      contentLength: String(nextMessage?.content || "").length,
      messageCount: messages.length,
      subSessionMessageRegistryVersion: Number(subSessionMessageRegistryVersion?.value || 0),
    }));
    return { applied: true, session: nextSession, message: nextMessage };
  }

  const reduceSubSessionSnapshot = createSubSessionSnapshotReducer({
    subSessionMessageRegistry,
    subSessionMessageRegistryVersion,
    createEmptyRegistry: createSubSessionMessageRegistry,
    applyTurnLifecycleSnapshot,
    applyTurnTimingSnapshot,
  });

  return { upsertSubSessionEvent, reduceSubSessionSnapshot };
}
