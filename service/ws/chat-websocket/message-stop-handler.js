/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { closeUserInterjectionQueue, findActiveRun } from "./run-registry.js";
import { recordServiceWebSocketLifecycle } from "./runtime-events.js";
import {
  EXECUTION_ABORT_TYPE,
  TURN_EVENT,
  TURN_PHASE,
  createExecutionAbortReason,
  createTurnLifecycleCommandId,
} from "@noobot/session-protocol";
import { sendFailedCommandReceipt } from "./command-receipt.js";

const trimmed = (value) => String(value || "").trim();

const stopLifecycleCommandId = (stopCommandId, eventType) =>
  createTurnLifecycleCommandId({ commandId: stopCommandId, eventType, phase: TURN_PHASE.STOP });

const userStopAbortReason = (stopPayload) =>
  createExecutionAbortReason({
    type: EXECUTION_ABORT_TYPE.USER_STOP,
    reason: "user stop action",
    stopPayload,
  });

const isUsableActiveRun = (activeRun) =>
  Boolean(activeRun && activeRun.abortController && !activeRun.abortController.signal?.aborted);

function stopCompletedLogData(completed) {
  const envelope = completed?.envelope;
  const dispatch = completed?.dispatch;
  return {
    applied: completed?.applied === true,
    deduplicated: completed?.deduplicated === true,
    hasEnvelope: Boolean(envelope),
    completionCommitId: envelope?.completionCommitId || "",
    summaryVersion: Number(envelope?.summaryVersion || 0),
    dispatchDelivered: Number(dispatch?.delivered || 0),
    dispatchReason: dispatch?.reason || "",
  };
}

export function createMessageStopHandler({
  state,
  canonicalRunOwnerId,
  sendEvent,
  translateText,
  resolveBot,
  sessionLogConfig,
  rejectTurnInteractions,
  commitTurnLifecycle,
}) {
  const rejectedCommit = (command, result, fallbackCode) => {
    if (result?.applied || result?.deduplicated) return false;
    sendFailedCommandReceipt(sendEvent, command, {
      code: result?.reason || fallbackCode,
      message: result?.reason || fallbackCode,
    });
    return true;
  };

  const commitStopAccepted = (command, target) =>
    commitTurnLifecycle({
      userId: target.userId,
      sessionId: target.sessionId,
      parentSessionId: trimmed(command.identity.parentSessionId),
      turnScopeId: target.turnScopeId,
      dialogProcessId: trimmed(command.identity.dialogProcessId),
      commandId: stopLifecycleCommandId(target.stopCommandId, TURN_EVENT.STOP_ACCEPTED),
      causationId: target.stopCommandId,
      eventType: TURN_EVENT.STOP_ACCEPTED,
      phase: TURN_PHASE.STOP,
      expectedRevision: command.concurrency.expectedTurnRevision,
    });

  const markStopRequested = (command, target) => {
    state.stopRequested = true;
    state.currentTurnScopeId = target.turnScopeId;
    rejectTurnInteractions(
      { sessionId: target.sessionId, turnScopeId: target.turnScopeId },
      new Error(translateText("ws.dialogStoppedByUser", state.currentLocale)),
    );
    state.currentStopPayload = {
      userId: target.userId,
      message: translateText("ws.dialogStoppedByUser", state.currentLocale),
      sessionId: target.sessionId,
      dialogProcessId: trimmed(
        command.identity.dialogProcessId || state.currentRunMeta?.dialogProcessId,
      ),
      turnScopeId: target.turnScopeId,
      partialAssistant: command.stop?.partialAssistant || {},
      commandId: target.stopCommandId,
    };
  };

  const recordStopLifecycle = (event, userId, stopPayload, data) => {
    void recordServiceWebSocketLifecycle({
      sessionLogConfig,
      event,
      userId,
      sessionId: stopPayload.sessionId,
      dialogProcessId: stopPayload.dialogProcessId,
      turnScopeId: stopPayload.turnScopeId,
      data,
    });
  };

  const abortActiveRun = () => {
    const activeRun = findActiveRun(state.currentStopPayload);
    if (!isUsableActiveRun(activeRun)) return false;
    closeUserInterjectionQueue(activeRun);
    activeRun.stopRequested = true;
    activeRun.stopPayload = state.currentStopPayload;
    activeRun.abortController.abort(userStopAbortReason(state.currentStopPayload));
    return true;
  };

  const completeIdleStop = async (command, target) => {
    const stopPayload = state.currentStopPayload;
    const stoppedPartialAssistant = {
      ...(stopPayload.partialAssistant || {}),
      sessionId: stopPayload.sessionId,
      dialogProcessId: stopPayload.dialogProcessId,
      turnScopeId: stopPayload.turnScopeId,
    };
    const lifecycleContext = {
      userId: target.userId,
      sessionId: stopPayload.sessionId,
      parentSessionId: trimmed(command.identity.parentSessionId),
      turnScopeId: stopPayload.turnScopeId,
      dialogProcessId: stopPayload.dialogProcessId,
      phase: TURN_PHASE.STOP,
    };
    const processed = await commitTurnLifecycle({
      ...lifecycleContext,
      commandId: stopLifecycleCommandId(target.stopCommandId, TURN_EVENT.STOP_PROCESSING_COMPLETED),
      causationId: target.stopCommandId,
      eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
      finalizePayload: { assistantMessage: stoppedPartialAssistant },
    });
    if (rejectedCommit(command, processed, "stop_processing_completed_failed")) return;
    const completed = await commitTurnLifecycle({
      ...lifecycleContext,
      commandId: stopLifecycleCommandId(target.stopCommandId, TURN_EVENT.STOP_COMPLETED),
      causationId: target.stopCommandId,
      eventType: TURN_EVENT.STOP_COMPLETED,
      completionCommitId: stopLifecycleCommandId(target.stopCommandId, TURN_EVENT.STOP_COMPLETED),
      terminalStatus: {
        command: "user_stopped",
        description: stopPayload.message,
        assistantMessage: stoppedPartialAssistant,
      },
    });
    recordStopLifecycle(
      "service.authorityOutbox.stopCompletedCommit",
      target.userId,
      stopPayload,
      stopCompletedLogData(completed),
    );
    rejectedCommit(command, completed, "stop_completed_failed");
  };

  const handleStop = async (command) => {
    const identity = command.identity;
    const target = {
      userId: canonicalRunOwnerId,
      turnScopeId: String(identity.turnScopeId).trim(),
      sessionId: String(identity.sessionId).trim(),
      stopCommandId: String(command.commandId).trim(),
    };
    const accepted = await commitStopAccepted(command, target);
    if (rejectedCommit(command, accepted, "stop_not_allowed")) return;
    markStopRequested(command, target);
    recordStopLifecycle(
      "service.websocket.run.cancel.requested",
      target.userId,
      state.currentStopPayload,
      { activeRunPresent: Boolean(findActiveRun(state.currentStopPayload)) },
    );
    if (abortActiveRun()) return;
    if (!state.isRunning || !state.currentAbortController) {
      await completeIdleStop(command, target);
      return;
    }
    if (state.isRunning && state.currentAbortController) {
      state.currentAbortController.abort(userStopAbortReason(state.currentStopPayload));
    }
  };

  return handleStop;
}
