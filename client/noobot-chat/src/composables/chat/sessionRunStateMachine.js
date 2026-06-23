/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../infra/messageIdentity";
import { nowMs, toIsoTime } from "../infra/timeFields";

const STOP_REQUEST_STORAGE_KEY = "noobot:session-run-state-machine:stop-requests:v1";
const STOP_REQUEST_TTL_MS = 5 * 60 * 1000;

export const SESSION_RUN_STATE = Object.freeze({
  IDLE: "idle",
  SENDING: "sending",
  RECONNECTING: "reconnecting",
  INTERACTION_PENDING: "interaction_pending",
  STOP_REQUESTED: "stop_requested",
  STOPPING: "stopping",
  STOPPED: "stopped",
  COMPLETED: "completed",
  ERROR: "error",
  EXPIRED: "expired",
  NO_CONVERSATION: "no_conversation",
  CANCELLED: "cancelled",
  CANCELED: "canceled",
});

export const SESSION_RUN_EVENT = Object.freeze({
  LOCAL_SEND_STARTED: "local_send_started",
  LOCAL_STOP_REQUESTED: "local_stop_requested",
  BACKEND_RECOVERABLE_RUNNING: "backend_recoverable_running",
  BACKEND_CONVERSATION_STATE: "backend_conversation_state",
  BACKEND_CHANNEL_STATE: "backend_channel_state",
  LOCAL_FAILURE: "local_failure",
  LOCAL_RESET: "local_reset",
});

const TERMINAL_STATES = Object.freeze([
  SESSION_RUN_STATE.STOPPED,
  SESSION_RUN_STATE.COMPLETED,
  SESSION_RUN_STATE.ERROR,
  SESSION_RUN_STATE.EXPIRED,
  SESSION_RUN_STATE.NO_CONVERSATION,
  SESSION_RUN_STATE.CANCELLED,
  SESSION_RUN_STATE.CANCELED,
]);

const IN_FLIGHT_STATES = Object.freeze([
  SESSION_RUN_STATE.SENDING,
  SESSION_RUN_STATE.RECONNECTING,
  SESSION_RUN_STATE.INTERACTION_PENDING,
  SESSION_RUN_STATE.STOP_REQUESTED,
  SESSION_RUN_STATE.STOPPING,
]);

const STOP_LOCK_STATES = Object.freeze([
  SESSION_RUN_STATE.STOP_REQUESTED,
  SESSION_RUN_STATE.STOPPING,
  SESSION_RUN_STATE.STOPPED,
  SESSION_RUN_STATE.CANCELLED,
  SESSION_RUN_STATE.CANCELED,
]);

const STOP_LOCK_REOPEN_STATES = Object.freeze([
  SESSION_RUN_STATE.SENDING,
  SESSION_RUN_STATE.RECONNECTING,
]);

const SESSION_RUN_TRANSITION_RULE = Object.freeze({
  PRIORITY_FORWARD: "priority_forward",
  STOP_LOCKED: "stop_locked",
  TERMINAL_LOCKED: "terminal_locked",
});

const SESSION_RUN_TRANSITION_GUARD_ID = Object.freeze({
  HAS_EVENT_STATE: "has_event_state",
  SAME_CONVERSATION_SCOPE_OR_NEW_TURN: "same_conversation_scope_or_new_turn",
  STOP_LOCK_NOT_REOPENED: "stop_lock_not_reopened",
  TERMINAL_NOT_REOPENED: "terminal_not_reopened",
  NO_STALE_SEQ_REGRESSION: "no_stale_seq_regression",
  PRIORITY_FORWARD_OR_NEW_TURN: "priority_forward_or_new_turn",
});

export const SESSION_RUN_TRANSITION_DECISION_REASON = Object.freeze({
  APPLIED: "applied",
  LOCAL_RESET: "local_reset",
  MISSING_EVENT_STATE: "missing_event_state",
  DIFFERENT_SCOPE: "different_scope",
  STOP_LOCK_REOPEN: "stop_lock_reopen",
  TERMINAL_LOCK_REOPEN: "terminal_lock_reopen",
  STALE_SEQ_REGRESSION: "stale_seq_regression",
  PRIORITY_REGRESSION: "priority_regression",
});

const COMMON_TRANSITION_GUARD_IDS = Object.freeze([
  SESSION_RUN_TRANSITION_GUARD_ID.HAS_EVENT_STATE,
  SESSION_RUN_TRANSITION_GUARD_ID.SAME_CONVERSATION_SCOPE_OR_NEW_TURN,
]);

const FINAL_TRANSITION_GUARD_IDS = Object.freeze([
  SESSION_RUN_TRANSITION_GUARD_ID.NO_STALE_SEQ_REGRESSION,
  SESSION_RUN_TRANSITION_GUARD_ID.PRIORITY_FORWARD_OR_NEW_TURN,
]);

const SESSION_RUN_TRANSITION_RULE_GUARDS = Object.freeze({
  [SESSION_RUN_TRANSITION_RULE.PRIORITY_FORWARD]: Object.freeze([]),
  [SESSION_RUN_TRANSITION_RULE.STOP_LOCKED]: Object.freeze([
    SESSION_RUN_TRANSITION_GUARD_ID.STOP_LOCK_NOT_REOPENED,
  ]),
  [SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED]: Object.freeze([
    SESSION_RUN_TRANSITION_GUARD_ID.TERMINAL_NOT_REOPENED,
  ]),
});

function createTransitionConfig(priority, rule = SESSION_RUN_TRANSITION_RULE.PRIORITY_FORWARD) {
  return Object.freeze({
    priority,
    rule,
    guards: Object.freeze([
      ...COMMON_TRANSITION_GUARD_IDS,
      ...(SESSION_RUN_TRANSITION_RULE_GUARDS[rule] || []),
      ...FINAL_TRANSITION_GUARD_IDS,
    ]),
  });
}

export const SESSION_RUN_TRANSITION_TABLE = Object.freeze({
  [SESSION_RUN_STATE.IDLE]: createTransitionConfig(0),
  [SESSION_RUN_STATE.SENDING]: createTransitionConfig(40),
  [SESSION_RUN_STATE.RECONNECTING]: createTransitionConfig(40),
  [SESSION_RUN_STATE.INTERACTION_PENDING]: createTransitionConfig(50),
  [SESSION_RUN_STATE.STOP_REQUESTED]: createTransitionConfig(70, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [SESSION_RUN_STATE.STOPPING]: createTransitionConfig(80, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [SESSION_RUN_STATE.COMPLETED]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [SESSION_RUN_STATE.ERROR]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [SESSION_RUN_STATE.EXPIRED]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [SESSION_RUN_STATE.NO_CONVERSATION]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [SESSION_RUN_STATE.STOPPED]: createTransitionConfig(110, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [SESSION_RUN_STATE.CANCELLED]: createTransitionConfig(110, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [SESSION_RUN_STATE.CANCELED]: createTransitionConfig(110, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
});

function trim(value = "") {
  return String(value || "").trim();
}

function normalizeState(state = "") {
  const value = trim(state).toLowerCase();
  if (value === "running") return SESSION_RUN_STATE.SENDING;
  if (value === "cancelled") return SESSION_RUN_STATE.CANCELLED;
  if (value === "canceled") return SESSION_RUN_STATE.CANCELED;
  return Object.values(SESSION_RUN_STATE).includes(value) ? value : "";
}

function transitionPriority(state = "") {
  return SESSION_RUN_TRANSITION_TABLE[normalizeState(state)]?.priority ?? 0;
}

function transitionRule(state = "") {
  return SESSION_RUN_TRANSITION_TABLE[normalizeState(state)]?.rule || SESSION_RUN_TRANSITION_RULE.PRIORITY_FORWARD;
}

export function resolveEventScope(value = {}) {
  return trim(value.turnScopeId);
}

function resolveEventProcessScope(value = {}) {
  return trim(value.dialogProcessId);
}

function hasRunProcessIdentity(value = {}) {
  return Boolean(resolveEventProcessScope(value));
}

function hasRunTurnIdentity(value = {}) {
  return Boolean(resolveEventScope(value));
}

function hasRunIdentity(value = {}) {
  return hasRunProcessIdentity(value) || hasRunTurnIdentity(value);
}

function hasMatchingRunTurnIdentity(current = {}, event = {}) {
  const currentTurnScopeId = trim(current.turnScopeId);
  const eventTurnScopeId = trim(event.turnScopeId);
  return Boolean(currentTurnScopeId && eventTurnScopeId && currentTurnScopeId === eventTurnScopeId);
}

function hasConflictingRunTurnIdentity(current = {}, event = {}) {
  const currentTurnScopeId = trim(current.turnScopeId);
  const eventTurnScopeId = trim(event.turnScopeId);
  return Boolean(currentTurnScopeId && eventTurnScopeId && currentTurnScopeId !== eventTurnScopeId);
}

function sameConversationScope(current = {}, event = {}) {
  const currentSessionId = trim(current.sessionId);
  const eventSessionId = trim(event.sessionId);
  if (currentSessionId && eventSessionId && currentSessionId !== eventSessionId) return false;
  const currentDialogProcessId = trim(current.dialogProcessId);
  const eventDialogProcessId = trim(event.dialogProcessId);
  if (currentDialogProcessId && eventDialogProcessId && currentDialogProcessId !== eventDialogProcessId) {
    return false;
  }
  if (hasConflictingRunTurnIdentity(current, event)) return false;

  const processMatched = Boolean(currentDialogProcessId && eventDialogProcessId);
  const turnMatched = hasMatchingRunTurnIdentity(current, event);
  if (processMatched || turnMatched) return true;

  const currentHasTurnIdentity = hasRunTurnIdentity(current);
  const eventHasTurnIdentity = hasRunTurnIdentity(event);
  if (currentHasTurnIdentity && eventHasTurnIdentity) return false;

  const currentHasProcessIdentity = hasRunProcessIdentity(current);
  const eventHasProcessIdentity = hasRunProcessIdentity(event);
  if (
    (currentHasTurnIdentity && eventHasProcessIdentity) ||
    (currentHasProcessIdentity && eventHasTurnIdentity)
  ) {
    return false;
  }
  return true;
}

function canBindBackendDialogProcessIdByTurnScope(current = {}, event = {}) {
  if (trim(current.dialogProcessId)) return false;
  const currentTurnScopeId = trim(current.turnScopeId);
  const eventTurnScopeId = trim(event.turnScopeId);
  return Boolean(currentTurnScopeId && eventTurnScopeId && currentTurnScopeId === eventTurnScopeId && trim(event.dialogProcessId));
}

function resolveRunTurnScopeId(value = {}) {
  return trim(value.turnScopeId);
}

function shouldStartNewTurn(current = {}, event = {}) {
  if (event.type !== SESSION_RUN_EVENT.LOCAL_SEND_STARTED) return false;
  if (isTerminalSessionRunState(current.state)) return true;
  const eventScope = resolveEventScope(event);
  const currentScope = resolveEventScope(current);
  if (!eventScope || !currentScope) return true;
  return eventScope !== currentScope;
}

function hasEventState(event = {}) {
  return Boolean(event.state);
}

function isSameConversationScopeOrNewTurn({ current = {}, event = {}, startsNewTurn = false } = {}) {
  if (isUnscopedLocalFailureForScopedTurn({ current, event, startsNewTurn })) return false;
  if (isUnscopedBackendStateForScopedTurn({ current, event, startsNewTurn })) return false;
  return sameConversationScope(current, event) || startsNewTurn || canBindBackendDialogProcessIdByTurnScope(current, event);
}

function isNotReopeningStopLock({ event = {}, startsNewTurn = false, currentRule = "" } = {}) {
  if (currentRule !== SESSION_RUN_TRANSITION_RULE.STOP_LOCKED) return true;
  if (startsNewTurn) return true;
  return !STOP_LOCK_REOPEN_STATES.includes(event.state);
}

function isNotLeavingTerminal({ event = {}, startsNewTurn = false, currentRule = "" } = {}) {
  if (currentRule !== SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED) return true;
  if (startsNewTurn) return true;
  return isTerminalSessionRunState(event.state);
}

function isNotStaleSeqRegression({ currentPriority = 0, nextPriority = 0, staleSeq = false } = {}) {
  return !(staleSeq && nextPriority <= currentPriority);
}

function isPriorityForwardOrNewTurn({ currentPriority = 0, nextPriority = 0, startsNewTurn = false } = {}) {
  return startsNewTurn || nextPriority >= currentPriority;
}

function isBackendRunStateEvent(event = {}) {
  return [
    SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
    SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING,
  ].includes(event.type);
}

function isUnscopedBackendProtectedState(state = "") {
  return [
    SESSION_RUN_STATE.STOPPING,
    ...TERMINAL_STATES,
  ].includes(normalizeState(state));
}

function isUnscopedBackendStateForScopedTurn({ current = {}, event = {}, startsNewTurn = false } = {}) {
  if (startsNewTurn) return false;
  if (!isBackendRunStateEvent(event)) return false;
  if (!hasRunIdentity(current)) return false;
  if (hasRunIdentity(event)) return false;
  return isUnscopedBackendProtectedState(event.state);
}

function isUnscopedLocalFailureForScopedTurn({ current = {}, event = {}, startsNewTurn = false } = {}) {
  if (startsNewTurn) return false;
  if (event.type !== SESSION_RUN_EVENT.LOCAL_FAILURE) return false;
  if (!hasRunIdentity(current)) return false;
  return !hasRunIdentity(event);
}

export const SESSION_RUN_TRANSITION_GUARDS = Object.freeze([
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.HAS_EVENT_STATE,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.MISSING_EVENT_STATE,
    passes: ({ event = {} } = {}) => hasEventState(event),
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.SAME_CONVERSATION_SCOPE_OR_NEW_TURN,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.DIFFERENT_SCOPE,
    passes: isSameConversationScopeOrNewTurn,
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.STOP_LOCK_NOT_REOPENED,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.STOP_LOCK_REOPEN,
    passes: isNotReopeningStopLock,
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.TERMINAL_NOT_REOPENED,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.TERMINAL_LOCK_REOPEN,
    passes: isNotLeavingTerminal,
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.NO_STALE_SEQ_REGRESSION,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.STALE_SEQ_REGRESSION,
    passes: isNotStaleSeqRegression,
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.PRIORITY_FORWARD_OR_NEW_TURN,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.PRIORITY_REGRESSION,
    passes: isPriorityForwardOrNewTurn,
  }),
]);

const SESSION_RUN_TRANSITION_GUARD_BY_ID = Object.freeze(Object.fromEntries(
  SESSION_RUN_TRANSITION_GUARDS.map((guard) => [guard.id, guard]),
));

function resolveTransitionGuards(state = "") {
  return (SESSION_RUN_TRANSITION_TABLE[normalizeState(state)]?.guards || COMMON_TRANSITION_GUARD_IDS)
    .map((guardId) => SESSION_RUN_TRANSITION_GUARD_BY_ID[guardId])
    .filter(Boolean);
}

function normalizeTransitionInputs(currentState = createInitialSessionRunState(), rawEvent = {}) {
  const current = currentState || createInitialSessionRunState();
  const event = normalizeSessionRunEvent(rawEvent);
  const startsNewTurn = shouldStartNewTurn(current, event);
  const currentPriority = transitionPriority(current.state);
  const nextPriority = transitionPriority(event.state);
  const currentSeq = Number(current.seq || 0);
  const eventSeq = Number(event.seq || 0);

  return {
    current,
    event,
    startsNewTurn,
    currentPriority,
    nextPriority,
    currentSeq,
    eventSeq,
    currentRule: transitionRule(current.state),
    staleSeq: eventSeq > 0 && currentSeq > 0 && eventSeq < currentSeq,
  };
}

function resolveNormalizedTransitionDecision(transition = {}) {
  const { current = createInitialSessionRunState(), event = {} } = transition;
  const currentState = normalizeState(current.state) || SESSION_RUN_STATE.IDLE;

  function decision(canApply, reason, nextState = currentState) {
    return { canApply, reason, nextState };
  }

  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET) {
    return decision(true, SESSION_RUN_TRANSITION_DECISION_REASON.LOCAL_RESET, SESSION_RUN_STATE.IDLE);
  }
  for (const guard of resolveTransitionGuards(currentState)) {
    if (!guard.passes(transition)) {
      return decision(false, guard.reason);
    }
  }
  return decision(true, SESSION_RUN_TRANSITION_DECISION_REASON.APPLIED, event.state);
}

function canApplyNormalizedEvent(transition = {}) {
  return resolveNormalizedTransitionDecision(transition).canApply;
}

export function canApplyEvent(currentState = createInitialSessionRunState(), rawEvent = {}) {
  return canApplyNormalizedEvent(normalizeTransitionInputs(currentState, rawEvent));
}

export function resolveTransitionDecision(currentState = createInitialSessionRunState(), rawEvent = {}) {
  return resolveNormalizedTransitionDecision(normalizeTransitionInputs(currentState, rawEvent));
}

export function resolveNextStateByTransitionTable(currentState = createInitialSessionRunState(), rawEvent = {}) {
  return resolveTransitionDecision(currentState, rawEvent).nextState;
}

function resolveNextDialogProcessId(current = {}, event = {}, { startsNewTurn = false } = {}) {
  if (startsNewTurn) return trim(event.dialogProcessId);
  return trim(event.dialogProcessId) || trim(current.dialogProcessId);
}

function resolveNextTurnScopeId(current = {}, event = {}, { startsNewTurn = false } = {}) {
  if (startsNewTurn) return resolveRunTurnScopeId(event);
  return resolveRunTurnScopeId(event) || resolveRunTurnScopeId(current);
}

export function isTerminalSessionRunState(state = "") {
  return TERMINAL_STATES.includes(normalizeState(state));
}

export function isInFlightSessionRunState(state = "") {
  return IN_FLIGHT_STATES.includes(normalizeState(state));
}

export function isStopLockedSessionRunState(state = "") {
  return STOP_LOCK_STATES.includes(normalizeState(state));
}

export function createInitialSessionRunState(overrides = {}) {
  return {
    state: SESSION_RUN_STATE.IDLE,
    sessionId: "",
    dialogProcessId: "",
    turnScopeId: "",
    source: "initial",
    sourceEvent: "",
    seq: 0,
    priority: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
    createdAtIso: "",
    updatedAtIso: "",
    updatedAt: 0,
    stopRequestedAt: 0,
    lastEventType: "",
    ...overrides,
  };
}

function normalizeTimestamp(rawEvent = {}) {
  const numericTimestamp = Number(
    rawEvent?.timestamp || rawEvent?.updatedAtMs || rawEvent?.createdAtMs || 0,
  );
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) return numericTimestamp;
  const parsedUpdatedAt = rawEvent?.updatedAt ? Date.parse(rawEvent.updatedAt) : 0;
  if (Number.isFinite(parsedUpdatedAt) && parsedUpdatedAt > 0) return parsedUpdatedAt;
  const parsedCreatedAt = rawEvent?.createdAt ? Date.parse(rawEvent.createdAt) : 0;
  if (Number.isFinite(parsedCreatedAt) && parsedCreatedAt > 0) return parsedCreatedAt;
  return nowMs();
}

export function normalizeSessionRunEvent(rawEvent = {}) {
  const turnMeta = normalizeTurnMeta(rawEvent);
  const type = trim(rawEvent?.type || rawEvent?.event || SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE);
  let state = normalizeState(rawEvent?.state);
  if (!state) {
    if (type === SESSION_RUN_EVENT.LOCAL_SEND_STARTED) state = SESSION_RUN_STATE.SENDING;
    if (type === SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED) state = SESSION_RUN_STATE.STOP_REQUESTED;
    if (type === SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING) state = SESSION_RUN_STATE.RECONNECTING;
    if (type === SESSION_RUN_EVENT.LOCAL_FAILURE) state = SESSION_RUN_STATE.ERROR;
    if (type === SESSION_RUN_EVENT.LOCAL_RESET) state = SESSION_RUN_STATE.IDLE;
  }
  const timestamp = normalizeTimestamp(rawEvent);
  return {
    type,
    state,
    sessionId: trim(rawEvent?.sessionId),
    dialogProcessId: type === SESSION_RUN_EVENT.LOCAL_SEND_STARTED
      ? ""
      : trim(rawEvent?.dialogProcessId),
    turnScopeId: turnMeta.turnScopeId,
    source: trim(rawEvent?.source || type),
    sourceEvent: trim(rawEvent?.sourceEvent),
    seq: Number(rawEvent?.seq || 0),
    timestamp,
    createdAtMs: Number(rawEvent?.createdAtMs || 0),
    updatedAtMs: Number(rawEvent?.updatedAtMs || 0),
    createdAt: trim(rawEvent?.createdAt),
    updatedAt: trim(rawEvent?.updatedAt),
    raw: rawEvent,
  };
}

export function transitionSessionRunState(currentState = createInitialSessionRunState(), rawEvent = {}) {
  const transition = normalizeTransitionInputs(currentState, rawEvent);
  const { current, event, startsNewTurn, currentSeq, eventSeq, nextPriority } = transition;
  if (!canApplyNormalizedEvent(transition)) return current;
  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET) return createInitialSessionRunState({ updatedAt: event.timestamp });

  const nextDialogProcessId = resolveNextDialogProcessId(current, event, { startsNewTurn });
  const nextTurnScopeId = resolveNextTurnScopeId(current, event, { startsNewTurn });
  return {
    state: event.state,
    sessionId: event.sessionId || trim(current.sessionId),
    dialogProcessId: nextDialogProcessId,
    turnScopeId: nextTurnScopeId,
    source: event.source,
    sourceEvent: event.sourceEvent,
    seq: Math.max(currentSeq, eventSeq),
    priority: nextPriority,
    createdAtMs:
      event.createdAtMs ||
      (startsNewTurn ? event.timestamp : Number(current.createdAtMs || 0)),
    updatedAtMs: event.updatedAtMs || event.timestamp,
    createdAtIso:
      event.createdAt ||
      (event.createdAtMs > 0
        ? toIsoTime(event.createdAtMs)
        : startsNewTurn
          ? toIsoTime(event.timestamp)
          : trim(current.createdAtIso)),
    updatedAtIso:
      event.updatedAt ||
      (event.updatedAtMs > 0
        ? toIsoTime(event.updatedAtMs)
        : toIsoTime(event.timestamp)),
    updatedAt: event.timestamp,
    stopRequestedAt:
      event.state === SESSION_RUN_STATE.STOP_REQUESTED
        ? event.timestamp
        : Number(current.stopRequestedAt || 0),
    lastEventType: event.type,
  };
}

function isRunStateForActiveSession(stateSnapshot = {}, activeSession = {}) {
  const stateSessionId = trim(stateSnapshot?.sessionId);
  if (!stateSessionId) return true;
  const activeIds = [
    activeSession?.id,
    activeSession?.backendSessionId,
  ].map((item) => trim(item)).filter(Boolean);
  return !activeIds.length || activeIds.includes(stateSessionId);
}

function getLatestAssistantMessage(activeSession = {}) {
  const messages = Array.isArray(activeSession?.messages) ? activeSession.messages : [];
  return [...messages].reverse().find((item = {}) => getMessageRole(item) === "assistant") || null;
}

export function resolveSessionRunStateForMessage({
  stateSnapshot = createInitialSessionRunState(),
  messageItem = {},
  activeSession = {},
} = {}) {
  const normalizedState = normalizeState(stateSnapshot?.state);
  if (!isInFlightSessionRunState(normalizedState)) return null;
  if (getMessageRole(messageItem) !== "assistant") return null;
  if (!isRunStateForActiveSession(stateSnapshot, activeSession)) return null;

  const runDialogProcessId = trim(stateSnapshot?.dialogProcessId);
  const runTurnScopeId = trim(stateSnapshot?.turnScopeId);
  const messageDialogProcessId = getMessageDialogProcessId(messageItem);
  const messageTurnScopeId = getMessageTurnScopeId(messageItem);

  if (runDialogProcessId && messageDialogProcessId && runDialogProcessId === messageDialogProcessId) {
    return stateSnapshot;
  }
  if (runTurnScopeId && messageTurnScopeId && runTurnScopeId === messageTurnScopeId) {
    return stateSnapshot;
  }
  const latestAssistant = getLatestAssistantMessage(activeSession);
  if (latestAssistant !== messageItem) return null;

  // Fallback for reconnect/session refresh windows where one side has not
  // received the backend dialogProcessId/turnScopeId yet. Terminal and stale
  // state consistency is still owned by this state machine before this helper
  // returns an in-flight state.
  if (!runDialogProcessId && !runTurnScopeId) return stateSnapshot;
  if (!messageDialogProcessId && !messageTurnScopeId) return stateSnapshot;
  return null;
}

export function reduceSessionRunEvents(initialState = createInitialSessionRunState(), rawEvents = []) {
  return (Array.isArray(rawEvents) ? rawEvents : []).reduce(
    (state, event) => transitionSessionRunState(state, event),
    initialState || createInitialSessionRunState(),
  );
}

export function evaluateSessionRunState(stateSnapshot = createInitialSessionRunState()) {
  const state = normalizeState(stateSnapshot?.state) || SESSION_RUN_STATE.IDLE;
  return {
    state,
    sending: isInFlightSessionRunState(state),
    canStop: [
      SESSION_RUN_STATE.SENDING,
      SESSION_RUN_STATE.RECONNECTING,
      SESSION_RUN_STATE.INTERACTION_PENDING,
    ].includes(state),
    interactionSubmitting: state === SESSION_RUN_STATE.INTERACTION_PENDING ? false : undefined,
    pendingInteractionPolicy: state === SESSION_RUN_STATE.INTERACTION_PENDING ? "await_payload" : "unchanged",
    assistantStatus:
      state === SESSION_RUN_STATE.STOPPING || state === SESSION_RUN_STATE.STOP_REQUESTED
        ? "stopping"
        : state === SESSION_RUN_STATE.RECONNECTING
          ? "reconnecting"
          : state === SESSION_RUN_STATE.COMPLETED
            ? "generated"
            : [SESSION_RUN_STATE.STOPPED, SESSION_RUN_STATE.CANCELLED, SESSION_RUN_STATE.CANCELED].includes(state)
              ? "stopped"
              : state === SESSION_RUN_STATE.ERROR
                ? "failed"
                : "",
    terminal: isTerminalSessionRunState(state),
    stopLocked: isStopLockedSessionRunState(state),
  };
}

export function applySessionRunStateEvent({ stateRef, sending, canStop, event } = {}) {
  const previousState = stateRef?.value || createInitialSessionRunState();
  const nextState = transitionSessionRunState(previousState, event);
  if (stateRef) stateRef.value = nextState;
  const evaluation = evaluateSessionRunState(nextState);
  if (sending) sending.value = evaluation.sending;
  if (canStop) canStop.value = evaluation.canStop;
  return { previousState, nextState, evaluation, changed: previousState !== nextState };
}

export function applySessionRunStateEvents({ stateRef, sending, canStop, events = [] } = {}) {
  const previousState = stateRef?.value || createInitialSessionRunState();
  const nextState = reduceSessionRunEvents(previousState, events);
  if (stateRef) stateRef.value = nextState;
  const evaluation = evaluateSessionRunState(nextState);
  if (sending) sending.value = evaluation.sending;
  if (canStop) canStop.value = evaluation.canStop;
  return { previousState, nextState, evaluation, changed: previousState !== nextState };
}

function readStopRequests() {
  try {
    const storage = globalThis?.localStorage;
    if (!storage) return [];
    const rawValue = storage.getItem(STOP_REQUEST_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStopRequests(entries = []) {
  try {
    const storage = globalThis?.localStorage;
    if (!storage) return;
    storage.setItem(STOP_REQUEST_STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

function isFreshStopRequest(entry = {}, timestamp = nowMs()) {
  return Number(timestamp || 0) - Number(entry?.timestamp || 0) <= STOP_REQUEST_TTL_MS;
}

export function rememberStopRequestedEvent(rawEvent = {}) {
  const event = normalizeSessionRunEvent({
    ...rawEvent,
    type: SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED,
    state: SESSION_RUN_STATE.STOP_REQUESTED,
  });
  if (!event.sessionId) return event;
  const entries = readStopRequests().filter((entry) => {
    if (!isFreshStopRequest(entry, event.timestamp)) return false;
    if (trim(entry.sessionId) !== event.sessionId) return true;
    const entryDialogProcessId = trim(entry.dialogProcessId);
    return Boolean(entryDialogProcessId && event.dialogProcessId && entryDialogProcessId !== event.dialogProcessId);
  });
  entries.push({
    sessionId: event.sessionId,
    dialogProcessId: event.dialogProcessId,
    turnScopeId: event.turnScopeId,
    seq: event.seq,
    timestamp: event.timestamp,
  });
  writeStopRequests(entries);
  return event;
}

export function resolveRememberedStopRequestedEvent({ sessionId = "", dialogProcessId = "" } = {}) {
  const normalizedSessionId = trim(sessionId);
  const normalizedDialogProcessId = trim(dialogProcessId);
  if (!normalizedSessionId) return null;
  const timestamp = nowMs();
  const entries = readStopRequests();
  const freshEntries = entries.filter((entry) => isFreshStopRequest(entry, timestamp));
  if (freshEntries.length !== entries.length) writeStopRequests(freshEntries);
  const match = freshEntries.find((entry) => {
    if (trim(entry.sessionId) !== normalizedSessionId) return false;
    const entryDialogProcessId = trim(entry.dialogProcessId);
    return !entryDialogProcessId || !normalizedDialogProcessId || entryDialogProcessId === normalizedDialogProcessId;
  });
  if (!match) return null;
  return normalizeSessionRunEvent({
    type: SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED,
    state: SESSION_RUN_STATE.STOP_REQUESTED,
    sessionId: normalizedSessionId,
    dialogProcessId: normalizedDialogProcessId || trim(match.dialogProcessId),
    turnScopeId: trim(match.turnScopeId),
    seq: Number(match.seq || 0),
    timestamp: Number(match.timestamp || timestamp),
    source: "remembered_stop_request",
  });
}

export function clearRememberedStopRequests({ sessionId = "", dialogProcessId = "" } = {}) {
  const normalizedSessionId = trim(sessionId);
  const normalizedDialogProcessId = trim(dialogProcessId);
  if (!normalizedSessionId) return;
  const entries = readStopRequests().filter((entry) => {
    if (trim(entry.sessionId) !== normalizedSessionId) return true;
    const entryDialogProcessId = trim(entry.dialogProcessId);
    if (!normalizedDialogProcessId || !entryDialogProcessId) return false;
    return entryDialogProcessId !== normalizedDialogProcessId;
  });
  writeStopRequests(entries);
}
