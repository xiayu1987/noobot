/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureId } from "@noobot/shared/secure-identity";
import { selectSessionRuntimeBucket } from "../run-state-machine/turnRuntimeRegistry.js";
import { logStateMachineDebug } from "../../../debug/loggers/stateMachineLogger.js";
import { AGENT_COMMAND, createTurnInterjectionCommand } from "@noobot/agent-transport-protocol";
import { createTurnScopeId } from "../engine/sendFlowSupport.js";
import { buildAgentCommandIdentity } from "../engine/commandIdentity.js";
import { text } from "@noobot/shared/value";

export function createComposerActions({
  composerActionState,
  input,
  activeSession,
  turnRuntimeRegistry,
  resolveActiveSessionIdentity,
  resolveActiveTurn,
  waitForSessionConnectorState,
  send,
  requestJson,
  stopSending,
  notify,
  translate,
}) {
  async function sendInterjection(currentTurn) {
    const message = text(input.value);
    if (!message) return false;
    const command = createTurnInterjectionCommand({
      commandId: createSecureId("command"),
      identity: buildAgentCommandIdentity(AGENT_COMMAND.INTERJECT, {
        channel: activeSession.value,
        turn: {
          dialogProcessId: currentTurn.dialogProcessId,
          turnScopeId: currentTurn.turnScopeId,
        },
      }),
      interaction: { message },
    });
    try {
      await requestJson(command, { expectedEvents: [] });
      if (text(input.value) === message) input.value = "";
      return true;
    } catch (error) {
      notify({ type: "error", message: error?.message || translate("chat.interjectionFailed") });
      return false;
    }
  }

  async function sendWithComposerActionState() {
    const sessionRuntimeIdValue = resolveActiveSessionIdentity();
    await waitForSessionConnectorState(sessionRuntimeIdValue);
    const currentTurn = resolveActiveTurn();
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
      candidates: Object.values(
        selectSessionRuntimeBucket(turnRuntimeRegistry.value, resumeSessionId)?.turns || {},
      )
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
      notify({ type: "warning", message: translate("chat.sessionStateOutOfSync") });
      return false;
    }
    const continuingTurnScopeId = isContinueFromUserStopped ? createTurnScopeId() : "";
    return send(
      isContinueFromUserStopped
        ? {
            commandType: AGENT_COMMAND.CONTINUE,
            turnScopeId: continuingTurnScopeId,
            continuation: {
              dialogProcessId: resumeDialogProcessId,
              turnScopeId: resumeTurnScopeId,
            },
          }
        : { commandType: AGENT_COMMAND.SEND },
    );
  }

  function stopSendingWithComposerActionState() {
    if (!composerActionState.value.canStop) return false;
    return stopSending();
  }

  return { sendWithComposerActionState, stopSendingWithComposerActionState };
}
