/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowMs } from "../../infra/timeFields.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { resolveSessionTurnRuntime } from "../sessionRunStateMachine/turnRuntimeRegistry.js";

export function createComposerActions({
  composerActionState, turnRuntimeRegistry, resolveActiveSessionIdentity,
  resolveActiveTurnScopeIdentity, submitTurnRuntimeEvent, send, stopSending,
  notify, translate,
}) {
  function createTurnScopeId() {
    const randomUuid = globalThis?.crypto?.randomUUID?.();
    if (randomUuid) return `client-turn:${randomUuid}`;
    return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
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
    const isContinueFromUserStopped = Boolean(stoppedTurn && resumeDialogProcessId && resumeTurnScopeId);
    if (currentTurn?.terminal === "user_stopped" && !isContinueFromUserStopped) {
      notify?.({
        type: "warning",
        message: translate("chat.sessionStateOutOfSync") || "Session state is out of sync. Refresh and try again.",
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
