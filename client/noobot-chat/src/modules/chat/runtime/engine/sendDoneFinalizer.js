/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { finalizeDoneTurnPresentation } from "./sessionFinalize.js";
import { logStateMachineDebug, summarizeStateMachineMessage } from "../../../debug/loggers/stateMachineLogger.js";

export function createDoneTurnFinalizer({
  activeSession,
  activeSessionId,
  botMessage,
  getFinalDoneEventData,
  fetchSessionDetail,
  applySessionDetail,
  applyAssistantFailureState,
  applyRunStateEvent,
  refreshSessionConnectorsAsync,
  logSessionEvent,
  locateDoneMessage,
  finalizePendingResendOperation,
}) {
  let finalDoneDetailPromise = null;

  const start = (source = "") => {
    const finalDoneEventData = getFinalDoneEventData?.();
    if (!finalDoneEventData || finalDoneDetailPromise) return finalDoneDetailPromise;
    logStateMachineDebug("stateMachine.done.finalize.before", {
      source,
      sessionId: finalDoneEventData.sessionId,
      dialogProcessId: finalDoneEventData.dialogProcessId,
      turnScopeId: finalDoneEventData.turnScopeId,
      botMessage: summarizeStateMachineMessage(botMessage),
    });
    finalDoneDetailPromise = finalizeDoneTurnPresentation({
      activeSession,
      activeSessionId,
      botMessage,
      finalDoneEventData,
      fetchSessionDetail,
      applySessionDetail,
      applyAssistantFailureState,
      applyRunStateEvent,
      refreshSessionConnectorsAsync,
      logSessionEvent,
      completionSource: "realtimeDone",
    }).then((applied) => {
      logStateMachineDebug("stateMachine.done.finalize.after", {
        source,
        applied: Boolean(applied),
        sessionId: finalDoneEventData?.sessionId || "",
        dialogProcessId: finalDoneEventData?.dialogProcessId || "",
        turnScopeId: finalDoneEventData?.turnScopeId || "",
        botMessage: summarizeStateMachineMessage(botMessage),
      });
      if (applied) {
        locateDoneMessage?.();
        finalizePendingResendOperation?.({ finalOnly: true });
      }
      return applied;
    }).catch((error) => {
      logStateMachineDebug("stateMachine.done.finalize.failed", {
        source,
        sessionId: finalDoneEventData?.sessionId || "",
        dialogProcessId: finalDoneEventData?.dialogProcessId || "",
        turnScopeId: finalDoneEventData?.turnScopeId || "",
        error: String(error?.message || error || ""),
        botMessage: summarizeStateMachineMessage(botMessage),
      });
      throw error;
    });
    return finalDoneDetailPromise;
  };

  return {
    start,
    get promise() {
      return finalDoneDetailPromise;
    },
  };
}
