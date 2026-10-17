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

const stopLifecycleCommandId = (stopCommandId, eventType) =>
  createTurnLifecycleCommandId({ commandId: stopCommandId, eventType, phase: TURN_PHASE.STOP });

const userStopAbortReason = (stopPayload) =>
  createExecutionAbortReason({
    type: EXECUTION_ABORT_TYPE.USER_STOP,
    reason: "user stop action",
    stopPayload,
  });

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
      parentSessionId: command.identity.parentSessionId,
      turnScopeId: target.turnScopeId,
      commandId: stopLifecycleCommandId(target.stopCommandId, TURN_EVENT.STOP_ACCEPTED),
      causationId: target.stopCommandId,
      eventType: TURN_EVENT.STOP_ACCEPTED,
      phase: TURN_PHASE.STOP,
      expectedRevision: command.concurrency.expectedTurnRevision,
    });

  const createStopPayload = (command, target) => {
    rejectTurnInteractions(
      { sessionId: target.sessionId, turnScopeId: target.turnScopeId },
      new Error(translateText("ws.dialogStoppedByUser", state.currentLocale)),
    );
    return {
      userId: target.userId,
      sessionId: target.sessionId,
      dialogProcessId: target.dialogProcessId,
      turnScopeId: target.turnScopeId,
      partialAssistant: command.stop.partialAssistant,
      commandId: target.stopCommandId,
    };
  };

  const recordStopLifecycle = (event, userId, stopPayload, data) => {
    void recordServiceWebSocketLifecycle({
      event,
      userId,
      sessionId: stopPayload.sessionId,
      dialogProcessId: stopPayload.dialogProcessId,
      turnScopeId: stopPayload.turnScopeId,
      data,
    });
  };

  const abortRegisteredRun = (activeRun, stopPayload) => {
    if (activeRun.abortController.signal.aborted) return;
    closeUserInterjectionQueue(activeRun);
    activeRun.abortController.abort(userStopAbortReason(stopPayload));
  };

  const completeIdleStop = async (command, target, stopPayload) => {
    const stoppedPartialAssistant = {
      ...stopPayload.partialAssistant,
      sessionId: stopPayload.sessionId,
      dialogProcessId: stopPayload.dialogProcessId,
      turnScopeId: stopPayload.turnScopeId,
    };
    const lifecycleContext = {
      userId: target.userId,
      sessionId: stopPayload.sessionId,
      parentSessionId: command.identity.parentSessionId,
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
    target.dialogProcessId = accepted.turn.dialogProcessId;
    const stopPayload = createStopPayload(command, target);
    const activeRun = findActiveRun(stopPayload);
    recordStopLifecycle("service.websocket.run.cancel.requested", target.userId, stopPayload, {
      activeRunPresent: Boolean(activeRun),
    });
    if (activeRun) {
      abortRegisteredRun(activeRun, stopPayload);
      return;
    }
    await completeIdleStop(command, target, stopPayload);
  };

  return handleStop;
}
