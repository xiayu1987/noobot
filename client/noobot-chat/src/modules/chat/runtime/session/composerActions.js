/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureId } from "../../../../shared/identity/secureIdentity.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { resolveSessionTurnRuntime } from "../run-state-machine/turnRuntimeRegistry.js";
import { logStateMachineDebug } from "../../../debug/loggers/stateMachineLogger.js";

export function createComposerActions({
  composerActionState,
  turnRuntimeRegistry,
  resolveActiveSessionIdentity,
  resolveActiveTurnScopeIdentity,
  submitTurnRuntimeEvent,
  send,
  stopSending,
  notify,
  translate,
}) {
  function createTurnScopeId() {
    return createSecureId("client-turn");
  }

  async function sendWithComposerActionState(...args) {
    const sessionRuntimeIdValue = resolveActiveSessionIdentity();
    const currentTurn = resolveSessionTurnRuntime(
      turnRuntimeRegistry.value,
      sessionRuntimeIdValue,
      resolveActiveTurnScopeIdentity(),
    );
    const stoppedTurn = currentTurn?.terminal === "user_stopped" ? currentTurn : null;
    const resumeDialogProcessId = String(stoppedTurn?.dialogProcessId || "").trim();
    const resumeTurnScopeId = String(stoppedTurn?.turnScopeId || "").trim();
    const resumeSessionId = resolveActiveSessionIdentity();
    const isContinueFromUserStopped = Boolean(
      stoppedTurn && resumeDialogProcessId && resumeTurnScopeId,
    );
    logStateMachineDebug("stateMachine.continue.source.selected", () => ({
      sessionId: resumeSessionId,
      selectedTurnScopeId: resumeTurnScopeId,
      selectedDialogProcessId: resumeDialogProcessId,
      selectedSequence: Number(stoppedTurn?.lifecycleSeq || stoppedTurn?.seq || 0),
      selectedContinuedByTurnScopeId: String(stoppedTurn?.continuedByTurnScopeId || "").trim(),
      candidates: Object.values(turnRuntimeRegistry.value?.sessions?.[resumeSessionId]?.turns || {})
        .filter((turn) => turn?.terminal === "user_stopped")
        .map((turn) => ({
          turnScopeId: String(turn?.turnScopeId || "").trim(),
          dialogProcessId: String(turn?.dialogProcessId || "").trim(),
          sequence: Number(turn?.lifecycleSeq || turn?.seq || 0),
          continuedByTurnScopeId: String(turn?.continuedByTurnScopeId || "").trim(),
          continuationSourceTurnScopeId: String(turn?.continuationSource?.turnScopeId || "").trim(),
        })),
    }));
    if (currentTurn?.terminal === "user_stopped" && !isContinueFromUserStopped) {
      notify?.({
        type: "warning",
        message:
          translate("chat.sessionStateOutOfSync") ||
          "Session state is out of sync. Refresh and try again.",
      });
      return false;
    }
    const composerEventType = isContinueFromUserStopped
      ? SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED
      : SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED;
    const composerSettledEventType = isContinueFromUserStopped
      ? SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_SETTLED
      : SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_SETTLED;
    const continuingTurnScopeId = isContinueFromUserStopped ? createTurnScopeId() : "";
    submitTurnRuntimeEvent({
      type: composerEventType,
      sessionId: isContinueFromUserStopped ? resumeSessionId : undefined,
      turnScopeId: continuingTurnScopeId || undefined,
      continuationSource: isContinueFromUserStopped
        ? {
            dialogProcessId: resumeDialogProcessId,
            turnScopeId: resumeTurnScopeId,
          }
        : null,
      source: "use_chat_session",
    });
    try {
      const [options = {}, ...restArgs] = args;
      const sendOptions = isContinueFromUserStopped
        ? {
            ...(options && typeof options === "object" ? options : {}),
            composerRequestStarted: true,
            continueFromUserStopped: true,
            turnScopeId: continuingTurnScopeId,
            resumeDialogProcessId,
            resumeTurnScopeId,
          }
        : {
            ...(options && typeof options === "object" ? options : {}),
            composerRequestStarted: true,
          };
      return await send(sendOptions, ...restArgs);
    } finally {
      submitTurnRuntimeEvent({
        type: composerSettledEventType,
        source: "use_chat_session",
      });
    }
  }

  function stopSendingWithComposerActionState(...args) {
    const explicitExecutionId = String(args[0] || "").trim();
    if (!explicitExecutionId && !composerActionState.value.canStop) return false;
    const requested = stopSending(...args);
    return requested;
  }

  return { sendWithComposerActionState, stopSendingWithComposerActionState };
}
