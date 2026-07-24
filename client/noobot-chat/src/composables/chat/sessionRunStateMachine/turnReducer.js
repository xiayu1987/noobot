/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { normalizeSessionRunEvent } from "./eventNormalization";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/shared/turn-lifecycle-protocol";

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
  if ((normalized === FrontendRunState.COMPLETION_ERROR || normalized === FrontendRunState.STOP_ERROR) &&
      turn?.finalizeIntent?.retryable === true) {
    return false;
  }
  return FINAL_STATES.has(normalized);
}

export function deriveTurnCapabilities(state = "", { backendState = "", finalizeIntent = null } = {}) {
  const normalized = text(state);
  const normalizedBackendState = text(backendState);
  const actionLocked = Boolean(normalized) && !isFinalTurnState(normalized, { finalizeIntent });
  return {
    actionLocked,
    sending: actionLocked,
    // Stopping is an explicit backend capability, not a consequence of the
    // broad frontend PROCESSING projection. Reconnecting and interaction
    // waiting keep the action mutex but must never expose or accept stop.
    canStop: normalized === FrontendRunState.PROCESSING &&
      normalizedBackendState === BackendChannelState.SENDING,
    terminal: isFinalTurnState(normalized, { finalizeIntent }),
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

  const backendState = text(event.backendState || event.raw?.state || event.state);

  if (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE) {
    const lifecycleType = text(event.eventType);
    if (lifecycleType === TURN_EVENT.ACTION_ACCEPTED || lifecycleType === TURN_EVENT.STOP_ACCEPTED) {
      return FrontendRunState.ACTION_REQUESTING;
    }
    if (lifecycleType === TURN_EVENT.PROCESSING_STARTED) return FrontendRunState.PROCESSING;
    if (lifecycleType === TURN_EVENT.PROCESSING_COMPLETED) return FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
    if (lifecycleType === TURN_EVENT.STOP_PROCESSING_COMPLETED) return FrontendRunState.USER_STOPPING;
    // Terminal envelopes are invalidation notifications only. They do not
    // prove that this client has read and applied the committed terminal view.
    if (lifecycleType === TURN_EVENT.COMPLETED) return FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
    if (lifecycleType === TURN_EVENT.STOP_COMPLETED) return FrontendRunState.USER_STOPPING;
    if (lifecycleType === TURN_EVENT.FAILED) {
      // Terminal lifecycle envelopes are notifications only. Keep the action
      // mutex until the authoritative terminal read model is resolved.
      return currentState || FrontendRunState.ACTION_REQUESTING;
    }
  }

  // Transport, detail and local command failures are recovery signals, not
  // authoritative Turn outcomes. They must not manufacture one of the six
  // business terminal states; reconciliation through TERMINAL_RESOLVED owns
  // settlement and capability unlock.
  if ([
    SESSION_RUN_EVENT.LOCAL_FAILURE,
    SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
    SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
  ].includes(event.type)) return currentState;
  if (ACTION_START_EVENTS.has(event.type)) return FrontendRunState.ACTION_REQUESTING;
  // Stop is an action request too. It remains in the request phase until the
  // backend confirms that stopping has completed.
  if (STOP_REQUEST_EVENTS.has(event.type)) return FrontendRunState.ACTION_REQUESTING;
  if (event.type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED) {
    return FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
  }
  if ([SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE].includes(event.type)) {
    // Channel state is a transport projection, never a Turn phase fact. It may
    // refine capabilities inside an authoritative processing phase, but every
    // phase boundary is owned exclusively by BACKEND_TURN_LIFECYCLE.
    if ([
      BackendChannelState.SENDING,
      BackendChannelState.RECONNECTING,
      BackendChannelState.INTERACTION_PENDING,
    ].includes(backendState) && currentState === FrontendRunState.PROCESSING) {
      return FrontendRunState.PROCESSING;
    }
    // Compatibility is scoped to Turns that have never negotiated the
    // authoritative lifecycle protocol. Once a lifecycle envelope owns the
    // Turn, transport state can no longer move a business phase.
    if (current.lifecycleObserved !== true) {
      if (backendState === FrontendRunState.CANCELLED) return FrontendRunState.CANCELLED;
      if (backendState === BackendChannelState.SENDING) return FrontendRunState.PROCESSING;
      if (backendState === BackendChannelState.COMPLETED) return FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
      if (backendState === BackendChannelState.USER_STOPPED || backendState === BackendChannelState.STOPPING) {
        return FrontendRunState.USER_STOPPING;
      }
      if ([BackendChannelState.ERROR, BackendChannelState.EXPIRED, BackendChannelState.NO_CONVERSATION].includes(backendState)) {
        return failureStateFor(current);
      }
    }
    return currentState;
  }
  return text(event.state) || currentState;
}

function isAllowed(current = {}, event = {}, nextState = "") {
  if (event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED) return FINAL_STATES.has(nextState);
  // A locally rejected/expired stop command did not change the backend Turn.
  // It may only release the optimistic stop-request mutex; it must not create
  // a business failure terminal (which is owned by TERMINAL_RESOLVED).
  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET) {
    return text(current.action) === "stop" &&
      text(current.state) === FrontendRunState.ACTION_REQUESTING &&
      nextState === FrontendRunState.IDLE;
  }
  // Terminal Resolution is the only settlement authority. Notifications,
  // snapshots, legacy projections and local detail callbacks may discover or
  // advance a non-terminal phase, but can never enter a terminal state.
  if (FINAL_STATES.has(nextState)) return false;
  const currentState = text(current.state);
  if (!currentState) {
    // A terminal lifecycle envelope is only a resolution trigger. It cannot
    // create a Turn (or an optimistic action state) before the Turn identity
    // has been established by a local start or authoritative non-terminal
    // lifecycle event. In particular, an orphan turn.failed must be rejected
    // instead of falling through to ACTION_REQUESTING.
    if (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE &&
        [TURN_EVENT.COMPLETED, TURN_EVENT.STOP_COMPLETED, TURN_EVENT.FAILED].includes(text(event.eventType))) {
      return false;
    }
    return nextState === FrontendRunState.ACTION_REQUESTING || event.authoritativeSnapshot === true;
  }
  if (isFinalTurnState(currentState, current)) return false;
  // Send, resend and continue always create a new Turn. Once this Turn owns
  // the session action mutex, another action-start event must not be treated
  // as an idempotent same-state update.
  if (ACTION_START_EVENTS.has(event.type)) return false;
  if (nextState === currentState) return true;
  if (event.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE) {
    const lifecycleType = text(event.eventType);
    if (lifecycleType === TURN_EVENT.COMPLETED) {
      return currentState === FrontendRunState.FRONTEND_COMPLETION_REQUESTING ||
        (currentState === FrontendRunState.COMPLETION_ERROR && current.finalizeIntent?.retryable === true);
    }
    if (lifecycleType === TURN_EVENT.STOP_COMPLETED) {
      return currentState === FrontendRunState.USER_STOPPING ||
        (currentState === FrontendRunState.STOP_ERROR && current.finalizeIntent?.retryable === true);
    }
  }
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
  const isTransportProjection = [
    SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
  ].includes(event.type);
  // Transport sequence numbers belong to the socket/proxy stream and are not
  // comparable with authoritative Turn lifecycle sequence numbers.
  // Never write socket/reconnect ordering into the lifecycle sequence field.
  // Refresh commonly replays transport seq 100+ before terminal lifecycle seq
  // 4; comparing those domains rejects the authoritative terminal as stale.
  const transportSeq = isTransportProjection
    ? Number(event.transportSeq || event.seq || 0)
    : Number(event.transportSeq || 0);
  const eventSeq = isTransportProjection
    ? (current?.lifecycleObserved === true ? 0 : transportSeq)
    : Number(event.lifecycleSeq || event.seq || 0);
  const eventRevision = Number(event.revision || 0);
  if (current && isFinalTurnState(current.state, current)) {
    return { applied: false, reason: TURN_TRANSITION_REASON.TERMINAL_LOCKED, current, event };
  }
  // A Turn settled by the authoritative terminal service is monotonic even
  // when its terminal outcome is retryable. Only a newer authoritative
  // resolution may replace it; lifecycle/transport notifications cannot.
  if (current && current.terminalResolved === true &&
      event.type !== SESSION_RUN_EVENT.TERMINAL_RESOLVED) {
    return { applied: false, reason: TURN_TRANSITION_REASON.TERMINAL_LOCKED, current, event };
  }
  const currentComparableSeq = event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
    ? Number(current?.lifecycleSeq || 0)
    : Number(current?.seq || 0);
  if (current && eventSeq > 0 && currentComparableSeq > eventSeq) {
    return { applied: false, reason: TURN_TRANSITION_REASON.STALE_SEQUENCE, current, event };
  }
  // A snapshot is discovery/projection metadata and may already carry the
  // exact revision returned by the authoritative terminal service. Allow that
  // same revision to settle an unresolved Turn; all other events, and repeated
  // terminal resolutions, retain the strict monotonic guard.
  const isFirstSameRevisionTerminalResolution = current &&
    event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED &&
    current.terminalResolved !== true &&
    eventRevision > 0 &&
    Number(current.revision || 0) === eventRevision;
  if (current && eventRevision > 0 && Number(current.revision || 0) >= eventRevision &&
      !isFirstSameRevisionTerminalResolution) {
    return { applied: false, reason: TURN_TRANSITION_REASON.STALE_REVISION, current, event };
  }
  if (current && STOP_REQUEST_EVENTS.has(event.type) &&
    !deriveTurnCapabilities(current.state, { backendState: current.backendState }).canStop) {
    return { applied: false, reason: TURN_TRANSITION_REASON.STOP_NOT_ALLOWED, current, event };
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
  const candidate = {
    ...(current || {}),
    action,
    finalizeIntent: event.finalizeIntent || current?.finalizeIntent || null,
  };
  // Transition guards must inspect the pre-event Turn. LOCAL_RESET deliberately
  // changes the candidate action from `stop` back to `send`; passing candidate
  // here would therefore erase the very fact used to authorize the rollback
  // and leave the optimistic stop mutex stuck in ACTION_REQUESTING.
  if (!isAllowed(current || {}, event, state)) {
    return { applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION, current, event };
  }
  const backendState = text(event.backendState || current?.backendState);
  const capabilities = deriveTurnCapabilities(state, {
    backendState,
    finalizeIntent: candidate.finalizeIntent,
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
      authoritativeCompletionCommit: authoritativeCommit,
      // Only TERMINAL_RESOLVED may introduce terminal authority. Lifecycle,
      // transport and local-detail notifications retain the existing value and
      // therefore cannot settle the message projection or unlock capabilities.
      authority: event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? event.authority
        : current?.authority,
      terminalResolved: event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED ||
        current?.terminalResolved === true,
      terminalMaterialization: event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? event.materialization
        : current?.terminalMaterialization || null,
      finalizeIntent: candidate.finalizeIntent,
      failure: event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? event.failure
        : current?.failure || null,
    },
  };
}
