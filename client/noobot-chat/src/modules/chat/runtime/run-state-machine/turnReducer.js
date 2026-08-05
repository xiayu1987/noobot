/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants.js";
import { normalizeSessionRunEvent } from "./eventNormalization.js";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/session-protocol";
import { projectAuthoritativeTurnState } from "./authoritativeTurnProjection.js";

export const TURN_TRANSITION_REASON = Object.freeze({
  APPLIED: "applied",
  MISSING_STATE: "missing_state",
  ILLEGAL_TRANSITION: "illegal_transition",
  STALE_SEQUENCE: "stale_sequence",
  TERMINAL_LOCKED: "terminal_locked",
  STOP_NOT_ALLOWED: "stop_not_allowed",
  STALE_REVISION: "stale_revision",
  COMPLETION_COMMIT_REQUIRED: "completion_commit_required",
  COMPLETION_COMMIT_MISMATCH: "completion_commit_mismatch",
});

const FINAL_STATES = new Set([
  FrontendRunState.FRONTEND_COMPLETED,
  FrontendRunState.USER_STOP_COMPLETED,
  FrontendRunState.CANCELLED,
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

export function isFinalTurnState(state = "", turn = {}) {
  const normalized = text(state || turn?.state);
  return FINAL_STATES.has(normalized);
}

export function deriveTurnCapabilities(state = "", { canStop = false } = {}) {
  const normalized = text(state);
  const actionLocked = Boolean(normalized) && !isFinalTurnState(normalized);
  return {
    actionLocked,
    sending: actionLocked,
    canStop: normalized === FrontendRunState.PROCESSING && canStop === true,
    terminal: isFinalTurnState(normalized),
  };
}

function targetState(current = {}, event = {}) {
  const currentState = text(current.state);
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    const terminalState = text(event.authoritativeTurnState);
    return {
      [TURN_STATE.COMPLETED]: FrontendRunState.FRONTEND_COMPLETED,
      [TURN_STATE.STOP_COMPLETED]: FrontendRunState.USER_STOP_COMPLETED,
      [TURN_STATE.ACTION_FAILED]: FrontendRunState.ACTION_REQUEST_ERROR,
      [TURN_STATE.PROCESSING_FAILED]: FrontendRunState.PROCESSING_ERROR,
      [TURN_STATE.COMPLETION_FAILED]: FrontendRunState.COMPLETION_ERROR,
      [TURN_STATE.STOP_FAILED]: FrontendRunState.STOP_ERROR,
    }[terminalState] || currentState;
  }

  if (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE) {
    return projectAuthoritativeTurnState(event.state);
  }

  return currentState;
}

function reduceInteractionProjection(current = {}, event = {}) {
  const isTransport = [
    SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
  ].includes(event.type);
  const isActionStart = ACTION_START_EVENTS.has(event.type);
  const isStopStart = STOP_REQUEST_EVENTS.has(event.type);
  const isCompletionStart = event.type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED;
  const isSettled = [
    SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_SETTLED,
    SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_SETTLED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_SETTLED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_CLEARED,
  ].includes(event.type);
  const isLocalFailure = [
    SESSION_RUN_EVENT.LOCAL_FAILURE,
    SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
    SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
  ].includes(event.type);
  if (!isTransport && !isActionStart && !isStopStart && !isCompletionStart &&
      !isSettled && !isLocalFailure && event.type !== SESSION_RUN_EVENT.LOCAL_RESET) return null;
  const currentSessionId = text(current.sessionId);
  const currentTurnScopeId = text(current.turnScopeId);
  if ((currentSessionId && event.sessionId && currentSessionId !== text(event.sessionId)) ||
      (currentTurnScopeId && event.turnScopeId && currentTurnScopeId !== text(event.turnScopeId))) {
    return { applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION, current, event };
  }
  if (!current.state && current.commandPending !== true && !isActionStart) {
    return { applied: false, reason: TURN_TRANSITION_REASON.MISSING_STATE, current: null, event };
  }
  if (isActionStart && current.commandPending === true) {
    return { applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION, current, event };
  }
  const incomingTransportSeq = Number(event.transportSeq || event.seq || 0);
  if (isTransport && incomingTransportSeq > 0 &&
      Number(current.transportSeq || 0) > incomingTransportSeq) {
    return { applied: false, reason: TURN_TRANSITION_REASON.STALE_SEQUENCE, current, event };
  }
  if (isStopStart && current.canStop !== true) {
    return { applied: false, reason: TURN_TRANSITION_REASON.STOP_NOT_ALLOWED, current, event };
  }
  const transportState = isTransport ? text(event.backendState || event.state) : text(current.transportState);
  const transportFailed = isTransport && [
    BackendChannelState.ERROR,
    BackendChannelState.EXPIRED,
    BackendChannelState.NO_CONVERSATION,
  ].includes(transportState);
  const commandPending = event.type === SESSION_RUN_EVENT.LOCAL_RESET || isSettled || isLocalFailure
    ? false
    : (isActionStart || isStopStart || isCompletionStart ? true : current.commandPending === true);
  return {
    applied: true,
    reason: TURN_TRANSITION_REASON.APPLIED,
    event,
    next: {
      ...current,
      commandPending,
      pendingCommandId: commandPending ? text(event.commandId || current.pendingCommandId) : "",
      pendingCommandType: commandPending
        ? (isStopStart ? "stop" : isCompletionStart ? "completion" : text(current.pendingCommandType || "action"))
        : "",
      transportState,
      transportSeq: isTransport
        ? Math.max(Number(current.transportSeq || 0), incomingTransportSeq)
        : Number(current.transportSeq || 0),
      reconnecting: transportState === BackendChannelState.RECONNECTING,
      lastTransportError: transportFailed ? transportState : text(current.lastTransportError),
      action: isStopStart ? "stop" : text(current.action || event.action || "send"),
      commandId: text(event.commandId || current.commandId),
    },
  };
}

function isAllowed(current = {}, event = {}, nextState = "") {
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) return FINAL_STATES.has(nextState);
  // Authority has already validated the lifecycle transition before committing
  // the Envelope. The Client projects that complete fact; it must not require
  // locally observed predecessor events and become a second lifecycle authority.
  if (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE) return Boolean(nextState);
  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET) {
    return text(current.action) === "stop" &&
      text(current.state) === FrontendRunState.ACTION_REQUESTING &&
      nextState === FrontendRunState.IDLE;
  }
  const currentState = text(current.state);
  if (!currentState) {
    return nextState === FrontendRunState.ACTION_REQUESTING || event.authoritativeSnapshot === true;
  }
  if (isFinalTurnState(currentState, current)) return false;
  if (ACTION_START_EVENTS.has(event.type)) return false;
  if (nextState === currentState) return true;
  // A matching authoritative success is the sole lifecycle path allowed to
  // enter a terminal state. Do this check before the generic terminal guard;
  // otherwise turn.completed/turn.stop_completed would be rejected merely
  // because their target is final, while all unrelated transitions remain
  // locked below.
  if (FINAL_STATES.has(nextState)) return false;
  if (nextState === FrontendRunState.ACTION_REQUESTING) {
    return currentState === FrontendRunState.PROCESSING && (
      STOP_REQUEST_EVENTS.has(event.type) ||
      (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE &&
        text(event.eventType) === TURN_EVENT.STOP_ACCEPTED)
    );
  }
  if (nextState === FrontendRunState.PROCESSING) {
    return currentState === FrontendRunState.ACTION_REQUESTING && text(current.action) !== "stop";
  }
  if (nextState === FrontendRunState.FRONTEND_COMPLETION_REQUESTING) return currentState === FrontendRunState.PROCESSING;
  if (nextState === FrontendRunState.FRONTEND_COMPLETED) return currentState === FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
  if (nextState === FrontendRunState.USER_STOPPING) {
    return (currentState === FrontendRunState.ACTION_REQUESTING && text(current.action) === "stop") ||
      (currentState === FrontendRunState.PROCESSING && [
        BackendChannelState.STOPPING,
        BackendChannelState.USER_STOPPED,
      ].includes(text(event.backendState || event.raw?.state)));
  }
  if (nextState === FrontendRunState.USER_STOP_COMPLETED) {
    // Transport USER_STOPPED is only an observation. The terminal stop state
    // must be committed by an authoritative lifecycle/terminal event.
    if (![SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, SESSION_RUN_EVENT.TERMINAL_RESOLVED].includes(event.type)) {
      return false;
    }
    return currentState === FrontendRunState.USER_STOPPING ||
      (currentState === FrontendRunState.ACTION_REQUESTING && text(current.action) === "stop") ||
      currentState === FrontendRunState.PROCESSING;
  }
  return event.authoritativeSnapshot === true;
}

export function reduceTurnRuntimeEvent(current = null, rawEvent = {}) {
  const event = normalizeSessionRunEvent(rawEvent);
  const isTransportProjection = [
    SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
  ].includes(event.type);
  const transportSeq = isTransportProjection
    ? Number(event.transportSeq || event.seq || 0)
    : Number(event.transportSeq || 0);
  const eventSeq = Number(event.lifecycleSeq || event.seq || 0);
  const eventRevision = Number(event.revision || 0);
  const enrichesProjectedTerminal = current &&
    event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED &&
    current.terminalResolved !== true;
  if (current && isFinalTurnState(current.state, current) && !enrichesProjectedTerminal) {
    return { applied: false, reason: TURN_TRANSITION_REASON.TERMINAL_LOCKED, current, event };
  }
  const interaction = reduceInteractionProjection(current || {}, event);
  if (interaction) return interaction;
  if (current && current.terminalResolved === true &&
      event.type !== SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    return { applied: false, reason: TURN_TRANSITION_REASON.TERMINAL_LOCKED, current, event };
  }
  const currentComparableSeq = [
    SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
    SESSION_RUN_EVENT.TERMINAL_RESOLVED,
  ].includes(event.type)
    ? Number(current?.lifecycleSeq || 0)
    : Number(current?.seq || 0);
  if (current && eventSeq > 0 && currentComparableSeq > eventSeq) {
    return { applied: false, reason: TURN_TRANSITION_REASON.STALE_SEQUENCE, current, event };
  }
  const isFirstSameRevisionTerminalResolution = current &&
    event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED &&
    current.terminalResolved !== true &&
    eventRevision > 0 &&
    Number(current.revision || 0) === eventRevision;
  if (current && eventRevision > 0 && Number(current.revision || 0) >= eventRevision &&
      !isFirstSameRevisionTerminalResolution) {
    return { applied: false, reason: TURN_TRANSITION_REASON.STALE_REVISION, current, event };
  }
  const authoritativeCommit = event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
    ? { completionCommitId: text(event.completionCommitId), summaryVersion: Number(event.summaryVersion || 0), revision: eventRevision }
    : current?.authoritativeCompletionCommit || null;
  const state = targetState(current || {}, event);
  if (!state) return { applied: false, reason: TURN_TRANSITION_REASON.MISSING_STATE, current, event };
  const action = event.type === SESSION_RUN_EVENT.LOCAL_RESET
    ? "send"
    : STOP_REQUEST_EVENTS.has(event.type)
    ? "stop"
    : String(event.action || current?.action || "send").trim();
  const lifecycleEventType = event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE
    ? String(event.eventType || "").trim()
    : String(current?.lifecycleEventType || "").trim();
  const commandId = event.type === SESSION_RUN_EVENT.LOCAL_RESET
    ? ""
    : String(event.commandId || current?.commandId || "").trim();
  const candidate = {
    ...(current || {}),
    action,
    finalizeIntent: event.finalizeIntent || current?.finalizeIntent || null,
  };
  if (!isAllowed(current || {}, event, state)) {
    return { applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION, current, event };
  }
  const backendState = text(event.backendState || current?.backendState);
  const capabilities = deriveTurnCapabilities(state, {
    canStop: event.raw?.capabilities?.canStop === true,
  });
  const terminal = state === FrontendRunState.FRONTEND_COMPLETED
    ? "completed"
    : state === FrontendRunState.USER_STOP_COMPLETED
      ? "user_stopped"
      : event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED && [
          FrontendRunState.ACTION_REQUEST_ERROR,
          FrontendRunState.PROCESSING_ERROR,
          FrontendRunState.COMPLETION_ERROR,
          FrontendRunState.STOP_ERROR,
        ].includes(state)
        ? "error"
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
      commandId,
      lifecycleEventType,
      terminal,
      canStop: capabilities.canStop,
      backendState,
      seq: Math.max(Number(current?.seq || 0), eventSeq),
      transportSeq: Math.max(Number(current?.transportSeq || 0), transportSeq),
      lifecycleSeq: [SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, SESSION_RUN_EVENT.TERMINAL_RESOLVED].includes(event.type)
        ? Math.max(Number(current?.lifecycleSeq || 0), Number(event.lifecycleSeq || event.seq || 0))
        : Number(current?.lifecycleSeq || 0),
      revision: Math.max(Number(current?.revision || 0), eventRevision),
      lifecycleObserved: current?.lifecycleObserved === true ||
        [SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, SESSION_RUN_EVENT.TERMINAL_RESOLVED].includes(event.type),
      commandPending: false,
      pendingCommandId: "",
      pendingCommandType: "",
      authoritativeCompletionCommit: authoritativeCommit,
      authority: event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? event.authority
        : current?.authority,
      terminalResolved: event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED ||
        current?.terminalResolved === true,
      terminalMaterialization: event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? event.materialization
        : current?.terminalMaterialization || null,
      finalizeIntent: candidate.finalizeIntent,
      failure: [SESSION_RUN_EVENT.TERMINAL_RESOLVED, SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE].includes(event.type)
        ? event.failure
        : current?.failure || null,
    },
  };
}
