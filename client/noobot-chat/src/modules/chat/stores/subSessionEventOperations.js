/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MESSAGE_EVENT_TYPE, projectTurnPresentation } from "@noobot/event-protocol/message-event";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  dispatchTurnEnvelope,
  TURN_PROJECTION_SOURCE,
} from "../runtime/engine/turnProjectionStore.js";
import {
  applySubSessionMessageIdentity,
  applySubSessionMessageOrdering,
  buildNextSubSessionState,
  evaluateSubSessionEventGate,
  findSubSessionMessageIndex,
  materializeTurnPresentationMessages,
} from "./subSessionEventProjection.js";
import { createSubSessionSnapshotReducer } from "./subSessionSnapshotReducer.js";
import { createEmptySubSession } from "./subSessionRegistry.js";

export function createSubSessionEventOperations({
  subSessionMessageRegistry,
  subSessionMessageRegistryVersion,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
}) {
  function upsertSubSessionEvent(envelope) {
    const registry = subSessionMessageRegistry.value;
    const gate = evaluateSubSessionEventGate({
      eventData: envelope,
      registry,
      createEmptySession: createEmptySubSession,
    });
    if (!gate.ok) {
      return {
        applied: false,
        reason: gate.reason,
        ...(gate.errors ? { errors: gate.errors } : {}),
        ...(gate.current ? { current: gate.current } : {}),
      };
    }
    const { identity, payload, occurredAt } = envelope;
    const { currentSession, transient } = gate;
    const messages = [...currentSession.messages];
    if (payload.eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
      materializeTurnPresentationMessages({
        messages,
        turnPresentation: projectTurnPresentation(payload),
        sessionId: identity.sessionId,
        occurredAt,
      });
    }
    const existingIndex = findSubSessionMessageIndex(messages, payload.presentationMessageId);
    if (existingIndex < 0) return { applied: false, reason: "presentation_target_missing" };
    const targetMessage = messages[existingIndex];
    applySubSessionMessageIdentity({ targetMessage, envelope });
    const reduction = dispatchTurnEnvelope({
      targetMessage,
      envelope,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
    });
    if (!reduction.applied) {
      return {
        applied: false,
        reason: reduction.result,
        errors: reduction.errors,
        current: currentSession,
        message: targetMessage,
      };
    }
    if (!transient) applySubSessionMessageOrdering({ targetMessage, envelope });
    const nextSession = buildNextSubSessionState({
      currentSession,
      envelope,
      messages,
      transient,
    });
    registry.sessions[identity.sessionId] = nextSession;
    subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
    subSessionMessageRegistryVersion.value += 1;
    logWorkflowDiagnostics("frontend.workflowSubSession.registryCommitted", () => ({
      sessionId: payload.parentSessionId,
      nodeSessionId: identity.sessionId,
      dialogProcessId: payload.dialogProcessId,
      turnScopeId: identity.turnScopeId,
      workflowRunId: payload.workflowRunId,
      nodeExecutionId: payload.nodeExecutionId,
      eventId: identity.eventId,
      presentationMessageId: payload.presentationMessageId,
      eventType: payload.eventType,
      contentLength: targetMessage.content?.length,
      messageCount: messages.length,
      subSessionMessageRegistryVersion: subSessionMessageRegistryVersion.value,
    }));
    return { applied: true, session: nextSession, message: targetMessage };
  }

  const reduceSubSessionSnapshot = createSubSessionSnapshotReducer({
    subSessionMessageRegistry,
    subSessionMessageRegistryVersion,
    applyTurnLifecycleSnapshot,
    applyTurnTimingSnapshot,
  });

  return { upsertSubSessionEvent, reduceSubSessionSnapshot };
}
