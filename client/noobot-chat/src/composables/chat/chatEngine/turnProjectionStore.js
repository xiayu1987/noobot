/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reduceMessageEvent, MESSAGE_EVENT_REDUCE_RESULT } from "./messageEventReducer";
import { createTurnKey, messageOwnsTurn, resolveTurnIdentity } from "./turnIdentity";
import {
  initializeMessageEventState,
  resolveMessageEventLaneState,
  syncMessageEventAggregateState,
} from "../../infra/messageEventState";
import { mergeToolTimelines } from "./toolTimeline";
import { mergeActivityTimelines } from "./activityTimeline";
import { createTurnObservation } from "./turnObservation";
import { mergeAttachmentSnapshot } from "../../infra/dialogProcessChain";

export const TURN_PROJECTION_SOURCE = Object.freeze({
  NORMAL_LIVE: "normal_live",
  RECONNECT_LIVE: "reconnect_live",
  HISTORY_REPLAY: "history_replay",
  SNAPSHOT: "snapshot",
});

// Ephemeral panel state belongs exclusively to turnUiStore and must never be
// persisted into, or restored from, a domain snapshot.
const TURN_UI_SNAPSHOT_FIELDS = new Set([
  "thinkingOpenNames",
  "expandedDetailLogKeys",
  "selectedToolKey",
  "scrollTop",
  "animationKeys",
]);

/**
 * Canonical write boundary for a turn projection. Transport sources are
 * observational only: they cannot alter ownership or reduction semantics.
 */
export function dispatchTurnEnvelope({
  targetMessage,
  envelope,
  classifyRealtimeLog,
  source = TURN_PROJECTION_SOURCE.NORMAL_LIVE,
} = {}) {
  const identity = resolveTurnIdentity(envelope);
  const turnKey = createTurnKey(identity);
  const observe = (values = {}) => createTurnObservation({
    requestedSessionId: identity.sessionId,
    canonicalSessionId: identity.sessionId,
    turnKey,
    eventId: envelope?.eventId,
    sequence: envelope?.sequence,
    source,
    authority: envelope?.authority,
    ...values,
  });
  if (!turnKey) {
    return observe({ result: MESSAGE_EVENT_REDUCE_RESULT.INVALID, errors: ["turn_identity_missing"], reason: "missing_turn_identity" });
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
    syncMessageEventAggregateState(targetMessage);
  }
  return observe({
    ...reduced,
    reason: reduced.result,
  });
}

/**
 * Versioned snapshot boundary. A snapshot older than the current event cursor
 * is observational and must never overwrite newer live facts.
 */
export function hydrateTurnSnapshot({ targetMessage, snapshot, throughSequence = 0 } = {}) {
  const identity = resolveTurnIdentity(snapshot);
  const targetIdentity = resolveTurnIdentity(targetMessage);
  const legacyUnscopedSession = Boolean(
    identity.turnScopeId &&
    identity.turnScopeId === targetIdentity.turnScopeId &&
    !identity.sessionId &&
    !targetIdentity.sessionId,
  );
  // Old persisted messages may predate sessionId on each message. This is an
  // isolated hydration compatibility boundary: ownership is still proven by
  // an exact Turn match and is never inferred from dialogProcessId.
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
  // A newer snapshot may close a previously observed sequence gap. Replay all
  // now-contiguous buffered envelopes through the same canonical reducer.
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
