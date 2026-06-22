/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

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

const UNBOUND_LOCAL_SEND_BINDING_STATES = Object.freeze([
  SESSION_RUN_STATE.SENDING,
  SESSION_RUN_STATE.RECONNECTING,
]);

const UNBOUND_LOCAL_SEND_IGNORED_UNSCOPED_CHANNEL_STATES = Object.freeze([
  ...TERMINAL_STATES,
  SESSION_RUN_STATE.STOPPING,
]);

const STATE_PRIORITY = Object.freeze({
  [SESSION_RUN_STATE.IDLE]: 0,
  [SESSION_RUN_STATE.SENDING]: 40,
  [SESSION_RUN_STATE.RECONNECTING]: 40,
  [SESSION_RUN_STATE.INTERACTION_PENDING]: 50,
  [SESSION_RUN_STATE.STOP_REQUESTED]: 70,
  [SESSION_RUN_STATE.STOPPING]: 80,
  [SESSION_RUN_STATE.COMPLETED]: 100,
  [SESSION_RUN_STATE.ERROR]: 100,
  [SESSION_RUN_STATE.EXPIRED]: 100,
  [SESSION_RUN_STATE.NO_CONVERSATION]: 100,
  [SESSION_RUN_STATE.STOPPED]: 110,
  [SESSION_RUN_STATE.CANCELLED]: 110,
  [SESSION_RUN_STATE.CANCELED]: 110,
});

function trim(value = "") {
  return String(value || "").trim();
}

function nowMs() {
  return Date.now();
}

function normalizeState(state = "") {
  const value = trim(state).toLowerCase();
  if (value === "running") return SESSION_RUN_STATE.SENDING;
  if (value === "cancelled") return SESSION_RUN_STATE.CANCELLED;
  if (value === "canceled") return SESSION_RUN_STATE.CANCELED;
  return Object.values(SESSION_RUN_STATE).includes(value) ? value : "";
}

function statePriority(state = "") {
  return STATE_PRIORITY[normalizeState(state)] ?? 0;
}

function sameConversationScope(current = {}, event = {}) {
  const currentSessionId = trim(current.sessionId);
  const eventSessionId = trim(event.sessionId);
  if (currentSessionId && eventSessionId && currentSessionId !== eventSessionId) return false;
  if (isUnboundLocalSendingState(current)) return true;
  const currentDialogProcessId = trim(current.dialogProcessId);
  const eventDialogProcessId = trim(event.dialogProcessId);
  if (currentDialogProcessId && eventDialogProcessId && currentDialogProcessId !== eventDialogProcessId) {
    return false;
  }
  return true;
}

function shouldStartNewTurn(current = {}, event = {}) {
  if (event.type !== SESSION_RUN_EVENT.LOCAL_SEND_STARTED) return false;
  if (isTerminalSessionRunState(current.state)) return true;
  const eventDialogProcessId = trim(event.dialogProcessId);
  const currentDialogProcessId = trim(current.dialogProcessId);
  if (!eventDialogProcessId || !currentDialogProcessId) return true;
  return eventDialogProcessId !== currentDialogProcessId;
}

function isUnboundLocalSendingState(current = {}) {
  return normalizeState(current.state) === SESSION_RUN_STATE.SENDING &&
    current.dialogProcessBound === false &&
    current.localSendUnbound === true;
}

function shouldIgnoreEventForUnboundLocalSend(current = {}, event = {}) {
  if (!isUnboundLocalSendingState(current)) return false;
  if (event.type === SESSION_RUN_EVENT.LOCAL_SEND_STARTED) return false;
  if (event.type === SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED) return false;
  const eventDialogProcessId = trim(event.dialogProcessId);
  if (UNBOUND_LOCAL_SEND_BINDING_STATES.includes(event.state)) return false;
  if (!eventDialogProcessId && event.type === SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE) {
    return UNBOUND_LOCAL_SEND_IGNORED_UNSCOPED_CHANNEL_STATES.includes(event.state);
  }
  if (!eventDialogProcessId) return false;
  return true;
}

function resolveNextDialogProcessId(current = {}, event = {}) {
  return trim(event.dialogProcessId) || trim(current.dialogProcessId);
}

function resolveNextDialogProcessBound(current = {}, event = {}, { startsNewTurn = false } = {}) {
  if (event.type === SESSION_RUN_EVENT.LOCAL_SEND_STARTED) return Boolean(trim(event.dialogProcessId));
  const currentDialogProcessBound = current.dialogProcessBound ?? Boolean(trim(current.dialogProcessId));
  return Boolean(trim(event.dialogProcessId)) || (!startsNewTurn && Boolean(currentDialogProcessBound));
}

function resolveNextLocalSendUnbound(current = {}, event = {}, { nextDialogProcessBound = false } = {}) {
  if (event.type === SESSION_RUN_EVENT.LOCAL_SEND_STARTED) return !Boolean(trim(event.dialogProcessId));
  return !Boolean(trim(event.dialogProcessId)) &&
    !nextDialogProcessBound &&
    event.state === SESSION_RUN_STATE.SENDING &&
    current.localSendUnbound === true;
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
    source: "initial",
    sourceEvent: "",
    seq: 0,
    priority: 0,
    updatedAt: 0,
    stopRequestedAt: 0,
    lastEventType: "",
    dialogProcessBound: false,
    localSendUnbound: false,
    ...overrides,
  };
}

export function normalizeSessionRunEvent(rawEvent = {}) {
  const type = trim(rawEvent?.type || rawEvent?.event || SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE);
  let state = normalizeState(rawEvent?.state);
  if (!state) {
    if (type === SESSION_RUN_EVENT.LOCAL_SEND_STARTED) state = SESSION_RUN_STATE.SENDING;
    if (type === SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED) state = SESSION_RUN_STATE.STOP_REQUESTED;
    if (type === SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING) state = SESSION_RUN_STATE.RECONNECTING;
    if (type === SESSION_RUN_EVENT.LOCAL_FAILURE) state = SESSION_RUN_STATE.ERROR;
    if (type === SESSION_RUN_EVENT.LOCAL_RESET) state = SESSION_RUN_STATE.IDLE;
  }
  const timestamp = Number(rawEvent?.timestamp || rawEvent?.updatedAt || nowMs());
  return {
    type,
    state,
    sessionId: trim(rawEvent?.sessionId),
    dialogProcessId: trim(rawEvent?.dialogProcessId),
    source: trim(rawEvent?.source || type),
    sourceEvent: trim(rawEvent?.sourceEvent),
    seq: Number(rawEvent?.seq || 0),
    timestamp,
    raw: rawEvent,
  };
}

export function transitionSessionRunState(currentState = createInitialSessionRunState(), rawEvent = {}) {
  const current = currentState || createInitialSessionRunState();
  const event = normalizeSessionRunEvent(rawEvent);
  if (!event.state) return current;
  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET) return createInitialSessionRunState({ updatedAt: event.timestamp });
  if (!sameConversationScope(current, event) && !shouldStartNewTurn(current, event)) return current;
  if (shouldIgnoreEventForUnboundLocalSend(current, event)) return current;

  const nextPriority = statePriority(event.state);
  const currentPriority = statePriority(current.state);
  const currentSeq = Number(current.seq || 0);
  const eventSeq = Number(event.seq || 0);
  const staleSeq = eventSeq > 0 && currentSeq > 0 && eventSeq < currentSeq;
  const startsNewTurn = shouldStartNewTurn(current, event);
  const wouldReopenStop = isStopLockedSessionRunState(current.state) &&
    !startsNewTurn &&
    UNBOUND_LOCAL_SEND_BINDING_STATES.includes(event.state);
  const wouldLeaveTerminal = isTerminalSessionRunState(current.state) &&
    !startsNewTurn &&
    !isTerminalSessionRunState(event.state);

  if (wouldReopenStop || wouldLeaveTerminal) return current;
  if (staleSeq && nextPriority <= currentPriority) return current;
  if (nextPriority < currentPriority && !startsNewTurn) return current;

  const nextDialogProcessId = resolveNextDialogProcessId(current, event);
  const nextDialogProcessBound = resolveNextDialogProcessBound(current, event, { startsNewTurn });
  const nextLocalSendUnbound = resolveNextLocalSendUnbound(current, event, { nextDialogProcessBound });

  return {
    state: event.state,
    sessionId: event.sessionId || trim(current.sessionId),
    dialogProcessId: nextDialogProcessId,
    source: event.source,
    sourceEvent: event.sourceEvent,
    seq: Math.max(currentSeq, eventSeq),
    priority: nextPriority,
    updatedAt: event.timestamp,
    stopRequestedAt:
      event.state === SESSION_RUN_STATE.STOP_REQUESTED
        ? event.timestamp
        : Number(current.stopRequestedAt || 0),
    lastEventType: event.type,
    dialogProcessBound: nextDialogProcessBound,
    localSendUnbound: nextLocalSendUnbound,
  };
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
    canStop: [SESSION_RUN_STATE.SENDING, SESSION_RUN_STATE.RECONNECTING].includes(state),
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
