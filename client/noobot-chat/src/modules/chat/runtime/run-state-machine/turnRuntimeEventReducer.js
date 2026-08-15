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

export function applyTurnRuntimeEvent(registry, rawEvent = {}) {
  const next = registry || createTurnRuntimeRegistryState();
  if (!next.sessions) next.sessions = {};
  if (!next.routeIndex) next.routeIndex = {};
  const event = normalizeSessionRunEvent(rawEvent);
  let turnScopeId = turnKey(event.turnScopeId);
  const route = resolveRoute(next, event.dialogProcessId);
  if (!turnScopeId && route) turnScopeId = turnKey(route.turnScopeId);
  const observation = (values = {}) => ({
    registry: next,
    requestedSessionId: text(event.sessionId || route?.sessionId),
    canonicalSessionId: text(values.turn?.sessionId || values.canonicalSessionId),
    turnKey: executionTurnKey(values.turn?.sessionId || values.canonicalSessionId, turnScopeId),
    eventId: text(rawEvent?.eventId || rawEvent?.id),
    sequence: Number(event.seq || rawEvent?.sequence || 0),
    source: text(event.source || rawEvent?.source),
    authority: text(event.authority || rawEvent?.authority || "none"),
    ...values,
  });
  if (!turnScopeId)
    return observation({ turn: null, applied: false, reason: "missing_turn_identity" });
  const rawRequestedSessionId = text(event.sessionId || route?.sessionId);
  const requestedSessionId = canonicalSessionId(rawRequestedSessionId);
  if (isTurnRuntimeDeleted(next, { sessionId: requestedSessionId, turnScopeId })) {
    return observation({
      turn: null,
      canonicalSessionId: requestedSessionId,
      applied: false,
      reason: "deleted_turn_tombstoned",
    });
  }
  const current = findTurnByScope(next, turnScopeId, { sessionId: requestedSessionId });
  const sessionId = text(requestedSessionId || current?.sessionId);
  const ignoresDialogRoute = event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED;
  const result = (values = {}) => observation({ canonicalSessionId: sessionId, ...values });
  const conflictReason = resolveTurnRuntimeConflict({
    current,
    sessionId,
    event,
    route,
    turnScopeId,
    ignoresDialogRoute,
  });
  if (conflictReason) return result({ turn: current, applied: false, reason: conflictReason });
  const activeTurnScopeId = text(
    next?.sessions?.[canonicalSessionId(sessionId)]?.activeTurnScopeId,
  );
  const activeTurn = resolveSessionTurnRuntime(next, sessionId, activeTurnScopeId);
  if (!current && activeTurn && !isFinalTurnState(activeTurn.state, activeTurn)) {
    return result({ turn: activeTurn, applied: false, reason: "active_turn_conflict" });
  }
  const transition = reduceTurnRuntimeEvent(current, rawEvent);
  if (!transition.applied) {
    return result({ turn: current, applied: false, reason: transition.reason });
  }
  const nowMs = Number(event.timestamp || Date.now());
  const terminal = transition.next.terminal;
  const backendState = text(event.backendState || current?.backendState);
  const turn = {
    ...(current || {}),
    ...transition.next,
    sessionId,
    parentSessionId: text(rawEvent?.parentSessionId || current?.parentSessionId),
    turnScopeId,
    dialogProcessId: text(event.dialogProcessId || current?.dialogProcessId),
    action: transition.next.action,
    backendState,
    state: transition.next.state,
    terminal,
    canStop: transition.next.canStop === true,
    seq: transition.next.seq,
    updatedAtMs: nowMs,
    updatedAt: text(event.updatedAt || current?.updatedAt),
    source: text(event.source || current?.source),
    sourceEvent: text(event.sourceEvent || event.type || current?.sourceEvent),
    authority: text(event.authority || current?.authority || "none"),
    finishedAtMs: terminal ? Number(current?.finishedAtMs || nowMs) : 0,
    startedAt: text(
      event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? rawEvent?.thinkingStartedAt || rawEvent?.startedAt || current?.startedAt
        : rawEvent?.canonicalTimingObserved === true
          ? rawEvent?.thinkingStartedAt || rawEvent?.startedAt || current?.startedAt
          : current?.startedAt ||
            rawEvent?.thinkingStartedAt ||
            rawEvent?.startedAt ||
            (!current ? event.updatedAt || event.timestamp : ""),
    ),
    finishedAt: terminal
      ? text(
          event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
            ? rawEvent?.thinkingFinishedAt ||
                rawEvent?.finishedAt ||
                current?.finishedAt ||
                event.updatedAt
            : current?.finishedAt ||
                rawEvent?.thinkingFinishedAt ||
                rawEvent?.finishedAt ||
                event.updatedAt,
        )
      : text(current?.finishedAt),
    error:
      terminal === "error"
        ? text(rawEvent?.error?.message || rawEvent?.error || rawEvent?.reason)
        : null,
    continuationSource: event.continuationSource || current?.continuationSource || null,
    continuedByTurnScopeId: text(event.continuedByTurnScopeId || current?.continuedByTurnScopeId),
  };
  const bucket = ensureSessionBucket(next, sessionId);
  const continuationSourceScope = turnKey(turn.continuationSource?.turnScopeId);
  if (continuationSourceScope && continuationSourceScope !== turnScopeId) {
    const sourceTurn = bucket.turns[continuationSourceScope];
    if (sourceTurn && sourceTurn.terminal === "user_stopped") {
      sourceTurn.continuedByTurnScopeId = turnScopeId;
    }
  }
  bucket.turns[turnScopeId] = turn;
  if (!terminal) {
    bucket.activeTurnScopeId = turnScopeId;
  } else if (turnKey(bucket.activeTurnScopeId) === turnScopeId) {
    bucket.activeTurnScopeId = "";
  }
  if (turn.dialogProcessId) next.routeIndex[turn.dialogProcessId] = { sessionId, turnScopeId };
  return result({ turn, applied: true, reason: transition.reason });
}
