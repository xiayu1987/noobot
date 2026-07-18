/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FrontendRunState } from "./constants";
import { normalizeState } from "./normalize";
import { deriveTurnCapabilities } from "./turnReducer";

export function isTerminalSessionRunState(state = "") {
  return normalizeState(state) === FrontendRunState.IDLE;
}

export function isInFlightSessionRunState(state = "") {
  return [
    FrontendRunState.ACTION_REQUESTING,
    FrontendRunState.PROCESSING,
    FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
    FrontendRunState.USER_STOPPING,
  ].includes(normalizeState(state));
}

export function isStopLockedSessionRunState(state = "") {
  return normalizeState(state) === FrontendRunState.USER_STOPPING;
}

export function evaluateSessionRunState(stateSnapshot = {}) {
  const normalizedState = normalizeState(stateSnapshot?.state);
  const state = isInFlightSessionRunState(normalizedState)
    ? normalizedState
    : FrontendRunState.IDLE;
  const composerActionState = {
    sendRequesting: state === FrontendRunState.ACTION_REQUESTING,
    continueRequesting: false,
    stopRequesting: state === FrontendRunState.USER_STOPPING,
    stopPendingUntilBackendReady: false,
  };
  // Keep legacy evaluation consumers on the same domain capability rule as
  // the registry. A broad PROCESSING projection is not sufficient: only an
  // explicit backend SENDING fact is stoppable.
  const backendCanStop = deriveTurnCapabilities(state, {
    backendState: stateSnapshot?.backendState,
  }).canStop;
  const awaitingBackendStop = state === FrontendRunState.USER_STOPPING;
  // The state machine is the final action mutex.  Do not let a local composer
  // flag reopen send/resend/continue while the current run is still in flight
  // (including completion and stop-summary convergence).
  const actionLocked = state !== FrontendRunState.IDLE;
  const canStartNewSend = !actionLocked;
  return {
    state,
    composerActionState,
    sending: actionLocked,
    backendCanStop,
    canStop: backendCanStop && !awaitingBackendStop,
    stopInFlight: awaitingBackendStop,
    awaitingBackendStop,
    canStartNewSend: canStartNewSend && !composerActionState.continueRequesting,
    canRetryMessage: canStartNewSend,
    canDeleteMessage: canStartNewSend,
    interactionSubmitting: undefined,
    pendingInteractionPolicy: "unchanged",
    assistantStatus: state === FrontendRunState.USER_STOPPING ? "user_stopping" : "",
    terminal: isTerminalSessionRunState(state),
    stopLocked: isStopLockedSessionRunState(state),
  };
}
