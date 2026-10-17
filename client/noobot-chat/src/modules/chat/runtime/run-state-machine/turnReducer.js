/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_CHANNEL_STATE, FrontendRunState, SESSION_RUN_EVENT } from "./constants.js";
import {
  AUTHORITATIVE_EVENT_TYPES,
  normalizeSessionRunEvent,
  TRANSPORT_EVENT_TYPES,
} from "./eventNormalization.js";
import { deriveTurnEventType, TURN_EVENT } from "@noobot/session-protocol";
import {
  projectAuthoritativeTerminalTurnState,
  projectAuthoritativeTurnState,
} from "./authoritativeTurnProjection.js";
import { resolveTurnRuntimeTerminal, TURN_RUNTIME_TERMINAL } from "./turnTerminal.js";
import { text } from "@noobot/shared/value";

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
const SETTLED_EVENTS = new Set([
  SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_SETTLED,
  SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_SETTLED,
  SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_SETTLED,
  SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_CLEARED,
]);
const LOCAL_FAILURE_EVENTS = new Set([
  SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
  SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
]);
const TRANSPORT_FAILURE_STATES = new Set([
  AGENT_CHANNEL_STATE.ERROR,
  AGENT_CHANNEL_STATE.EXPIRED,
  AGENT_CHANNEL_STATE.NO_CONVERSATION,
]);

function lowerToken(value) {
  return text(value).toLowerCase();
}

export function isFinalTurnState(state = "", turn = {}) {
  return FINAL_STATES.has(lowerToken(state || turn.state));
}

export function deriveTurnCapabilities(state = "", { canStop = false } = {}) {
  const normalized = lowerToken(state);
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
      projectAuthoritativeTerminalTurnState(event.authoritativeTurnState) ||
      lowerToken(current.state)
    );
  }
  if (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE) {
    return projectAuthoritativeTurnState(event.state);
  }
  return lowerToken(current.state);
}

function classifyInteraction(event) {
  return {
    transport: TRANSPORT_EVENT_TYPES.has(event.type),
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
  const incomingSeq = event.transportSeq;
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
  return lowerToken(current.pendingCommandType || "action");
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
  const incomingSeq = event.transportSeq;
  const transportState = kind.transport
    ? lowerToken(event.backendState || event.state)
    : lowerToken(current.transportState);
  const commandPending = resolveCommandPending(current, kind);
  return {
    ...current,
    commandPending,
    pendingCommandId: commandPending ? text(event.commandId || current.pendingCommandId) : "",
    pendingCommandType: resolvePendingCommandType(current, kind, commandPending),
    transportState,
    transportSeq: resolveTransportSequence(current, kind, incomingSeq),
    reconnecting: transportState === AGENT_CHANNEL_STATE.RECONNECTING,
    lastTransportError:
      kind.transport && TRANSPORT_FAILURE_STATES.has(transportState)
        ? transportState
        : text(current.lastTransportError),
    action: kind.stopStart ? "stop" : lowerToken(current.action || event.action || "send"),
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
    lowerToken(event.eventType) === TURN_EVENT.STOP_ACCEPTED
  );
}

function allowsUserStopping(currentState, current, event) {
  if (
    currentState === FrontendRunState.ACTION_REQUESTING &&
    lowerToken(current.action) === "stop"
  ) {
    return true;
  }
  return (
    currentState === FrontendRunState.PROCESSING &&
    new Set([AGENT_CHANNEL_STATE.STOPPING, AGENT_CHANNEL_STATE.USER_STOPPED]).has(
      lowerToken(event.backendState || event.raw?.state),
    )
  );
}

function allowsUserStopCompleted(currentState, current, event) {
  if (!AUTHORITATIVE_EVENT_TYPES.has(event.type)) return false;
  if (currentState === FrontendRunState.USER_STOPPING) return true;
  if (currentState === FrontendRunState.PROCESSING) return true;
  return (
    currentState === FrontendRunState.ACTION_REQUESTING && lowerToken(current.action) === "stop"
  );
}

function isAllowed(current, event, nextState) {
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) return FINAL_STATES.has(nextState);
  if (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE) return Boolean(nextState);
  const currentState = lowerToken(current.state);
  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET) {
    return (
      lowerToken(current.action) === "stop" &&
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
    return (
      currentState === FrontendRunState.ACTION_REQUESTING && lowerToken(current.action) !== "stop"
    );
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

function orderingRejection(current, event, eventRevision) {
  if (!current) return "";
  if (current.terminalResolved === true && event.type !== SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    return TURN_TRANSITION_REASON.TERMINAL_LOCKED;
  }
  if (
    AUTHORITATIVE_EVENT_TYPES.has(event.type) &&
    event.lifecycleSeq > 0 &&
    Number(current.lifecycleSeq || 0) > event.lifecycleSeq
  ) {
    return TURN_TRANSITION_REASON.STALE_SEQUENCE;
  }
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
      ? text(event.eventType)
      : event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? deriveTurnEventType(event.authoritativeTurnState, { action })
        : text(currentValue.lifecycleEventType);
  return {
    action,
    lifecycleEventType,
    commandId:
      event.type === SESSION_RUN_EVENT.LOCAL_RESET
        ? ""
        : text(event.commandId || currentValue.commandId),
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
  const mappedTerminal = resolveTurnRuntimeTerminal(state);
  if (mappedTerminal) return mappedTerminal;
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) return TURN_RUNTIME_TERMINAL.ERROR;
  return capabilities.terminal ? TURN_RUNTIME_TERMINAL.ERROR : null;
}

function projectAuthorityFields(currentValue, event) {
  const terminalResolution = event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED;
  return {
    authority: terminalResolution ? event.authority : currentValue.authority,
    terminalResolved: terminalResolution || currentValue.terminalResolved === true,
  };
}

function projectNextTurn(current, event, facts, state, sequences) {
  const currentValue = current || {};
  const eventRaw = event.raw || {};
  const rawCapabilities = eventRaw.capabilities || {};
  const capabilities = deriveTurnCapabilities(state, {
    canStop: rawCapabilities.canStop === true,
  });
  const authoritative = AUTHORITATIVE_EVENT_TYPES.has(event.type);
  return {
    ...currentValue,
    state,
    action: facts.action,
    commandId: facts.commandId,
    lifecycleEventType: facts.lifecycleEventType,
    terminal: resolveTerminal(state, event, capabilities),
    canStop: capabilities.canStop,
    backendState: lowerToken(event.backendState || currentValue.backendState),
    transportSeq: Math.max(Number(currentValue.transportSeq || 0), sequences.transportSeq),
    lifecycleSeq: authoritative
      ? Math.max(Number(currentValue.lifecycleSeq || 0), event.lifecycleSeq)
      : Number(currentValue.lifecycleSeq || 0),
    revision: Math.max(Number(currentValue.revision || 0), sequences.eventRevision),
    lifecycleObserved: currentValue.lifecycleObserved === true || authoritative,
    commandPending: false,
    pendingCommandId: "",
    pendingCommandType: "",
    authoritativeCompletionCommit: facts.authoritativeCommit,
    ...projectAuthorityFields(currentValue, event),
    finalizeIntent: event.finalizeIntent || currentValue.finalizeIntent || null,
    phase: authoritative ? event.phase : currentValue.phase || "",
    failure: authoritative ? event.failure : currentValue.failure || null,
  };
}

export function reduceTurnRuntimeEvent(current = null, rawEvent = {}) {
  const event = normalizeSessionRunEvent(rawEvent);
  const sequences = {
    transportSeq: event.transportSeq,
    eventRevision: Number(event.revision || 0),
  };
  const terminalReason = initialTerminalRejection(current, event);
  if (terminalReason) return { applied: false, reason: terminalReason, current, event };
  const interaction = reduceInteractionProjection(current || {}, event);
  if (interaction) return interaction;
  const orderingReason = orderingRejection(current, event, sequences.eventRevision);
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
