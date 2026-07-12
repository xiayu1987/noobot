/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Create the mutable per-connection run state container.
 *
 * All fields that the message handler, event dispatch, terminal finalizers and
 * the socket close handler need to share are grouped here so the state can be
 * threaded through the extracted modules by reference instead of a large set of
 * closure-scoped `let` bindings.
 *
 * @param {{ locale?: string }} [options]
 * @returns {{
 *   currentLocale: string,
 *   isRunning: boolean,
 *   currentAbortController: AbortController | null,
 *   currentRunMeta: object | null,
 *   currentRunTimeoutTimer: ReturnType<typeof setTimeout> | null,
 *   currentRunTimedOut: boolean,
 *   currentStopPayload: object | null,
 *   stopRequested: boolean,
 *   currentTurnScopeId: string,
 *   currentAbortSignal: AbortSignal | null,
 *   currentRunHandle: object | null,
 * }}
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
  };
}

/**
 * Reset the mutable run state after a run message lifecycle has settled.
 * Mirrors the cleanup previously inlined in the message handler `finally` block.
 *
 * @param {ReturnType<typeof createConnectionState>} state
 */
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
}
