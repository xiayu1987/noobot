/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createConnectionState({ locale = "" } = {}) {
  return {
    currentLocale: locale,
    isRunning: false,
    currentAbortController: null,
    currentRunMeta: null,
    currentRunTimeoutTimer: null,
    currentRunTimedOut: false,
    currentStopPayload: null,
    stopRequested: false,
    currentTurnScopeId: "",
    currentAbortSignal: null,
    currentRunHandle: null,
    currentLifecycleCommandId: "",
    currentLifecyclePhase: "",
  };
}

export function resetRunState(state) {
  if (!state) return;
  if (state.currentRunTimeoutTimer) {
    clearTimeout(state.currentRunTimeoutTimer);
    state.currentRunTimeoutTimer = null;
  }
  state.isRunning = false;
  state.currentAbortController = null;
  state.currentAbortSignal = null;
  state.currentRunHandle = null;
  state.currentRunMeta = null;
  state.currentRunTimedOut = false;
  state.currentStopPayload = null;
  state.stopRequested = false;
  state.currentTurnScopeId = "";
  state.currentLifecycleCommandId = "";
  state.currentLifecyclePhase = "";
}
