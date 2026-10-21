/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureId } from "@noobot/shared/secure-identity";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { resolveSessionTurnRuntime } from "../run-state-machine/turnRuntimeRegistry.js";
import { logStateMachineDebug } from "../../../debug/loggers/stateMachineLogger.js";
import { createTurnInterjectionCommand } from "@noobot/agent-transport-protocol";
import { text } from "@noobot/shared/value";

export function createComposerActions({
  composerActionState,
  input,
  turnRuntimeRegistry,
  resolveActiveSessionIdentity,
  resolveActiveTurnScopeIdentity,
  submitTurnRuntimeEvent,
  waitForSessionConnectorState,
  send,
  requestJson,
  stopSending,
  notify,
  translate,
}) {
  function createTurnScopeId() {
    return createSecureId("client-turn");
  }

  async function sendInterjection(currentTurn) {
    const message = text(input.value);
    if (!message) return false;
    const command = createTurnInterjectionCommand({
      commandId: createSecureId("command"),
      identity: {
        sessionId: currentTurn.sessionId,
        parentSessionId: currentTurn.parentSessionId,
        dialogProcessId: currentTurn.dialogProcessId,
        parentDialogProcessId: currentTurn.parentDialogProcessId,
        turnScopeId: currentTurn.turnScopeId,
      },
      interaction: { message },
    });
    try {
      await requestJson(command);
      if (text(input.value) === message) input.value = "";
      return true;
    } catch (error) {
      notify?.({ type: "error", message: error?.message || translate("chat.interjectionFailed") });
      return false;
    }
  }

  async function sendWithComposerActionState(...args) {
    const sessionRuntimeIdValue = resolveActiveSessionIdentity();
    const connectorStateTask = waitForSessionConnectorState?.(sessionRuntimeIdValue);
    if (connectorStateTask) await connectorStateTask;
    const currentTurn = resolveSessionTurnRuntime(
      turnRuntimeRegistry.value,
      sessionRuntimeIdValue,
      resolveActiveTurnScopeIdentity(),
    );
    if (composerActionState.value.canInterject === true) {
      return sendInterjection(currentTurn);
    }
    const stoppedTurn = currentTurn?.terminal === "user_stopped" ? currentTurn : null;
    const resumeDialogProcessId = text(stoppedTurn?.dialogProcessId);
    const resumeTurnScopeId = text(stoppedTurn?.turnScopeId);
    const resumeSessionId = resolveActiveSessionIdentity();
    const isContinueFromUserStopped = Boolean(
      stoppedTurn && resumeDialogProcessId && resumeTurnScopeId,
    );
    logStateMachineDebug("stateMachine.continue.source.selected", () => ({
      sessionId: resumeSessionId,
      selectedTurnScopeId: resumeTurnScopeId,
      selectedDialogProcessId: resumeDialogProcessId,
      selectedSequence: Number(stoppedTurn?.lifecycleSeq || 0),
      selectedContinuedByTurnScopeId: text(stoppedTurn?.continuedByTurnScopeId),
      candidates: Object.values(turnRuntimeRegistry.value?.sessions?.[resumeSessionId]?.turns || {})
        .filter((turn) => turn?.terminal === "user_stopped")
        .map((turn) => ({
          turnScopeId: text(turn?.turnScopeId),
          dialogProcessId: text(turn?.dialogProcessId),
          sequence: Number(turn?.lifecycleSeq || 0),
          continuedByTurnScopeId: text(turn?.continuedByTurnScopeId),
          continuationSourceTurnScopeId: text(turn?.continuationSource?.turnScopeId),
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
    const explicitExecutionId = text(args[0]);
    if (!explicitExecutionId && !composerActionState.value.canStop) return false;
    const requested = stopSending(...args);
    return requested;
  }

  return { sendWithComposerActionState, stopSendingWithComposerActionState };
}
