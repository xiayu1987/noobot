/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recordServiceWebSocketRuntimeError } from "./runtime-events.js";
import { buildAbortErrorMessage, buildStoppedPartialAssistant } from "./stop-lifecycle.js";
import { TURN_EVENT, TURN_PHASE, createTurnLifecycleCommandId } from "@noobot/session-protocol";
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandReceipt,
} from "@noobot/agent-transport-protocol";

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
  const sendCommandReceipt = (state, outcome, error = null) => sendEvent(
    AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    createAgentCommandReceipt({
      commandId: state.runMeta?.commandId,
      commandType: state.runMeta?.commandType,
      outcome,
      identity: {
        sessionId: state.runMeta?.sessionId,
        turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId,
        dialogProcessId: state.runMeta?.dialogProcessId,
      },
      error,
    }),
  );
  const finalizeTimeout = async (state, { description = "", errorObject = null } = {}) => {
    const failed = await commitTurnLifecycle({
      userId: state.runMeta?.userId || "",
      sessionId: state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      dialogProcessId: state.runMeta?.dialogProcessId || "",
      commandId: createTurnLifecycleCommandId({
        commandId: state.runMeta?.commandId || state.runMeta?.turnScopeId || state.turnScopeId,
        eventType: TURN_EVENT.FAILED,
        phase: TURN_PHASE.PROCESSING,
      }),
      eventType: TURN_EVENT.FAILED,
      phase: TURN_PHASE.PROCESSING,
      failure: {
        phase: TURN_PHASE.PROCESSING,
        code: "run_timeout",
        message: description,
        retryable: false,
      },
      terminalStatus: { command: "timeout", description, error: errorObject },
    });
    if (!failed?.applied && !failed?.deduplicated) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "timeout" });
      return;
    }
    sendCommandReceipt(state, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED, {
      code: "run_timeout",
      message: description,
    });
    webSocket.close(1011, "timeout");
  };

  const finalizeUserStopped = async (state, { result = {} } = {}) => {
    const stopPayload = state.stopPayload || state.abortSignal?.reason?.stopPayload || {};
    const stoppedMessage =
      stopPayload?.message || translateText("ws.dialogStoppedByUser", state.locale);
    const stoppedPartialAssistant = buildStoppedPartialAssistant({
      stopPayload,
      runMeta: state.runMeta,
      result,
      fallbackMessage: stoppedMessage,
    });
    const stopCommandId = String(
      stopPayload?.commandId || `stop:${stoppedPartialAssistant.turnScopeId}`,
    ).trim();
    const processed = await commitTurnLifecycle({
      userId: state.runMeta?.userId || "",
      sessionId: stoppedPartialAssistant.sessionId || state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      turnScopeId: stoppedPartialAssistant.turnScopeId || state.turnScopeId || "",
      dialogProcessId:
        stoppedPartialAssistant.dialogProcessId || state.runMeta?.dialogProcessId || "",
      commandId: createTurnLifecycleCommandId({
        commandId: stopCommandId,
        eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
        phase: TURN_PHASE.STOP,
      }),
      causationId: stopCommandId,
      eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
      phase: TURN_PHASE.STOP,
      finalizePayload: { assistantMessage: stoppedPartialAssistant },
    });
    if (!processed?.applied && !processed?.deduplicated) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "stop_processing_completed" });
      return;
    }
    const completionCommitId = createTurnLifecycleCommandId({
      commandId: stopCommandId,
      eventType: TURN_EVENT.STOP_COMPLETED,
      phase: TURN_PHASE.STOP,
    });
    const completed = await commitTurnLifecycle({
      userId: state.runMeta?.userId || "",
      sessionId: stoppedPartialAssistant.sessionId || state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      turnScopeId: stoppedPartialAssistant.turnScopeId || state.turnScopeId || "",
      dialogProcessId:
        stoppedPartialAssistant.dialogProcessId || state.runMeta?.dialogProcessId || "",
      commandId: completionCommitId,
      causationId: stopCommandId,
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
    sendCommandReceipt(state, AGENT_COMMAND_RECEIPT_OUTCOME.STOPPED);
    webSocket.close(1000, "user_stopped");
  };

  const finalizeCompleted = async (state, { result = {}, commandId = "" } = {}) => {
    const rootCommandId = String(
      commandId || state.runMeta?.commandId || state.runMeta?.turnScopeId || "",
    ).trim();
    const completionCommitId = createTurnLifecycleCommandId({
      commandId: rootCommandId,
      eventType: TURN_EVENT.COMPLETED,
      phase: TURN_PHASE.COMPLETION,
    });
    const completed = await commitTurnLifecycle({
      userId: state.runMeta?.userId || "",
      sessionId: result.sessionId || state.runMeta?.sessionId || "",
      parentSessionId: state.runMeta?.parentSessionId || "",
      turnScopeId: state.runMeta?.turnScopeId || state.turnScopeId || "",
      dialogProcessId: result.dialogProcessId || state.runMeta?.dialogProcessId || "",
      commandId: completionCommitId,
      causationId: rootCommandId,
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
        commandId: createTurnLifecycleCommandId({
          commandId: rootCommandId,
          eventType: TURN_EVENT.FAILED,
          phase: TURN_PHASE.COMPLETION,
        }),
        causationId: rootCommandId,
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
    sendCommandReceipt(state, AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED);
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
    sendCommandReceipt(state, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED, {
      code: String(error?.code || "run_aborted"),
      message: errorMessage,
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
    sendCommandReceipt(state, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED, {
      code: String(error?.errorCode || error?.code || "run_failed"),
      message: errorMessage,
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
