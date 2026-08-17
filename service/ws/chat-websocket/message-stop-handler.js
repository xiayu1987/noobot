/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findActiveRun } from "./run-registry.js";
import { recordServiceWebSocketLifecycle } from "./runtime-events.js";
import {
  EXECUTION_ABORT_TYPE,
  TURN_EVENT,
  TURN_PHASE,
  createExecutionAbortReason,
  createTurnLifecycleCommandId,
} from "@noobot/session-protocol";
import { sendFailedCommandReceipt } from "./command-receipt.js";

export function createMessageStopHandler({
  state,
  canonicalRunOwnerId,
  sendEvent,
  translateText,
  resolveBot,
  sessionLogConfig,
  rejectAllPendingInteractions,
  commitTurnLifecycle,
}) {
  const handleStop = async (command) => {
    const identity = command.identity;
    const partialAssistant = command.stop?.partialAssistant || {};
    const targetUserId = canonicalRunOwnerId;
    const targetTurnScopeId = String(identity.turnScopeId).trim();
    const targetSessionId = String(identity.sessionId).trim();
    const stopCommandId = String(command.commandId).trim();
    const accepted = await commitTurnLifecycle({
      userId: targetUserId,
      sessionId: targetSessionId,
      parentSessionId: String(identity.parentSessionId || "").trim(),
      turnScopeId: targetTurnScopeId,
      dialogProcessId: String(identity.dialogProcessId || "").trim(),
      commandId: createTurnLifecycleCommandId({
        commandId: stopCommandId,
        eventType: TURN_EVENT.STOP_ACCEPTED,
        phase: TURN_PHASE.STOP,
      }),
      causationId: stopCommandId,
      eventType: TURN_EVENT.STOP_ACCEPTED,
      phase: TURN_PHASE.STOP,
      expectedRevision: command.concurrency.expectedTurnRevision,
    });
    if (!accepted?.applied && !accepted?.deduplicated) {
      sendFailedCommandReceipt(sendEvent, command, {
        code: accepted?.reason || "stop_not_allowed",
        message: accepted?.reason || "stop_not_allowed",
      });
      return;
    }
    state.stopRequested = true;
    state.currentTurnScopeId = targetTurnScopeId;
    rejectAllPendingInteractions(
      new Error(translateText("ws.dialogStoppedByUser", state.currentLocale)),
    );
    state.currentStopPayload = {
      userId: targetUserId,
      message: translateText("ws.dialogStoppedByUser", state.currentLocale),
      sessionId: targetSessionId,
      dialogProcessId: String(
        identity.dialogProcessId || state.currentRunMeta?.dialogProcessId || "",
      ).trim(),
      turnScopeId: targetTurnScopeId,
      partialAssistant,
      commandId: stopCommandId,
    };
    void recordServiceWebSocketLifecycle({
      sessionLogConfig,
      event: "service.websocket.run.cancel.requested",
      userId: targetUserId,
      sessionId: state.currentStopPayload.sessionId,
      dialogProcessId: state.currentStopPayload.dialogProcessId,
      turnScopeId: state.currentStopPayload.turnScopeId,
      data: { activeRunPresent: Boolean(findActiveRun(state.currentStopPayload)) },
    });
    const activeRun = findActiveRun(state.currentStopPayload);
    if (activeRun && activeRun.abortController && !activeRun.abortController.signal?.aborted) {
      activeRun.stopRequested = true;
      activeRun.stopPayload = state.currentStopPayload;
      activeRun.abortController.abort(createExecutionAbortReason({
        type: EXECUTION_ABORT_TYPE.USER_STOP,
        reason: "user stop action",
        stopPayload: state.currentStopPayload,
      }));
      return;
    }
    if (!state.isRunning || !state.currentAbortController) {
      const stopPayload = state.currentStopPayload;
      const userId = targetUserId;
      const stoppedPartialAssistant = {
        ...(stopPayload.partialAssistant || {}),
        sessionId: stopPayload.sessionId,
        dialogProcessId: stopPayload.dialogProcessId,
        turnScopeId: stopPayload.turnScopeId,
      };
      {
        const lifecycleContext = {
          userId,
          sessionId: stopPayload.sessionId,
          parentSessionId: String(identity.parentSessionId || "").trim(),
          turnScopeId: stopPayload.turnScopeId,
          dialogProcessId: stopPayload.dialogProcessId,
          phase: TURN_PHASE.STOP,
        };
        const processed = await commitTurnLifecycle({
          ...lifecycleContext,
          commandId: createTurnLifecycleCommandId({
            commandId: stopCommandId,
            eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
            phase: TURN_PHASE.STOP,
          }),
          causationId: stopCommandId,
          eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
          finalizePayload: { assistantMessage: stoppedPartialAssistant },
        });
        if (!processed?.applied && !processed?.deduplicated) {
          sendFailedCommandReceipt(sendEvent, command, {
            code: processed?.reason || "stop_processing_completed_failed",
            message: processed?.reason || "stop_processing_completed_failed",
          });
          return;
        }
        const completed = await commitTurnLifecycle({
          ...lifecycleContext,
          commandId: createTurnLifecycleCommandId({
            commandId: stopCommandId,
            eventType: TURN_EVENT.STOP_COMPLETED,
            phase: TURN_PHASE.STOP,
          }),
          causationId: stopCommandId,
          eventType: TURN_EVENT.STOP_COMPLETED,
          completionCommitId: createTurnLifecycleCommandId({
            commandId: stopCommandId,
            eventType: TURN_EVENT.STOP_COMPLETED,
            phase: TURN_PHASE.STOP,
          }),
          terminalStatus: {
            command: "user_stopped",
            description: stopPayload.message,
            assistantMessage: stoppedPartialAssistant,
          },
        });
        void recordServiceWebSocketLifecycle({
          sessionLogConfig,
          event: "service.authorityOutbox.stopCompletedCommit",
          userId,
          sessionId: stopPayload.sessionId,
          dialogProcessId: stopPayload.dialogProcessId,
          turnScopeId: stopPayload.turnScopeId,
          data: {
            applied: completed?.applied === true,
            deduplicated: completed?.deduplicated === true,
            hasEnvelope: Boolean(completed?.envelope),
            completionCommitId: completed?.envelope?.completionCommitId || "",
            summaryVersion: Number(completed?.envelope?.summaryVersion || 0),
            dispatchDelivered: Number(completed?.dispatch?.delivered || 0),
            dispatchReason: completed?.dispatch?.reason || "",
          },
        });
        if (!completed?.applied && !completed?.deduplicated) {
          sendFailedCommandReceipt(sendEvent, command, {
            code: completed?.reason || "stop_completed_failed",
            message: completed?.reason || "stop_completed_failed",
          });
          return;
        }
        return;
      }
    }
    if (state.isRunning && state.currentAbortController) {
      state.currentAbortController.abort(createExecutionAbortReason({
        type: EXECUTION_ABORT_TYPE.USER_STOP,
        reason: "user stop action",
        stopPayload: state.currentStopPayload,
      }));
    }
  };

  return handleStop;
}
