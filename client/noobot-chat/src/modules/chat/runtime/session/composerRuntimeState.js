/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import {
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
} from "../run-state-machine/turnRuntimeRegistry.js";

export function createComposerRuntimeState({
  turnRuntimeRegistry,
  resolveActiveSessionIdentity,
  resolveActiveTurnScopeIdentity,
}) {
  const composerActionState = computed(() => {
    const sessionId = resolveActiveSessionIdentity();
    const turnScopeId = resolveActiveTurnScopeIdentity();
    const turn = resolveSessionTurnRuntime(turnRuntimeRegistry.value, sessionId, turnScopeId);
    const runtimeView = selectSessionTurnRuntime(turnRuntimeRegistry.value, sessionId, turnScopeId);
    const displayState = runtimeView.displayState;
    const userStopped = turn?.terminal === "user_stopped";
    const actionLocked = runtimeView.sending === true;
    // A locally submitted stop command is interaction state, not an
    // authoritative lifecycle transition. Keep showing the request as in
    // flight until the command settles or an authority event supersedes it,
    // without forcing the authoritative turn out of processing.
    const stopRequesting = turn?.commandPending === true && turn?.pendingCommandType === "stop";
    const awaitingStopSummary = displayState === "stopping";
    return {
      sendRequesting: displayState === "requesting" && turn?.action !== "stop",
      continueRequesting: false,
      stopRequesting,
      stopPendingUntilBackendReady: false,
      canStartNewSend: !actionLocked,
      canRetryMessage: !actionLocked,
      canDeleteMessage: !actionLocked,
      stopInFlight: stopRequesting || awaitingStopSummary,
      awaitingBackendStop: awaitingStopSummary,
      userStopped,
      primaryAction: userStopped ? "continue" : "send",
      canContinue: userStopped,
      canResend: userStopped,
      state: displayState,
      displayState,
      canStop: runtimeView.canStop,
    };
  });

  const activeSessionSending = computed(() => selectSessionTurnRuntime(
    turnRuntimeRegistry.value,
    resolveActiveSessionIdentity(),
    resolveActiveTurnScopeIdentity(),
  ).sending);
  const activeSessionCanStop = computed(() => composerActionState.value.canStop === true);

  return { composerActionState, activeSessionSending, activeSessionCanStop };
}
