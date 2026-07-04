/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_RUN_STATE } from "./constants";
import { normalizeState } from "./normalize";

export function isTerminalSessionRunState(state = "") {
  return [
    SESSION_RUN_STATE.FRONTEND_COMPLETED,
    SESSION_RUN_STATE.ERROR,
    SESSION_RUN_STATE.STOPPED,
    SESSION_RUN_STATE.CANCELLED,
    SESSION_RUN_STATE.IDLE,
  ].includes(normalizeState(state));
}

export function isInFlightSessionRunState(state = "") {
  return [
    SESSION_RUN_STATE.SENDING,
    SESSION_RUN_STATE.RESEND_REPLACING_TURN,
    SESSION_RUN_STATE.RESEND_STREAMING,
    SESSION_RUN_STATE.BACKEND_COMPLETED,
    SESSION_RUN_STATE.FRONTEND_COMPLETION_REQUESTING,
    SESSION_RUN_STATE.STOP_REQUESTED,
    SESSION_RUN_STATE.STOPPING,
    SESSION_RUN_STATE.RECONNECTING,
    SESSION_RUN_STATE.INTERACTION_PENDING,
  ].includes(normalizeState(state));
}

export function isStopLockedSessionRunState(state = "") {
  return [SESSION_RUN_STATE.STOP_REQUESTED, SESSION_RUN_STATE.STOPPING].includes(normalizeState(state));
}

export function evaluateSessionRunState(stateSnapshot = {}) {
  const state = normalizeState(stateSnapshot?.state) || SESSION_RUN_STATE.IDLE;
  const composerActionState = {
    sendRequesting: Boolean(stateSnapshot?.composerActionState?.sendRequesting),
    stopRequesting: Boolean(stateSnapshot?.composerActionState?.stopRequesting),
    stopPendingUntilBackendReady: Boolean(stateSnapshot?.composerActionState?.stopPendingUntilBackendReady),
  };
  const backendCanStop = [
    SESSION_RUN_STATE.SENDING,
    SESSION_RUN_STATE.RESEND_REPLACING_TURN,
    SESSION_RUN_STATE.RESEND_STREAMING,
    SESSION_RUN_STATE.RECONNECTING,
    SESSION_RUN_STATE.INTERACTION_PENDING,
  ].includes(state);
  const awaitingBackendStop = Boolean(
    composerActionState.stopRequesting ||
    composerActionState.stopPendingUntilBackendReady ||
    state === SESSION_RUN_STATE.STOP_REQUESTED ||
    state === SESSION_RUN_STATE.STOPPING,
  );
  const canStartNewSend = !awaitingBackendStop;
  return {
    state,
    composerActionState,
    sending: isInFlightSessionRunState(state),
    backendCanStop,
    canStop: backendCanStop || composerActionState.sendRequesting || composerActionState.stopPendingUntilBackendReady,
    stopInFlight: awaitingBackendStop,
    awaitingBackendStop,
    canStartNewSend,
    canRetryMessage: canStartNewSend,
    canDeleteMessage: canStartNewSend,
    interactionSubmitting: state === SESSION_RUN_STATE.INTERACTION_PENDING ? false : undefined,
    pendingInteractionPolicy: state === SESSION_RUN_STATE.INTERACTION_PENDING ? "await_payload" : "unchanged",
    assistantStatus:
      state === SESSION_RUN_STATE.STOPPING || state === SESSION_RUN_STATE.STOP_REQUESTED
        ? "stopping"
        : state === SESSION_RUN_STATE.RESEND_REPLACING_TURN
          ? "resend_replacing_turn"
          : state === SESSION_RUN_STATE.RESEND_STREAMING
            ? "resend_streaming"
            : state === SESSION_RUN_STATE.BACKEND_COMPLETED ||
                state === SESSION_RUN_STATE.FRONTEND_COMPLETION_REQUESTING
              ? ""
        : state === SESSION_RUN_STATE.RECONNECTING
          ? "reconnecting"
          : state === SESSION_RUN_STATE.FRONTEND_COMPLETED
            ? "generated"
            : [SESSION_RUN_STATE.STOPPED, SESSION_RUN_STATE.CANCELLED].includes(state)
              ? "stopped"
              : state === SESSION_RUN_STATE.ERROR
                ? "failed"
                : "",
    terminal: isTerminalSessionRunState(state),
    stopLocked: isStopLockedSessionRunState(state),
  };
}
