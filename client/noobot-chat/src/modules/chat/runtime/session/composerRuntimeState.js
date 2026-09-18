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
import {
  COMPOSER_PRIMARY_ACTION,
  isSendBlockingStatusStepState,
  resolveComposerPrimaryAction,
  resolveComposerPrimaryActionLabelKey,
  resolveStatusStepLabelKey,
  STATUS_STEP_STAGE,
  TURN_PENDING_COMMAND_TYPE,
  TURN_RUNTIME_TERMINAL,
} from "../sessionRunStateMachine.js";

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
    const primaryAction = resolveComposerPrimaryAction(turn?.terminal);
    const userStopped = turn?.terminal === TURN_RUNTIME_TERMINAL.USER_STOPPED;
    const actionLocked = runtimeView.sending === true;

    const stopRequesting =
      turn?.commandPending === true && turn?.pendingCommandType === TURN_PENDING_COMMAND_TYPE.STOP;
    const awaitingStopSummary = displayState === STATUS_STEP_STAGE.STOPPING;
    const canInterject = Boolean(
      displayState === STATUS_STEP_STAGE.SENDING &&
      sessionId &&
      runtimeView.turnScopeId &&
      runtimeView.dialogProcessId &&
      !turn?.terminal,
    );
    return {
      sendRequesting:
        displayState === STATUS_STEP_STAGE.REQUESTING &&
        turn?.action !== TURN_PENDING_COMMAND_TYPE.STOP,
      continueRequesting: false,
      stopRequesting,
      stopPendingUntilBackendReady: false,
      canStartNewSend: !actionLocked,
      canRetryMessage: !actionLocked,
      canDeleteMessage: !actionLocked,
      stopInFlight: stopRequesting || awaitingStopSummary,
      awaitingBackendStop: awaitingStopSummary,
      userStopped,
      primaryAction,
      canContinue: primaryAction === COMPOSER_PRIMARY_ACTION.CONTINUE,
      canResend: primaryAction === COMPOSER_PRIMARY_ACTION.CONTINUE,
      canInterject,
      state: displayState,
      displayState,
      actionLabelKey: displayState
        ? resolveStatusStepLabelKey(displayState)
        : resolveComposerPrimaryActionLabelKey(primaryAction),
      sendBlocked: isSendBlockingStatusStepState(displayState),
      canStop: runtimeView.canStop,
    };
  });

  const activeSessionSending = computed(
    () =>
      selectSessionTurnRuntime(
        turnRuntimeRegistry.value,
        resolveActiveSessionIdentity(),
        resolveActiveTurnScopeIdentity(),
      ).sending,
  );
  const activeSessionCanStop = computed(() => composerActionState.value.canStop === true);

  return { composerActionState, activeSessionSending, activeSessionCanStop };
}
