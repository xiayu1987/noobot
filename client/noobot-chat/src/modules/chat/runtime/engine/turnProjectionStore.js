/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reduceMessageEvent, MESSAGE_EVENT_REDUCE_RESULT } from "./messageEventReducer.js";
import { createTurnKey, messageOwnsTurn, resolveTurnIdentity } from "./turnIdentity.js";
import { createTurnObservation } from "./turnObservation.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import {
  resolveSessionRunMessageRuntimePatch,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
} from "../sessionRunStateMachine.js";
import {
  selectTurnMessageRuntime,
  sessionRuntimeId,
} from "../run-state-machine/turnRuntimeRegistry.js";
import { getMessageTurnScopeId, getMessageDialogProcessId } from "../../model/messageIdentity.js";
import {
  applyRunStateMessagePatch,
  summarizeMessageRuntimeProjection,
} from "./messageRuntimePatch.js";

export const TURN_PROJECTION_SOURCE = Object.freeze({
  NORMAL_LIVE: "normal_live",
  RECONNECT_LIVE: "reconnect_live",
  HISTORY_REPLAY: "history_replay",
  SNAPSHOT: "snapshot",
});

export function projectTurnRuntimeToMessages({
  session = null,
  sessions = null,
  activeSession = null,
  turnRuntimeRegistry = null,
  turn = null,
  stateSnapshot = null,
} = {}) {
  const registry = turnRuntimeRegistry?.value || turnRuntimeRegistry;
  const resolvedState =
    stateSnapshot ||
    selectTurnMessageRuntime(registry, {
      sessionId: turn?.sessionId,
      turnScopeId: turn?.turnScopeId,
      dialogProcessId: turn?.dialogProcessId,
    });
  if (!resolvedState) {
    return { applied: false, patchedMessageCount: 0, reason: "turn_identity_conflict" };
  }
  const sessionItems = Array.isArray(sessions?.value)
    ? sessions.value
    : Array.isArray(sessions)
      ? sessions
      : [];
  const activeSessionValue = activeSession?.value || activeSession;
  const targetSession =
    session ||
    sessionItems.find((item) => sessionRuntimeId(item) === resolvedState.sessionId) ||
    (sessionRuntimeId(activeSessionValue) === resolvedState.sessionId ? activeSessionValue : null);
  if (!targetSession) {
    return {
      applied: false,
      patchedMessageCount: 0,
      reason: "session_not_found",
      stateSnapshot: resolvedState,
    };
  }
  const messages = Array.isArray(targetSession.messages) ? targetSession.messages : [];
  if (!messages.length) {
    return { applied: false, patchedMessageCount: 0, reason: "session_has_no_messages" };
  }
  let patchedMessageCount = 0;
  let matchedMessageCount = 0;
  messages.forEach((message) => {
    const sameTurn =
      resolvedState.turnScopeId && getMessageTurnScopeId(message) === resolvedState.turnScopeId;
    const sameDialog =
      resolvedState.dialogProcessId &&
      getMessageDialogProcessId(message) === resolvedState.dialogProcessId;
    if (resolvedState.turnScopeId ? !sameTurn : !sameDialog) return;
    matchedMessageCount += 1;
    const effect = resolveSessionRunMessageRuntimePatch({
      stateSnapshot: resolvedState,
      messageItem: message,
      activeSession: targetSession,
    });
    summarizeMessageRuntimeProjection({ message, stateSnapshot: resolvedState, effect });
    if (effect?.action === SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE) {
      applyRunStateMessagePatch(message, effect.patch);
      patchedMessageCount += 1;
    }
  });
  return {
    applied: patchedMessageCount > 0,
    patchedMessageCount,
    matchedMessageCount,
    reason:
      patchedMessageCount > 0
        ? "message_runtime_projected"
        : matchedMessageCount > 0
          ? "matching_message_requires_no_patch"
          : "message_identity_not_found",
  };
}

export function dispatchTurnEnvelope({ targetMessage, envelope, source }) {
  const reducerObservedAtMs = Date.now();
  const eventTimestamp = envelope.occurredAt;
  const eventTimestampMs = Date.parse(eventTimestamp);
  const identity = resolveTurnIdentity(envelope);
  const turnKey = createTurnKey(identity);
  const observe = (values = {}) => {
    const observation = createTurnObservation({
      requestedSessionId: identity.sessionId,
      canonicalSessionId: identity.sessionId,
      turnKey,
      eventId: envelope.identity.eventId,
      sequence: envelope.ordering.sequence,
      source,
      authority: "authoritative",
      ...values,
    });
    logThinkingReplayDebug("frontend.turnProjection.envelopeObserved", () => ({
      sessionId: identity.sessionId,
      dialogProcessId: identity.dialogProcessId,
      turnScopeId: identity.turnScopeId,
      source,
      eventId: envelope.identity.eventId,
      eventType: envelope.payload.eventType,
      presentationMessageId: envelope.payload.presentationMessageId,
      protocolFamily: envelope.protocol.family,
      protocolVersion: envelope.protocol.version,
      sequence: envelope.ordering.sequence,
      sequenceDomain: envelope.ordering.domain,
      sequenceScopeId: envelope.ordering.scopeId,
      authority: "authoritative",
      eventTimestamp,
      reducerObservedAt: new Date(reducerObservedAtMs).toISOString(),
      sourceToReducerLatencyMs: Number.isFinite(eventTimestampMs)
        ? Math.max(0, reducerObservedAtMs - eventTimestampMs)
        : null,
      result: String(observation.result || ""),
      reason: String(observation.reason || ""),
      applied: observation.applied === true,
      activityTimelineCount: Array.isArray(targetMessage?.activityTimeline)
        ? targetMessage.activityTimeline.length
        : 0,
      activityEventIds: (targetMessage?.activityTimeline || [])
        .slice(-16)
        .map((activity = {}) => String(activity.eventId || "")),
      toolTimelineCount: Array.isArray(targetMessage?.toolTimeline)
        ? targetMessage.toolTimeline.length
        : 0,
    }));
    return observation;
  };
  if (!messageOwnsTurn(targetMessage, identity)) {
    return observe({
      result: MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT,
      errors: ["turn_identity_conflict"],
      reason: "turn_identity_conflict",
    });
  }
  const state = targetMessage.messageEventState;
  const { sequence } = envelope.ordering;
  const { lastSequence } = state;
  if (lastSequence && sequence > lastSequence + 1) {
    state.pendingEnvelopes[sequence] = envelope;
    return observe({
      result: MESSAGE_EVENT_REDUCE_RESULT.SEQUENCE_GAP,
      applied: false,
      reason: "sequence_gap",
      expectedSequence: lastSequence + 1,
      receivedSequence: sequence,
    });
  }
  const reduced = reduceMessageEvent({ targetMessage, state, event: envelope });
  if (reduced.applied) {
    while (state.pendingEnvelopes[state.lastSequence + 1]) {
      const nextSequence = state.lastSequence + 1;
      const pendingEnvelope = state.pendingEnvelopes[nextSequence];
      delete state.pendingEnvelopes[nextSequence];
      reduceMessageEvent({ targetMessage, state, event: pendingEnvelope });
    }
  }
  return observe({
    ...reduced,
    reason: reduced.result,
  });
}
