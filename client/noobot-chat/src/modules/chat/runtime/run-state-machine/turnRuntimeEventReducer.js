/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_RUN_EVENT } from "./constants.js";
import { normalizeSessionRunEvent } from "./eventNormalization.js";
import { isFinalTurnState, reduceTurnRuntimeEvent } from "./turnReducer.js";
import {
  canonicalSessionId,
  canonicalTurnScopeId as turnKey,
  createTurnRuntimeRegistryState,
  ensureSessionBucket,
  executionTurnKey,
  findTurnByScope,
  isTurnRuntimeDeleted,
  resolveTurnRoute as resolveRoute,
  runtimeText as text,
} from "./turnRuntimeRegistryIdentity.js";
import { resolveSessionTurnRuntime } from "./turnRuntimeSelectors.js";

function resolveTurnRuntimeConflict({
  current,
  sessionId,
  event,
  route,
  turnScopeId,
  ignoresDialogRoute,
}) {
  if (!sessionId) return "missing_session_identity";
  if (current?.sessionId && current.sessionId !== sessionId) return "session_identity_conflict";
  if (
    !ignoresDialogRoute &&
    current?.dialogProcessId &&
    event.dialogProcessId &&
    current.dialogProcessId !== event.dialogProcessId
  ) {
    return "dialog_process_identity_conflict";
  }
  if (
    !ignoresDialogRoute &&
    route &&
    (route.turnScopeId !== turnScopeId || route.sessionId !== sessionId)
  ) {
    return "dialog_process_identity_conflict";
  }
  return "";
}

function createObservation({ registry, event, rawEvent, route, turnScopeId }) {
  return (values = {}) => {
    const canonicalId = text(values.turn?.sessionId || values.canonicalSessionId);
    return {
      registry,
      requestedSessionId: text(event.sessionId || route?.sessionId),
      canonicalSessionId: canonicalId,
      turnKey: executionTurnKey(canonicalId, turnScopeId),
      eventId: text(rawEvent.eventId || rawEvent.id),
      sequence: Number(event.seq || rawEvent.sequence || 0),
      source: text(event.source || rawEvent.source),
      authority: text(event.authority || rawEvent.authority || "none"),
      ...values,
    };
  };
}

function resolveProjectedStart(current, currentValue, event, rawEvent) {
  const observed = rawEvent.thinkingStartedAt || rawEvent.startedAt;
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    return observed || currentValue.startedAt;
  }
  if (rawEvent.canonicalTimingObserved === true) return observed || currentValue.startedAt;
  return currentValue.startedAt || observed || (!current ? event.updatedAt || event.timestamp : "");
}

function resolveProjectedFinish(currentValue, event, rawEvent, terminal) {
  if (!terminal) return currentValue.finishedAt;
  const observed = rawEvent.thinkingFinishedAt || rawEvent.finishedAt;
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    return observed || currentValue.finishedAt || event.updatedAt;
  }
  return currentValue.finishedAt || observed || event.updatedAt;
}

function resolveProjectedError(terminal, rawEvent) {
  if (terminal !== "error") return null;
  const rawError = rawEvent.error || {};
  return text(rawError.message || rawError || rawEvent.reason);
}

function projectTurn({ current, transition, event, rawEvent, sessionId, turnScopeId }) {
  const currentValue = current || {};
  const nowMs = Number(event.timestamp || Date.now());
  const terminal = transition.next.terminal;
  const startedAt = resolveProjectedStart(current, currentValue, event, rawEvent);
  const finishedAt = resolveProjectedFinish(currentValue, event, rawEvent, terminal);
  return {
    ...currentValue,
    ...transition.next,
    sessionId,
    parentSessionId: text(rawEvent.parentSessionId || currentValue.parentSessionId),
    turnScopeId,
    dialogProcessId: text(event.dialogProcessId || currentValue.dialogProcessId),
    action: transition.next.action,
    backendState: text(event.backendState || currentValue.backendState),
    state: transition.next.state,
    terminal,
    canStop: transition.next.canStop === true,
    seq: transition.next.seq,
    updatedAtMs: nowMs,
    updatedAt: text(event.updatedAt || currentValue.updatedAt),
    source: text(event.source || currentValue.source),
    sourceEvent: text(event.sourceEvent || event.type || currentValue.sourceEvent),
    authority: text(event.authority || currentValue.authority || "none"),
    finishedAtMs: terminal ? Number(currentValue.finishedAtMs || nowMs) : 0,
    startedAt: text(startedAt),
    finishedAt: text(finishedAt),
    error: resolveProjectedError(terminal, rawEvent),
    continuationSource: event.continuationSource || currentValue.continuationSource || null,
    continuedByTurnScopeId: text(
      event.continuedByTurnScopeId || currentValue.continuedByTurnScopeId,
    ),
  };
}

function commitProjectedTurn(registry, turn) {
  const bucket = ensureSessionBucket(registry, turn.sessionId);
  const sourceScope = turnKey(turn.continuationSource?.turnScopeId);
  if (sourceScope && sourceScope !== turn.turnScopeId) {
    const sourceTurn = bucket.turns[sourceScope];
    if (sourceTurn && sourceTurn.terminal === "user_stopped") {
      sourceTurn.continuedByTurnScopeId = turn.turnScopeId;
    }
  }
  bucket.turns[turn.turnScopeId] = turn;
  if (!turn.terminal) bucket.activeTurnScopeId = turn.turnScopeId;
  else if (turnKey(bucket.activeTurnScopeId) === turn.turnScopeId) bucket.activeTurnScopeId = "";
  if (turn.dialogProcessId) {
    registry.routeIndex[turn.dialogProcessId] = {
      sessionId: turn.sessionId,
      turnScopeId: turn.turnScopeId,
    };
  }
}

export function applyTurnRuntimeEvent(registry, rawEvent = {}) {
  const next = registry || createTurnRuntimeRegistryState();
  if (!next.sessions) next.sessions = {};
  if (!next.routeIndex) next.routeIndex = {};
  const event = normalizeSessionRunEvent(rawEvent);
  const route = resolveRoute(next, event.dialogProcessId);
  const turnScopeId = turnKey(event.turnScopeId || route?.turnScopeId);
  const observe = createObservation({ registry: next, event, rawEvent, route, turnScopeId });
  if (!turnScopeId) return observe({ turn: null, applied: false, reason: "missing_turn_identity" });
  const requestedSessionId = canonicalSessionId(text(event.sessionId || route?.sessionId));
  if (isTurnRuntimeDeleted(next, { sessionId: requestedSessionId, turnScopeId })) {
    return observe({
      turn: null,
      canonicalSessionId: requestedSessionId,
      applied: false,
      reason: "deleted_turn_tombstoned",
    });
  }
  const current = findTurnByScope(next, turnScopeId, { sessionId: requestedSessionId });
  const sessionId = text(requestedSessionId || current?.sessionId);
  const result = (values = {}) => observe({ canonicalSessionId: sessionId, ...values });
  const conflictReason = resolveTurnRuntimeConflict({
    current,
    sessionId,
    event,
    route,
    turnScopeId,
    ignoresDialogRoute: event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED,
  });
  if (conflictReason) return result({ turn: current, applied: false, reason: conflictReason });
  const activeScope = text(next.sessions[canonicalSessionId(sessionId)]?.activeTurnScopeId);
  const activeTurn = resolveSessionTurnRuntime(next, sessionId, activeScope);
  if (!current && activeTurn && !isFinalTurnState(activeTurn.state, activeTurn)) {
    return result({ turn: activeTurn, applied: false, reason: "active_turn_conflict" });
  }
  const transition = reduceTurnRuntimeEvent(current, rawEvent);
  if (!transition.applied)
    return result({ turn: current, applied: false, reason: transition.reason });
  const turn = projectTurn({ current, transition, event, rawEvent, sessionId, turnScopeId });
  commitProjectedTurn(next, turn);
  return result({ turn, applied: true, reason: transition.reason });
}
