/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recordServiceWebSocketRuntimeError } from "./telemetry.js";
import {
  buildAbortErrorMessage,
  buildStoppedPartialAssistant,
} from "./stop-lifecycle.js";

/**
 * Build a read-only snapshot of the connection-level run state that the
 * terminal outcome handlers need. Handlers never mutate connection state; the
 * message handler owns state lifecycle and resets it in its finally block.
 */
export function snapshotRunState({
  runMeta = null,
  turnScopeId = "",
  stopPayload = null,
  abortSignal = null,
  locale = "",
} = {}) {
  return { runMeta, turnScopeId, stopPayload, abortSignal, locale };
}

/**
 * Create the terminal outcome handlers bound to a single connection's I/O and
 * persistence dependencies. Each handler owns the full "persist terminal turn
 * status -> emit event -> close socket" lifecycle for one outcome and always
 * terminates the turn (either by rejecting an unpersisted status or closing the
 * socket), so callers simply return afterwards.
 */
export function createTurnFinalizer({
  sendEvent,
  persistTurnStatus,
  rejectUnpersistedTurnStatus,
  resolveBot,
  translateText,
  sessionLogConfig,
  webSocket,
} = {}) {
  const finalizeTimeout = async (state, { description = "", errorObject = null } = {}) => {
    const turnStatus = await persistTurnStatus({
      runMeta: state.runMeta,
      command: "timeout",
      description,
      error: errorObject,
    });
    if (!turnStatus) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "timeout" });
      return;
    }
    sendEvent("error", {
      error: description,
      sessionId: state.runMeta?.sessionId || "",
      dialogProcessId: state.runMeta?.dialogProcessId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      turnStatus,
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
    let turnStatus = null;
    try {
      turnStatus = await resolveBot()?.persistStoppedAssistantMessage?.({
        userId: state.runMeta?.userId || "",
        sessionId: state.runMeta?.sessionId || "",
        parentSessionId: state.runMeta?.parentSessionId || "",
        parentDialogProcessId: state.runMeta?.parentDialogProcessId || "",
        partialAssistant: stoppedPartialAssistant,
      });
    } catch (persistError) {
      void recordServiceWebSocketRuntimeError({
        sessionLogConfig,
        event: "service.websocket.persistStoppedAssistantMessage.failed",
        userId: state.runMeta?.userId || "",
        sessionId: state.runMeta?.sessionId || "",
        parentSessionId: state.runMeta?.parentSessionId || "",
        dialogProcessId: state.runMeta?.dialogProcessId || "",
        turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
        error: persistError,
      });
    }
    if (!turnStatus) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "user_stopped" });
      return;
    }
    sendEvent("user_stopped", {
      message: stoppedMessage,
      sessionId: stoppedPartialAssistant.sessionId || "",
      dialogProcessId: stoppedPartialAssistant.dialogProcessId || "",
      turnScopeId: stoppedPartialAssistant.turnScopeId || state.turnScopeId || "",
      turnStatus,
    });
    webSocket.close(1000, "user_stopped");
  };

  const finalizeCompleted = async (state, { result = {} } = {}) => {
    const turnStatus = await persistTurnStatus({
      runMeta: {
        ...state.runMeta,
        sessionId: result.sessionId || state.runMeta?.sessionId || "",
        dialogProcessId: result.dialogProcessId || state.runMeta?.dialogProcessId || "",
      },
      command: "completed",
      description: "本轮对话已正常完成",
    });
    if (!turnStatus) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "completed" });
      return;
    }
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

  const finalizeAborted = async (state, { error = null } = {}) => {
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
    const turnStatus = await persistTurnStatus({
      runMeta: state.runMeta,
      command: "aborted",
      description: errorMessage,
      error,
    });
    if (!turnStatus) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "error" });
      return;
    }
    sendEvent("error", {
      error: errorMessage,
      sessionId: state.runMeta?.sessionId || "",
      dialogProcessId: state.runMeta?.dialogProcessId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      turnStatus,
    });
    webSocket.close(1011, "aborted");
  };

  const finalizeGenericError = async (state, { error = null } = {}) => {
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
    const turnStatus = await persistTurnStatus({
      runMeta: state.runMeta,
      command: "error",
      description: errorMessage,
      error,
    });
    if (!turnStatus) {
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
      turnStatus,
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
