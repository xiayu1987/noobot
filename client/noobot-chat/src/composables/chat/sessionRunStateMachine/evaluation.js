/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState } from "./constants";
import { normalizeState } from "./normalize";

export function isTerminalSessionRunState(state = "") {
  return [
    FrontendRunState.FRONTEND_COMPLETED,
    BackendChannelState.ERROR,
    BackendChannelState.USER_STOPPED,
    FrontendRunState.CANCELLED,
    FrontendRunState.IDLE,
  ].includes(normalizeState(state));
}

export function isInFlightSessionRunState(state = "") {
  return [
    BackendChannelState.SENDING,
    FrontendRunState.CONTINUE_REQUESTING,
    FrontendRunState.RESEND_REPLACING_TURN,
    FrontendRunState.RESEND_STREAMING,
    BackendChannelState.COMPLETED,
    FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
    FrontendRunState.STOP_REQUESTED,
    BackendChannelState.STOPPING,
    BackendChannelState.RECONNECTING,
    BackendChannelState.INTERACTION_PENDING,
  ].includes(normalizeState(state));
}

export function isStopLockedSessionRunState(state = "") {
  return [FrontendRunState.STOP_REQUESTED, BackendChannelState.STOPPING].includes(normalizeState(state));
}

export function evaluateSessionRunState(stateSnapshot = {}) {
  const state = normalizeState(stateSnapshot?.state) || FrontendRunState.IDLE;
  const composerActionState = {
    sendRequesting: Boolean(stateSnapshot?.composerActionState?.sendRequesting),
    stopRequesting: Boolean(stateSnapshot?.composerActionState?.stopRequesting),
    stopPendingUntilBackendReady: Boolean(stateSnapshot?.composerActionState?.stopPendingUntilBackendReady),
    continueRequesting: Boolean(stateSnapshot?.composerActionState?.continueRequesting),
  };
  const backendCanStop = [
    BackendChannelState.SENDING,
    FrontendRunState.CONTINUE_REQUESTING,
    FrontendRunState.RESEND_REPLACING_TURN,
    FrontendRunState.RESEND_STREAMING,
    BackendChannelState.RECONNECTING,
    BackendChannelState.INTERACTION_PENDING,
  ].includes(state);
  const awaitingBackendStop = Boolean(
    composerActionState.stopRequesting ||
    composerActionState.stopPendingUntilBackendReady ||
    state === FrontendRunState.STOP_REQUESTED ||
    state === BackendChannelState.STOPPING,
  );
  const canStartNewSend = !awaitingBackendStop;
  return {
    state,
    composerActionState,
    sending: isInFlightSessionRunState(state),
    backendCanStop,
    canStop: backendCanStop || composerActionState.sendRequesting || composerActionState.continueRequesting || composerActionState.stopPendingUntilBackendReady,
    stopInFlight: awaitingBackendStop,
    awaitingBackendStop,
    canStartNewSend: canStartNewSend && !composerActionState.continueRequesting,
    canRetryMessage: canStartNewSend,
    canDeleteMessage: canStartNewSend,
    interactionSubmitting: state === BackendChannelState.INTERACTION_PENDING ? false : undefined,
    pendingInteractionPolicy: state === BackendChannelState.INTERACTION_PENDING ? "await_payload" : "unchanged",
    assistantStatus:
      state === BackendChannelState.STOPPING || state === FrontendRunState.STOP_REQUESTED
        ? "stopping"
        : state === FrontendRunState.RESEND_REPLACING_TURN
          ? "resend_replacing_turn"
          : state === FrontendRunState.RESEND_STREAMING
            ? "resend_streaming"
            : state === BackendChannelState.COMPLETED ||
                state === FrontendRunState.FRONTEND_COMPLETION_REQUESTING
              ? ""
        : state === BackendChannelState.RECONNECTING
          ? "reconnecting"
          : state === FrontendRunState.FRONTEND_COMPLETED
            ? "generated"
            : [BackendChannelState.USER_STOPPED, FrontendRunState.CANCELLED].includes(state)
              ? "user_stopped"
              : state === BackendChannelState.ERROR
                ? "failed"
                : "",
    terminal: isTerminalSessionRunState(state),
    stopLocked: isStopLockedSessionRunState(state),
  };
}
