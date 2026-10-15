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
import { firstText, text } from "@noobot/shared/value";

export function snapshotRunState({
  runMeta = null,
  turnScopeId = "",
  stopPayload = null,
  abortSignal = null,
  locale = "",
} = {}) {
  const resolvedTurnScopeId = firstText(runMeta?.turnScopeId, turnScopeId);
  const identity = {
    userId: text(runMeta?.userId),
    sessionId: text(runMeta?.sessionId),
    parentSessionId: text(runMeta?.parentSessionId),
    dialogProcessId: text(runMeta?.dialogProcessId),
    turnScopeId: resolvedTurnScopeId,
    commandRoot: text(runMeta?.commandId) || resolvedTurnScopeId,
  };
  return { runMeta, identity, stopPayload, abortSignal, locale };
}

export function createTurnFinalizer({
  sendEvent,
  rejectUnpersistedTurnStatus,
  translateText,
  webSocket,
  commitTurnLifecycle,
} = {}) {
  const sendCommandReceipt = (state, outcome, error = null) =>
    sendEvent(
      AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
      createAgentCommandReceipt({
        commandId: state.runMeta?.commandId,
        commandType: state.runMeta?.commandType,
        outcome,
        identity: {
          sessionId: state.identity.sessionId,
          turnScopeId: state.identity.turnScopeId,
          dialogProcessId: state.identity.dialogProcessId,
        },
        error,
      }),
    );
  const finalizeTimeout = async (state, { description = "", errorObject = null } = {}) => {
    const commandId = createTurnLifecycleCommandId({
      commandId: state.identity.commandRoot,
      eventType: TURN_EVENT.FAILED,
      phase: TURN_PHASE.PROCESSING,
    });
    const failed = await commitTurnLifecycle({
      userId: state.identity.userId,
      sessionId: state.identity.sessionId,
      parentSessionId: state.identity.parentSessionId,
      turnScopeId: state.identity.turnScopeId,
      dialogProcessId: state.identity.dialogProcessId,
      commandId,
      causationId: commandId,
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
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "timeout", result: failed });
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
    const stoppedMessage = translateText("ws.dialogStoppedByUser", state.locale);
    const stoppedPartialAssistant = buildStoppedPartialAssistant({
      stopPayload,
      runMeta: state.runMeta,
      result,
      fallbackMessage: stoppedMessage,
    });
    const stopCommandId =
      text(stopPayload?.commandId) || `stop:${stoppedPartialAssistant.turnScopeId}`;
    const processed = await commitTurnLifecycle({
      userId: state.identity.userId,
      sessionId: stoppedPartialAssistant.sessionId,
      parentSessionId: state.identity.parentSessionId,
      turnScopeId: stoppedPartialAssistant.turnScopeId || state.identity.turnScopeId,
      dialogProcessId: stoppedPartialAssistant.dialogProcessId,
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
      rejectUnpersistedTurnStatus({
        runMeta: state.runMeta,
        status: "stop_processing_completed",
        result: processed,
      });
      return;
    }
    const completionCommitId = createTurnLifecycleCommandId({
      commandId: stopCommandId,
      eventType: TURN_EVENT.STOP_COMPLETED,
      phase: TURN_PHASE.STOP,
    });
    const completed = await commitTurnLifecycle({
      userId: state.identity.userId,
      sessionId: stoppedPartialAssistant.sessionId,
      parentSessionId: state.identity.parentSessionId,
      turnScopeId: stoppedPartialAssistant.turnScopeId || state.identity.turnScopeId,
      dialogProcessId: stoppedPartialAssistant.dialogProcessId,
      commandId: completionCommitId,
      causationId: stopCommandId,
      eventType: TURN_EVENT.STOP_COMPLETED,
      phase: TURN_PHASE.STOP,
      completionCommitId,
      terminalStatus: {
        command: "user_stopped",
        assistantMessage: stoppedPartialAssistant,
      },
    });
    if (!completed?.applied && !completed?.deduplicated) {
      rejectUnpersistedTurnStatus({
        runMeta: state.runMeta,
        status: "stop_completed",
        result: completed,
      });
      return;
    }
    sendCommandReceipt(state, AGENT_COMMAND_RECEIPT_OUTCOME.STOPPED);
    webSocket.close(1000, "user_stopped");
  };

  const finalizeCompleted = async (state, { result = {}, commandId = "" } = {}) => {
    const rootCommandId = text(commandId) || state.identity.commandRoot;
    const completionCommitId = createTurnLifecycleCommandId({
      commandId: rootCommandId,
      eventType: TURN_EVENT.COMPLETED,
      phase: TURN_PHASE.COMPLETION,
    });
    const completed = await commitTurnLifecycle({
      userId: state.identity.userId,
      sessionId: result.sessionId || state.identity.sessionId,
      parentSessionId: state.identity.parentSessionId,
      turnScopeId: state.identity.turnScopeId,
      dialogProcessId: result.dialogProcessId || state.identity.dialogProcessId,
      commandId: completionCommitId,
      causationId: rootCommandId,
      eventType: TURN_EVENT.COMPLETED,
      phase: TURN_PHASE.COMPLETION,
      completionCommitId,
      terminalStatus: { command: "completed" },
    });
    if (!completed?.applied && !completed?.deduplicated) {
      await commitTurnLifecycle({
        userId: state.identity.userId,
        sessionId: result.sessionId || state.identity.sessionId,
        parentSessionId: state.identity.parentSessionId,
        turnScopeId: state.identity.turnScopeId,
        dialogProcessId: result.dialogProcessId || state.identity.dialogProcessId,
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
      rejectUnpersistedTurnStatus({
        runMeta: state.runMeta,
        status: "completed",
        result: completed,
      });
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
      event: "service.websocket.run.aborted",
      userId: state.identity.userId,
      sessionId: state.identity.sessionId,
      parentSessionId: state.identity.parentSessionId,
      dialogProcessId: state.identity.dialogProcessId,
      turnScopeId: state.identity.turnScopeId,
      error,
      data: {
        abortReasonType:
          state.abortSignal?.reason && typeof state.abortSignal.reason === "object"
            ? text(state.abortSignal.reason?.type)
            : "",
      },
    });
    if (!committed?.applied && !committed?.deduplicated) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "error", result: committed });
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
      event: "service.websocket.run.failed",
      userId: state.identity.userId,
      sessionId: state.identity.sessionId,
      parentSessionId: state.identity.parentSessionId,
      dialogProcessId: state.identity.dialogProcessId,
      turnScopeId: state.identity.turnScopeId,
      error,
    });
    const errorMessage = error?.message || translateText("ws.unknownError", state.locale);
    if (!committed?.applied && !committed?.deduplicated) {
      rejectUnpersistedTurnStatus({ runMeta: state.runMeta, status: "error", result: committed });
      return;
    }
    sendCommandReceipt(state, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED, {
      code: String(error?.code || "run_failed"),
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
