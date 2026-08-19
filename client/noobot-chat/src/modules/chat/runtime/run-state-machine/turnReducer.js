/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants.js";
import { normalizeSessionRunEvent } from "./eventNormalization.js";
import { deriveTurnEventType, TURN_EVENT, TURN_STATE } from "@noobot/session-protocol";
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
const TRANSPORT_EVENTS = new Set([
  SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
  SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
]);
const SETTLED_EVENTS = new Set([
  SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_SETTLED,
  SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_SETTLED,
  SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_SETTLED,
  SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_CLEARED,
]);
const LOCAL_FAILURE_EVENTS = new Set([
  SESSION_RUN_EVENT.LOCAL_FAILURE,
  SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
  SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
]);
const AUTHORITATIVE_EVENTS = new Set([
  SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
  SESSION_RUN_EVENT.TERMINAL_RESOLVED,
]);
const TRANSPORT_FAILURE_STATES = new Set([
  BackendChannelState.ERROR,
  BackendChannelState.EXPIRED,
  BackendChannelState.NO_CONVERSATION,
]);

function text(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function isFinalTurnState(state = "", turn = {}) {
  return FINAL_STATES.has(text(state || turn.state));
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

function targetState(current, event) {
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    return (
      {
        [TURN_STATE.COMPLETED]: FrontendRunState.FRONTEND_COMPLETED,
        [TURN_STATE.STOP_COMPLETED]: FrontendRunState.USER_STOP_COMPLETED,
        [TURN_STATE.ACTION_FAILED]: FrontendRunState.ACTION_REQUEST_ERROR,
        [TURN_STATE.PROCESSING_FAILED]: FrontendRunState.PROCESSING_ERROR,
        [TURN_STATE.COMPLETION_FAILED]: FrontendRunState.COMPLETION_ERROR,
        [TURN_STATE.STOP_FAILED]: FrontendRunState.STOP_ERROR,
      }[text(event.authoritativeTurnState)] || text(current.state)
    );
  }
  if (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE) {
    return projectAuthoritativeTurnState(event.state);
  }
  return text(current.state);
}

function classifyInteraction(event) {
  return {
    transport: TRANSPORT_EVENTS.has(event.type),
    actionStart: ACTION_START_EVENTS.has(event.type),
    stopStart: STOP_REQUEST_EVENTS.has(event.type),
    completionStart: event.type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED,
    settled: SETTLED_EVENTS.has(event.type),
    localFailure: LOCAL_FAILURE_EVENTS.has(event.type),
    reset: event.type === SESSION_RUN_EVENT.LOCAL_RESET,
  };
}

function isInteractionEvent(kind) {
  return Object.values(kind).some(Boolean);
}

function interactionRejection(current, event, kind) {
  const currentSessionId = text(current.sessionId);
  const currentTurnScopeId = text(current.turnScopeId);
  if (currentSessionId && event.sessionId && currentSessionId !== text(event.sessionId)) {
    return TURN_TRANSITION_REASON.ILLEGAL_TRANSITION;
  }
  if (currentTurnScopeId && event.turnScopeId && currentTurnScopeId !== text(event.turnScopeId)) {
    return TURN_TRANSITION_REASON.ILLEGAL_TRANSITION;
  }
  if (!current.state && current.commandPending !== true && !kind.actionStart) {
    return TURN_TRANSITION_REASON.MISSING_STATE;
  }
  if (kind.actionStart && current.commandPending === true) {
    return TURN_TRANSITION_REASON.ILLEGAL_TRANSITION;
  }
  const incomingSeq = Number(event.transportSeq || event.seq || 0);
  if (kind.transport && incomingSeq > 0 && Number(current.transportSeq || 0) > incomingSeq) {
    return TURN_TRANSITION_REASON.STALE_SEQUENCE;
  }
  if (kind.stopStart && current.canStop !== true) return TURN_TRANSITION_REASON.STOP_NOT_ALLOWED;
  return "";
}

function resolvePendingCommandType(current, kind, commandPending) {
  if (!commandPending) return "";
  if (kind.stopStart) return "stop";
  if (kind.completionStart) return "completion";
  return text(current.pendingCommandType || "action");
}

function resolveCommandPending(current, kind) {
  if (kind.reset || kind.settled || kind.localFailure) return false;
  if (kind.actionStart || kind.stopStart || kind.completionStart) return true;
  return current.commandPending === true;
}

function resolveTransportSequence(current, kind, incomingSeq) {
  const currentSeq = Number(current.transportSeq || 0);
  return kind.transport ? Math.max(currentSeq, incomingSeq) : currentSeq;
}

function projectInteraction(current, event, kind) {
  const incomingSeq = Number(event.transportSeq || event.seq || 0);
  const transportState = kind.transport
    ? text(event.backendState || event.state)
    : text(current.transportState);
  const commandPending = resolveCommandPending(current, kind);
  return {
    ...current,
    commandPending,
    pendingCommandId: commandPending ? text(event.commandId || current.pendingCommandId) : "",
    pendingCommandType: resolvePendingCommandType(current, kind, commandPending),
    transportState,
    transportSeq: resolveTransportSequence(current, kind, incomingSeq),
    reconnecting: transportState === BackendChannelState.RECONNECTING,
    lastTransportError:
      kind.transport && TRANSPORT_FAILURE_STATES.has(transportState)
        ? transportState
        : text(current.lastTransportError),
    action: kind.stopStart ? "stop" : text(current.action || event.action || "send"),
    commandId: text(event.commandId || current.commandId),
  };
}

function reduceInteractionProjection(current, event) {
  const kind = classifyInteraction(event);
  if (!isInteractionEvent(kind)) return null;
  const reason = interactionRejection(current, event, kind);
  if (reason) {
    return {
      applied: false,
      reason,
      current: reason === TURN_TRANSITION_REASON.MISSING_STATE ? null : current,
      event,
    };
  }
  return {
    applied: true,
    reason: TURN_TRANSITION_REASON.APPLIED,
    event,
    next: projectInteraction(current, event, kind),
  };
}

function allowsActionRequesting(currentState, current, event) {
  if (currentState !== FrontendRunState.PROCESSING) return false;
  if (STOP_REQUEST_EVENTS.has(event.type)) return true;
  return (
    event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE &&
    text(event.eventType) === TURN_EVENT.STOP_ACCEPTED
  );
}

function allowsUserStopping(currentState, current, event) {
  if (currentState === FrontendRunState.ACTION_REQUESTING && text(current.action) === "stop") {
    return true;
  }
  return (
    currentState === FrontendRunState.PROCESSING &&
    new Set([BackendChannelState.STOPPING, BackendChannelState.USER_STOPPED]).has(
      text(event.backendState || event.raw?.state),
    )
  );
}

function allowsUserStopCompleted(currentState, current, event) {
  if (!AUTHORITATIVE_EVENTS.has(event.type)) return false;
  if (currentState === FrontendRunState.USER_STOPPING) return true;
  if (currentState === FrontendRunState.PROCESSING) return true;
  return currentState === FrontendRunState.ACTION_REQUESTING && text(current.action) === "stop";
}

function isAllowed(current, event, nextState) {
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) return FINAL_STATES.has(nextState);
  if (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE) return Boolean(nextState);
  const currentState = text(current.state);
  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET) {
    return (
      text(current.action) === "stop" &&
      currentState === FrontendRunState.ACTION_REQUESTING &&
      nextState === FrontendRunState.IDLE
    );
  }
  if (!currentState)
    return nextState === FrontendRunState.ACTION_REQUESTING || event.authoritativeSnapshot === true;
  if (isFinalTurnState(currentState, current)) return false;
  if (ACTION_START_EVENTS.has(event.type)) return false;
  if (nextState === currentState) return true;
  if (FINAL_STATES.has(nextState)) return false;
  if (nextState === FrontendRunState.ACTION_REQUESTING)
    return allowsActionRequesting(currentState, current, event);
  if (nextState === FrontendRunState.PROCESSING)
    return currentState === FrontendRunState.ACTION_REQUESTING && text(current.action) !== "stop";
  if (nextState === FrontendRunState.FRONTEND_COMPLETION_REQUESTING)
    return currentState === FrontendRunState.PROCESSING;
  if (nextState === FrontendRunState.FRONTEND_COMPLETED)
    return currentState === FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
  if (nextState === FrontendRunState.USER_STOPPING)
    return allowsUserStopping(currentState, current, event);
  if (nextState === FrontendRunState.USER_STOP_COMPLETED)
    return allowsUserStopCompleted(currentState, current, event);
  return event.authoritativeSnapshot === true;
}

function initialTerminalRejection(current, event) {
  if (!current || !isFinalTurnState(current.state, current)) return "";
  const enrichesTerminal =
    event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED && current.terminalResolved !== true;
  return enrichesTerminal ? "" : TURN_TRANSITION_REASON.TERMINAL_LOCKED;
}

function orderingRejection(current, event, eventSeq, eventRevision) {
  if (!current) return "";
  if (current.terminalResolved === true && event.type !== SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    return TURN_TRANSITION_REASON.TERMINAL_LOCKED;
  }
  const currentSeq = AUTHORITATIVE_EVENTS.has(event.type)
    ? Number(current.lifecycleSeq || 0)
    : Number(current.seq || 0);
  if (eventSeq > 0 && currentSeq > eventSeq) return TURN_TRANSITION_REASON.STALE_SEQUENCE;
  const firstSameRevisionResolution =
    event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED &&
    current.terminalResolved !== true &&
    eventRevision > 0 &&
    Number(current.revision || 0) === eventRevision;
  if (
    eventRevision > 0 &&
    Number(current.revision || 0) >= eventRevision &&
    !firstSameRevisionResolution
  ) {
    return TURN_TRANSITION_REASON.STALE_REVISION;
  }
  return "";
}

function resolveProjectionFacts(current, event, eventRevision) {
  const currentValue = current || {};
  const action =
    event.type === SESSION_RUN_EVENT.LOCAL_RESET
      ? "send"
      : STOP_REQUEST_EVENTS.has(event.type)
        ? "stop"
        : String(event.action || currentValue.action || "send").trim();
  const lifecycleEventType =
    event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE
      ? String(event.eventType || "").trim()
      : event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? deriveTurnEventType(event.authoritativeTurnState, { action })
        : String(currentValue.lifecycleEventType || "").trim();
  return {
    action,
    lifecycleEventType,
    commandId:
      event.type === SESSION_RUN_EVENT.LOCAL_RESET
        ? ""
        : String(event.commandId || currentValue.commandId || "").trim(),
    authoritativeCommit:
      event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? {
            completionCommitId: text(event.completionCommitId),
            summaryVersion: Number(event.summaryVersion || 0),
            revision: eventRevision,
          }
        : currentValue.authoritativeCompletionCommit || null,
  };
}

function resolveTerminal(state, event, capabilities) {
  if (state === FrontendRunState.FRONTEND_COMPLETED) return "completed";
  if (state === FrontendRunState.USER_STOP_COMPLETED) return "user_stopped";
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) return "error";
  return capabilities.terminal ? "error" : null;
}

function projectAuthorityFields(currentValue, event) {
  const terminalResolution = event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED;
  return {
    authority: terminalResolution ? event.authority : currentValue.authority,
    terminalResolved: terminalResolution || currentValue.terminalResolved === true,
    terminalMaterialization: terminalResolution
      ? event.materialization
      : currentValue.terminalMaterialization || null,
  };
}

function projectNextTurn(current, event, facts, state, sequences) {
  const currentValue = current || {};
  const eventRaw = event.raw || {};
  const rawCapabilities = eventRaw.capabilities || {};
  const capabilities = deriveTurnCapabilities(state, {
    canStop: rawCapabilities.canStop === true,
  });
  const authoritative = AUTHORITATIVE_EVENTS.has(event.type);
  return {
    ...currentValue,
    state,
    action: facts.action,
    commandId: facts.commandId,
    lifecycleEventType: facts.lifecycleEventType,
    terminal: resolveTerminal(state, event, capabilities),
    canStop: capabilities.canStop,
    backendState: text(event.backendState || currentValue.backendState),
    seq: Math.max(Number(currentValue.seq || 0), sequences.eventSeq),
    transportSeq: Math.max(Number(currentValue.transportSeq || 0), sequences.transportSeq),
    lifecycleSeq: authoritative
      ? Math.max(
          Number(currentValue.lifecycleSeq || 0),
          Number(event.lifecycleSeq || event.seq || 0),
        )
      : Number(currentValue.lifecycleSeq || 0),
    revision: Math.max(Number(currentValue.revision || 0), sequences.eventRevision),
    lifecycleObserved: currentValue.lifecycleObserved === true || authoritative,
    commandPending: false,
    pendingCommandId: "",
    pendingCommandType: "",
    authoritativeCompletionCommit: facts.authoritativeCommit,
    ...projectAuthorityFields(currentValue, event),
    finalizeIntent: event.finalizeIntent || currentValue.finalizeIntent || null,
    failure: AUTHORITATIVE_EVENTS.has(event.type) ? event.failure : currentValue.failure || null,
  };
}

export function reduceTurnRuntimeEvent(current = null, rawEvent = {}) {
  const event = normalizeSessionRunEvent(rawEvent);
  const transportProjection = TRANSPORT_EVENTS.has(event.type);
  const sequences = {
    transportSeq: transportProjection
      ? Number(event.transportSeq || event.seq || 0)
      : Number(event.transportSeq || 0),
    eventSeq: Number(event.lifecycleSeq || event.seq || 0),
    eventRevision: Number(event.revision || 0),
  };
  const terminalReason = initialTerminalRejection(current, event);
  if (terminalReason) return { applied: false, reason: terminalReason, current, event };
  const interaction = reduceInteractionProjection(current || {}, event);
  if (interaction) return interaction;
  const orderingReason = orderingRejection(
    current,
    event,
    sequences.eventSeq,
    sequences.eventRevision,
  );
  if (orderingReason) return { applied: false, reason: orderingReason, current, event };
  const facts = resolveProjectionFacts(current, event, sequences.eventRevision);
  const state = targetState(current || {}, event);
  if (!state)
    return { applied: false, reason: TURN_TRANSITION_REASON.MISSING_STATE, current, event };
  if (!isAllowed(current || {}, event, state)) {
    return { applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION, current, event };
  }
  return {
    applied: true,
    reason: TURN_TRANSITION_REASON.APPLIED,
    event,
    next: projectNextTurn(current, event, facts, state, sequences),
  };
}
