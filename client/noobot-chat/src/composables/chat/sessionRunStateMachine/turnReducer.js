/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { normalizeSessionRunEvent } from "./eventNormalization";

export const TURN_TRANSITION_REASON = Object.freeze({
  APPLIED: "applied",
  MISSING_STATE: "missing_state",
  ILLEGAL_TRANSITION: "illegal_transition",
  STALE_SEQUENCE: "stale_sequence",
  TERMINAL_LOCKED: "terminal_locked",
  STOP_NOT_ALLOWED: "stop_not_allowed",
});

const FINAL_STATES = new Set([
  FrontendRunState.FRONTEND_COMPLETED,
  FrontendRunState.USER_STOP_COMPLETED,
  FrontendRunState.ACTION_REQUEST_ERROR,
  FrontendRunState.PROCESSING_ERROR,
  FrontendRunState.COMPLETION_ERROR,
  FrontendRunState.STOP_ERROR,
]);

const ACTION_START_EVENTS = new Set([
  SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
  SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
  SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
  SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
  SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
  SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
]);

const STOP_REQUEST_EVENTS = new Set([
  SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED,
  SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
  SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_BACKEND_READY,
]);

function text(value) {
  return String(value || "").trim().toLowerCase();
}

export function isFinalTurnState(state = "") {
  return FINAL_STATES.has(text(state));
}

export function deriveTurnCapabilities(state = "", { backendState = "" } = {}) {
  const normalized = text(state);
  const normalizedBackendState = text(backendState);
  const actionLocked = Boolean(normalized) && !isFinalTurnState(normalized);
  return {
    actionLocked,
    sending: actionLocked,
    // Stopping is an explicit backend capability, not a consequence of the
    // broad frontend PROCESSING projection. Reconnecting and interaction
    // waiting keep the action mutex but must never expose or accept stop.
    canStop: normalized === FrontendRunState.PROCESSING &&
      normalizedBackendState === BackendChannelState.SENDING,
    terminal: isFinalTurnState(normalized),
  };
}

function failureStateFor(current = {}) {
  const state = text(current.state);
  if (state === FrontendRunState.FRONTEND_COMPLETION_REQUESTING) return FrontendRunState.COMPLETION_ERROR;
  if (state === FrontendRunState.USER_STOPPING) return FrontendRunState.STOP_ERROR;
  if (state === FrontendRunState.PROCESSING) return FrontendRunState.PROCESSING_ERROR;
  return FrontendRunState.ACTION_REQUEST_ERROR;
}

function targetState(current = {}, event = {}) {
  const currentState = text(current.state);
  const backendState = text(event.backendState || event.raw?.state || event.state);

  if (event.type === SESSION_RUN_EVENT.LOCAL_FAILURE) return failureStateFor(current);
  if (event.type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED) return FrontendRunState.COMPLETION_ERROR;
  if (event.type === SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_FAILED) return FrontendRunState.STOP_ERROR;
  if (event.type === SESSION_RUN_EVENT.LOCAL_RESEND_FAILED) return FrontendRunState.ACTION_REQUEST_ERROR;
  if (event.type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED) return FrontendRunState.FRONTEND_COMPLETED;
  if (event.type === SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED) return FrontendRunState.USER_STOP_COMPLETED;
  if (ACTION_START_EVENTS.has(event.type)) return FrontendRunState.ACTION_REQUESTING;
  // Stop is an action request too. It remains in the request phase until the
  // backend confirms that stopping has completed.
  if (STOP_REQUEST_EVENTS.has(event.type)) return FrontendRunState.ACTION_REQUESTING;
  if (event.type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED) {
    return FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
  }
  if ([SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE].includes(event.type)) {
    if ([BackendChannelState.SENDING, BackendChannelState.RECONNECTING, BackendChannelState.INTERACTION_PENDING].includes(backendState)) {
      return FrontendRunState.PROCESSING;
    }
    if (backendState === BackendChannelState.COMPLETED) return FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
    if (backendState === BackendChannelState.USER_STOPPED || backendState === BackendChannelState.STOPPING) {
      return FrontendRunState.USER_STOPPING;
    }
    if ([BackendChannelState.ERROR, BackendChannelState.EXPIRED, BackendChannelState.NO_CONVERSATION].includes(backendState)) {
      return failureStateFor(current);
    }
  }
  return text(event.state) || currentState;
}

function isAllowed(current = {}, event = {}, nextState = "") {
  const currentState = text(current.state);
  if (!currentState) return nextState === FrontendRunState.ACTION_REQUESTING || event.authoritativeSnapshot === true;
  if (isFinalTurnState(currentState)) return false;
  if (nextState === failureStateFor(current)) return true;
  // Send, resend and continue always create a new Turn. Once this Turn owns
  // the session action mutex, another action-start event must not be treated
  // as an idempotent same-state update.
  if (ACTION_START_EVENTS.has(event.type)) return false;
  if (nextState === currentState) return true;
  if (nextState === FrontendRunState.ACTION_REQUESTING) {
    return STOP_REQUEST_EVENTS.has(event.type) && currentState === FrontendRunState.PROCESSING;
  }
  if (nextState === FrontendRunState.PROCESSING) {
    return currentState === FrontendRunState.ACTION_REQUESTING && text(current.action) !== "stop";
  }
  if (nextState === FrontendRunState.FRONTEND_COMPLETION_REQUESTING) return currentState === FrontendRunState.PROCESSING;
  if (nextState === FrontendRunState.FRONTEND_COMPLETED) return currentState === FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
  if (nextState === FrontendRunState.USER_STOPPING) {
    return (currentState === FrontendRunState.ACTION_REQUESTING && text(current.action) === "stop") ||
      // Reconnect can first observe the backend stop-complete fact after the
      // local stop command was lost from memory. Stable turn identity still
      // makes this a valid processing -> stop-summary convergence.
      (currentState === FrontendRunState.PROCESSING && [
        BackendChannelState.STOPPING,
        BackendChannelState.USER_STOPPED,
      ].includes(text(event.backendState || event.raw?.state)));
  }
  if (nextState === FrontendRunState.USER_STOP_COMPLETED) {
    // Normally the summary follows USER_STOPPING. A stop endpoint may return
    // the authoritative session summary together with its stop confirmation,
    // so the explicit channel-state event is not guaranteed to arrive first.
    // The identity-matched summary is proof that both backend stop handling and
    // frontend summary application have completed; allow that atomic response
    // to settle the same stop-requesting/processing Turn.
    return currentState === FrontendRunState.USER_STOPPING ||
      (currentState === FrontendRunState.ACTION_REQUESTING && text(current.action) === "stop") ||
      currentState === FrontendRunState.PROCESSING;
  }
  return event.authoritativeSnapshot === true;
}

export function reduceTurnRuntimeEvent(current = null, rawEvent = {}) {
  const event = normalizeSessionRunEvent(rawEvent);
  const eventSeq = Number(event.seq || 0);
  if (current && isFinalTurnState(current.state)) {
    return { applied: false, reason: TURN_TRANSITION_REASON.TERMINAL_LOCKED, current, event };
  }
  if (current && eventSeq > 0 && Number(current.seq || 0) > eventSeq) {
    return { applied: false, reason: TURN_TRANSITION_REASON.STALE_SEQUENCE, current, event };
  }
  if (current && STOP_REQUEST_EVENTS.has(event.type) &&
    !deriveTurnCapabilities(current.state, { backendState: current.backendState }).canStop) {
    return { applied: false, reason: TURN_TRANSITION_REASON.STOP_NOT_ALLOWED, current, event };
  }
  const state = targetState(current || {}, event);
  if (!state) return { applied: false, reason: TURN_TRANSITION_REASON.MISSING_STATE, current, event };
  const action = STOP_REQUEST_EVENTS.has(event.type)
    ? "stop"
    : String(event.action || current?.action || "send").trim();
  const candidate = { ...(current || {}), action };
  if (!isAllowed(candidate, event, state)) {
    return { applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION, current, event };
  }
  const backendState = text(event.backendState || current?.backendState);
  const capabilities = deriveTurnCapabilities(state, { backendState });
  const terminal = state === FrontendRunState.FRONTEND_COMPLETED
    ? "completed"
    : state === FrontendRunState.USER_STOP_COMPLETED
      ? "user_stopped"
      : capabilities.terminal
        ? "error"
        : null;
  return {
    applied: true,
    reason: TURN_TRANSITION_REASON.APPLIED,
    event,
    next: {
      ...(current || {}),
      state,
      action,
      terminal,
      canStop: capabilities.canStop,
      backendState,
      seq: Math.max(Number(current?.seq || 0), eventSeq),
    },
  };
}
