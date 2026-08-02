/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reduceMessageEvent, MESSAGE_EVENT_REDUCE_RESULT } from "./messageEventReducer.js";
import { createTurnKey, messageOwnsTurn, resolveTurnIdentity } from "./turnIdentity.js";
import {
  initializeMessageEventState,
  resolveMessageEventLaneState,
} from "../../model/messageEventState.js";
import { mergeToolTimelines } from "./toolTimeline.js";
import { mergeActivityTimelines } from "./activityTimeline.js";
import { createTurnObservation } from "./turnObservation.js";
import { mergeAttachmentSnapshot } from "../../model/dialogProcessChain.js";
import { validateMessageEventEnvelope } from "@noobot/shared/message-event-protocol";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import {
  resolveSessionRunMessageRuntimePatch,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
} from "../sessionRunStateMachine.js";
import { selectTurnMessageRuntime, sessionRuntimeId } from "../run-state-machine/turnRuntimeRegistry.js";
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
  const resolvedState = stateSnapshot || selectTurnMessageRuntime(registry, {
    sessionId: turn?.sessionId,
    turnScopeId: turn?.turnScopeId,
    dialogProcessId: turn?.dialogProcessId,
  });
  if (!resolvedState) {
    return { applied: false, patchedMessageCount: 0, reason: "turn_identity_conflict" };
  }
  const sessionItems = Array.isArray(sessions?.value) ? sessions.value : Array.isArray(sessions) ? sessions : [];
  const activeSessionValue = activeSession?.value || activeSession;
  const targetSession = session
    || sessionItems.find((item) => sessionRuntimeId(item) === resolvedState.sessionId)
    || ([activeSessionValue?.id, activeSessionValue?.backendSessionId]
      .map(sessionRuntimeId)
      .includes(resolvedState.sessionId)
      ? activeSessionValue
      : null);
  if (!targetSession) {
    return { applied: false, patchedMessageCount: 0, reason: "session_not_found", stateSnapshot: resolvedState };
  }
  const messages = Array.isArray(targetSession.messages) ? targetSession.messages : [];
  if (!messages.length) {
    return { applied: false, patchedMessageCount: 0, reason: "session_has_no_messages" };
  }
  let patchedMessageCount = 0;
  let matchedMessageCount = 0;
  messages.forEach((message) => {
    const sameTurn = resolvedState.turnScopeId
      && getMessageTurnScopeId(message) === resolvedState.turnScopeId;
    const sameDialog = resolvedState.dialogProcessId
      && getMessageDialogProcessId(message) === resolvedState.dialogProcessId;
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
    reason: patchedMessageCount > 0
      ? "message_runtime_projected"
      : matchedMessageCount > 0
        ? "matching_message_requires_no_patch"
        : "message_identity_not_found",
  };
}

const TURN_UI_SNAPSHOT_FIELDS = new Set([
  "thinkingOpenNames",
  "expandedToolDetailKeys",
  "selectedToolKey",
  "scrollTop",
  "animationKeys",
]);

export function dispatchTurnEnvelope({
  targetMessage,
  envelope,
  classifyRealtimeLog,
  source = TURN_PROJECTION_SOURCE.NORMAL_LIVE,
} = {}) {
  const reducerObservedAtMs = Date.now();
  const eventTimestamp = String(envelope?.timestamp || "");
  const eventTimestampMs = Date.parse(eventTimestamp);
  const identity = resolveTurnIdentity(envelope);
  const turnKey = createTurnKey(identity);
  const observe = (values = {}) => {
    const observation = createTurnObservation({
      requestedSessionId: identity.sessionId,
      canonicalSessionId: identity.sessionId,
      turnKey,
      eventId: envelope?.eventId,
      sequence: envelope?.sequence,
      source,
      authority: envelope?.authority,
      ...values,
    });
    logThinkingReplayDebug("frontend.turnProjection.envelopeObserved", () => ({
      sessionId: identity.sessionId,
      dialogProcessId: identity.dialogProcessId,
      turnScopeId: identity.turnScopeId,
      source,
      eventId: String(envelope?.eventId || ""),
      eventType: String(envelope?.eventType || ""),
      messageId: String(envelope?.messageId || ""),
      presentationMessageId: String(envelope?.presentationMessageId || envelope?.messageId || ""),
      envelopeKind: String(envelope?.envelopeKind || ""),
      envelopeVersion: Number(envelope?.envelopeVersion || 0),
      sequence: Number(envelope?.sequence || 0),
      sequenceDomain: String(envelope?.sequenceDomain || ""),
      sequenceScopeId: String(envelope?.sequenceScopeId || envelope?.messageId || ""),
      authority: String(envelope?.authority || ""),
      textLength: String(envelope?.text || "").length,
      outputLength: String(envelope?.output || "").length,
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
  if (!turnKey) {
    return observe({ result: MESSAGE_EVENT_REDUCE_RESULT.INVALID, errors: ["turn_identity_missing"], reason: "missing_turn_identity" });
  }
  const envelopeValidation = validateMessageEventEnvelope(envelope);
  if (!envelopeValidation.valid) {
    return observe({
      result: MESSAGE_EVENT_REDUCE_RESULT.INVALID,
      errors: envelopeValidation.errors,
      reason: "invalid_message_event_envelope",
    });
  }
  if (!targetMessage || !messageOwnsTurn(targetMessage, identity)) {
    return observe({
      result: targetMessage
        ? MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT
        : MESSAGE_EVENT_REDUCE_RESULT.TARGET_MISSING,
      errors: targetMessage ? ["turn_identity_conflict"] : [],
      source,
      reason: targetMessage ? "turn_identity_conflict" : "target_missing",
    });
  }
  const state = resolveMessageEventLaneState(targetMessage, envelope);
  const sequence = Number(envelope?.sequence || 0);
  const lastSequence = Number(state.lastSequence || 0);
  if (lastSequence && sequence > lastSequence + 1) {
    state.pendingEnvelopes = {
      ...(state.pendingEnvelopes || {}),
      [sequence]: envelope,
    };
    return observe({
      result: MESSAGE_EVENT_REDUCE_RESULT.SEQUENCE_GAP,
      applied: false,
      reason: "sequence_gap",
      expectedSequence: lastSequence + 1,
      receivedSequence: sequence,
    });
  }
  const reduced = reduceMessageEvent({ targetMessage, event: envelope, classifyRealtimeLog });
  if (reduced.applied) {
    let nextSequence = Number(state.lastSequence || 0) + 1;
    while (state.pendingEnvelopes?.[nextSequence]) {
      const pendingEnvelope = state.pendingEnvelopes[nextSequence];
      delete state.pendingEnvelopes[nextSequence];
      reduceMessageEvent({ targetMessage, event: pendingEnvelope, classifyRealtimeLog });
      nextSequence = Number(state.lastSequence || 0) + 1;
    }
    if (state.pendingEnvelopes && !Object.keys(state.pendingEnvelopes).length) {
      delete state.pendingEnvelopes;
    }
  }
  return observe({
    ...reduced,
    reason: reduced.result,
  });
}

export function hydrateTurnSnapshot({ targetMessage, snapshot, throughSequence = 0 } = {}) {
  const identity = resolveTurnIdentity(snapshot);
  const targetIdentity = resolveTurnIdentity(targetMessage);
  const legacyUnscopedSession = Boolean(
    identity.turnScopeId &&
    identity.turnScopeId === targetIdentity.turnScopeId &&
    !identity.sessionId &&
    !targetIdentity.sessionId,
  );
  const turnKey = createTurnKey(identity) || (legacyUnscopedSession ? `legacy::${identity.turnScopeId}` : "");
  const observe = (values = {}) => createTurnObservation({
    requestedSessionId: identity.sessionId,
    canonicalSessionId: targetIdentity.sessionId || identity.sessionId,
    turnKey,
    sequence: throughSequence || snapshot?.throughSequence,
    source: TURN_PROJECTION_SOURCE.SNAPSHOT,
    authority: snapshot?.authority,
    ...values,
  });
  if (!turnKey || !targetMessage || (!legacyUnscopedSession && !messageOwnsTurn(targetMessage, identity))) {
    return observe({ applied: false, result: "snapshot_identity_conflict", reason: "snapshot_identity_conflict" });
  }
  const currentSequence = Number(targetMessage?.messageEventState?.lastSequence || 0);
  const snapshotSequence = Number(throughSequence || snapshot?.throughSequence || 0);
  if (snapshotSequence < currentSequence) {
    return observe({ applied: false, result: "snapshot_stale", reason: "snapshot_stale", currentSequence, snapshotSequence });
  }
  const pendingEnvelopes = targetMessage?.messageEventState?.pendingEnvelopes || {};
  const currentToolTimeline = targetMessage?.toolTimeline || [];
  const currentActivityTimeline = targetMessage?.activityTimeline || [];
  const currentAttachments = Array.isArray(targetMessage?.attachments)
    ? targetMessage.attachments
    : [];
  const currentConsumedEventIds = targetMessage?.messageEventState?.consumedEventIds || [];
  const snapshotState = snapshot?.messageEventState || {};
  const preservedIdentity = {
    sessionId: targetMessage.sessionId,
    turnScopeId: targetMessage.turnScopeId,
  };
  Object.entries(snapshot || {}).forEach(([key, value]) => {
    if (!TURN_UI_SNAPSHOT_FIELDS.has(key)) targetMessage[key] = value;
  });
  Object.assign(targetMessage, preservedIdentity);
  if (Array.isArray(snapshot?.attachments)) {
    targetMessage.attachments = mergeAttachmentSnapshot(
      currentAttachments,
      snapshot.attachments,
    );
  }
  targetMessage.toolTimeline = mergeToolTimelines(
    snapshot?.toolTimeline,
    currentToolTimeline,
  );
  targetMessage.activityTimeline = mergeActivityTimelines(
    snapshot?.activityTimeline,
    currentActivityTimeline,
  );
  targetMessage.messageEventState = {
    ...snapshotState,
    lastSequence: Math.max(snapshotSequence, Number(snapshotState.lastSequence || 0)),
    consumedEventIds: [...new Set([
      ...(snapshotState.consumedEventIds || []),
      ...currentConsumedEventIds,
    ])].slice(-1000),
    ...(Object.keys(pendingEnvelopes).length ? { pendingEnvelopes } : {}),
  };
  let nextSequence = Number(targetMessage.messageEventState.lastSequence || 0) + 1;
  while (targetMessage.messageEventState.pendingEnvelopes?.[nextSequence]) {
    const pendingEnvelope = targetMessage.messageEventState.pendingEnvelopes[nextSequence];
    delete targetMessage.messageEventState.pendingEnvelopes[nextSequence];
    reduceMessageEvent({ targetMessage, event: pendingEnvelope });
    nextSequence = Number(targetMessage.messageEventState.lastSequence || 0) + 1;
  }
  if (
    targetMessage.messageEventState.pendingEnvelopes &&
    !Object.keys(targetMessage.messageEventState.pendingEnvelopes).length
  ) delete targetMessage.messageEventState.pendingEnvelopes;
  return observe({ applied: true, result: "snapshot_accepted", reason: "snapshot_accepted", currentSequence, snapshotSequence });
}
