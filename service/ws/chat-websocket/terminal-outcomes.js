/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recordServiceWebSocketRuntimeError } from "./runtime-events.js";
import {
  buildAbortErrorMessage,
  buildStoppedPartialAssistant,
} from "./stop-lifecycle.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";

export function snapshotRunState({
  runMeta = null,
  turnScopeId = "",
  stopPayload = null,
  abortSignal = null,
  locale = "",
} = {}) {
  return { runMeta, turnScopeId, stopPayload, abortSignal, locale };
}

export function createTurnFinalizer({
  sendEvent,
  rejectUnpersistedTurnStatus,
  translateText,
  sessionLogConfig,
  webSocket,
  commitTurnLifecycle,
} = {}) {
  const finalizeTimeout = async (state, { description = "", errorObject = null } = {}) => {
    const failed = await commitTurnLifecycle({
      userId: state.runMeta?.userId || "",
      sessionId: state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      dialogProcessId: state.runMeta?.dialogProcessId || "",
      commandId: `${String(state.runMeta?.turnScopeId || state.turnScopeId || "turn").trim()}:failed:timeout`,
      eventType: TURN_EVENT.FAILED,
      phase: TURN_PHASE.PROCESSING,
      failure: { phase: TURN_PHASE.PROCESSING, code: "run_timeout", message: description, retryable: false },
      terminalStatus: { command: "timeout", description, error: errorObject },
    });
    if (!failed?.applied && !failed?.deduplicated) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "timeout" });
      return;
    }
    sendEvent("error", {
      error: description,
      sessionId: state.runMeta?.sessionId || "",
      dialogProcessId: state.runMeta?.dialogProcessId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      turnStatus: failed.turnStatus,
    });
    webSocket.close(1011, "timeout");
  };

  const finalizeUserStopped = async (state, { result = {} } = {}) => {
    const stopPayload = state.stopPayload || state.abortSignal?.reason?.stopPayload || {};
    const stoppedMessage = stopPayload?.message || translateText("ws.dialogStoppedByUser", state.locale);
    const stoppedPartialAssistant = buildStoppedPartialAssistant({
      stopPayload,
      runMeta: state.runMeta,
      result,
      fallbackMessage: stoppedMessage,
    });
    const stopCommandId = String(stopPayload?.commandId || `stop:${stoppedPartialAssistant.turnScopeId}`).trim();
    const processed = await commitTurnLifecycle({
      userId: state.runMeta?.userId || "",
      sessionId: stoppedPartialAssistant.sessionId || state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      turnScopeId: stoppedPartialAssistant.turnScopeId || state.turnScopeId || "",
      dialogProcessId: stoppedPartialAssistant.dialogProcessId || state.runMeta?.dialogProcessId || "",
      commandId: `${stopCommandId}:processing-completed`,
      eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
      phase: TURN_PHASE.STOP,
      finalizePayload: { assistantMessage: stoppedPartialAssistant },
    });
    if (!processed?.applied && !processed?.deduplicated) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "stop_processing_completed" });
      return;
    }
    const completionCommitId = `${stopCommandId}:completed`;
    const completed = await commitTurnLifecycle({
      userId: state.runMeta?.userId || "",
      sessionId: stoppedPartialAssistant.sessionId || state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      turnScopeId: stoppedPartialAssistant.turnScopeId || state.turnScopeId || "",
      dialogProcessId: stoppedPartialAssistant.dialogProcessId || state.runMeta?.dialogProcessId || "",
      commandId: completionCommitId,
      eventType: TURN_EVENT.STOP_COMPLETED,
      phase: TURN_PHASE.STOP,
      completionCommitId,
      terminalStatus: {
        command: "user_stopped",
        description: stoppedMessage,
        assistantMessage: stoppedPartialAssistant,
      },
    });
    if (!completed?.applied && !completed?.deduplicated) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "stop_completed" });
      return;
    }
    webSocket.close(1000, "user_stopped");
  };

  const finalizeCompleted = async (state, { result = {}, commandId = "" } = {}) => {
    const completionCommitId = `${String(commandId || state.runMeta?.turnScopeId || "turn").trim()}:completed`;
    const completed = await commitTurnLifecycle({
      userId: state.runMeta?.userId || "",
      sessionId: result.sessionId || state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      dialogProcessId: result.dialogProcessId || state.runMeta?.dialogProcessId || "",
      commandId: completionCommitId,
      eventType: TURN_EVENT.COMPLETED,
      phase: TURN_PHASE.COMPLETION,
      completionCommitId,
      terminalStatus: {
        command: "completed",
        description: "本轮对话已正常完成",
      },
    });
    if (!completed?.applied && !completed?.deduplicated) {
      await commitTurnLifecycle({
        userId: state.runMeta?.userId || "",
        sessionId: result.sessionId || state.runMeta?.sessionId || "",
        parentSessionId: state.runMeta?.parentSessionId || "",
        turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
        dialogProcessId: result.dialogProcessId || state.runMeta?.dialogProcessId || "",
        commandId: `${completionCommitId}:failed`,
        eventType: TURN_EVENT.FAILED,
        phase: TURN_PHASE.COMPLETION,
        failure: {
          phase: TURN_PHASE.COMPLETION,
          code: completed?.reason || "completion_transaction_failed",
          message: "completion transaction failed",
          retryable: true,
        },
      });
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "completed" });
      return;
    }
    const turnStatus = completed.turnStatus;
    sendEvent("done", {
      sessionId: result.sessionId,
      answer: result.answer,
      dialogProcessId: result.dialogProcessId || "",
      turnScopeId:
        state.stopPayload?.turnScopeId ||
        state.runMeta?.turnScopeId ||
        state.turnScopeId ||
        "",
      messages: result.messages || [],
      traces: result.traces || [],
      executionLogs: result.executionLogs || [],
      turnStatus,
    });
    webSocket.close(1000, "done");
  };

  const finalizeAborted = async (state, { error = null, committed = null } = {}) => {
    const errorMessage = buildAbortErrorMessage({
      error,
      abortSignal: state.abortSignal,
      currentLocale: state.locale,
      translateText,
    });
    void recordServiceWebSocketRuntimeError({
      sessionLogConfig,
      event: "service.websocket.run.aborted",
      userId: state.runMeta?.userId || "",
      sessionId: state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      dialogProcessId: state.runMeta?.dialogProcessId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      error,
      data: {
        abortReasonType:
          state.abortSignal?.reason && typeof state.abortSignal.reason === "object"
            ? String(state.abortSignal.reason?.type || "").trim()
            : "",
      },
    });
    if (!committed?.applied && !committed?.deduplicated) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "error" });
      return;
    }
    sendEvent("error", {
      error: errorMessage,
      sessionId: state.runMeta?.sessionId || "",
      dialogProcessId: state.runMeta?.dialogProcessId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      turnStatus: committed.turnStatus,
    });
    webSocket.close(1011, "aborted");
  };

  const finalizeGenericError = async (state, { error = null, committed = null } = {}) => {
    void recordServiceWebSocketRuntimeError({
      sessionLogConfig,
      event: "service.websocket.run.failed",
      userId: state.runMeta?.userId || "",
      sessionId: state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      dialogProcessId: state.runMeta?.dialogProcessId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      error,
    });
    const errorMessage = error?.message || translateText("ws.unknownError", state.locale);
    if (!committed?.applied && !committed?.deduplicated) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "error" });
      return;
    }
    sendEvent("error", {
      error: errorMessage,
      status: Number(error?.statusCode || error?.status || 0) || undefined,
      errorCode: String(error?.errorCode || error?.code || "").trim() || undefined,
      currentVersion: error?.currentVersion,
      sessionId: state.runMeta?.sessionId || "",
      dialogProcessId: state.runMeta?.dialogProcessId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      turnStatus: committed.turnStatus,
    });
    webSocket.close(1011, "error");
  };

  return {
    finalizeTimeout,
    finalizeUserStopped,
    finalizeCompleted,
    finalizeAborted,
    finalizeGenericError,
  };
}
