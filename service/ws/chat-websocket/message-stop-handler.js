/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findActiveRun, rememberPendingStop } from "./run-registry.js";
import { recordServiceWebSocketLifecycle } from "./runtime-events.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/shared/turn-lifecycle-protocol";

export function createMessageStopHandler({
  state, canonicalRunOwnerId, sendEvent, translateText, resolveBot, sessionLogConfig,
  rejectAllPendingInteractions, commitTurnLifecycle,
}) {
  const handleStop = async (payload) => {
    const targetUserId = canonicalRunOwnerId;
    const targetTurnScopeId =
      String(payload?.turnScopeId || payload?.partialAssistant?.turnScopeId || "").trim() ||
      state.currentTurnScopeId;
    const targetSessionId =
      String(payload?.sessionId || payload?.partialAssistant?.sessionId || "").trim() ||
      state.currentRunMeta?.sessionId || "";
    const stopCommandId = String(payload?.commandId || payload?.idempotencyKey || `stop:${targetTurnScopeId}`).trim();
    const accepted = await commitTurnLifecycle({
      userId: targetUserId,
      sessionId: targetSessionId,
      parentSessionId: String(payload?.parentSessionId || "").trim(),
      turnScopeId: targetTurnScopeId,
      dialogProcessId: String(payload?.dialogProcessId || payload?.partialAssistant?.dialogProcessId || "").trim(),
      commandId: stopCommandId,
      eventType: TURN_EVENT.STOP_ACCEPTED,
      phase: TURN_PHASE.ACTION,
      expectedRevision: payload?.expectedRevision,
    });
    if (!accepted?.applied && !accepted?.deduplicated) {
      sendEvent("error", {
        error: accepted?.reason || "stop_not_allowed",
        errorCode: accepted?.reason || "stop_not_allowed",
        failurePhase: TURN_PHASE.ACTION,
        sessionId: targetSessionId,
        turnScopeId: targetTurnScopeId,
        currentRevision: accepted?.currentRevision,
      });
      return;
    }
    state.stopRequested = true;
    state.currentTurnScopeId = targetTurnScopeId;
    rejectAllPendingInteractions(new Error(translateText("ws.dialogStoppedByUser", state.currentLocale)));
    state.currentStopPayload = {
      userId: targetUserId,
      message: translateText("ws.dialogStoppedByUser", state.currentLocale),
      sessionId:
        targetSessionId,
      dialogProcessId:
        String(payload?.dialogProcessId || "").trim() ||
        String(payload?.partialAssistant?.dialogProcessId || "").trim() ||
        state.currentRunMeta?.dialogProcessId ||
        "",
      turnScopeId:
        String(payload?.turnScopeId || payload?.partialAssistant?.turnScopeId || "").trim() ||
        state.currentTurnScopeId ||
        state.currentRunMeta?.turnScopeId ||
        "",
      partialAssistant: payload?.partialAssistant || {},
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
      activeRun.abortController.abort({
        type: "user_stop",
        reason: "user stop action",
        stopPayload: state.currentStopPayload,
      });
      sendEvent("channel_state", {
        ...state.currentStopPayload,
        state: "stopping",
        sourceEvent: "stop_requested_registry",
      });
      return;
    }
    if (!state.isRunning || !state.currentAbortController) {
      const stopPayload = state.currentStopPayload;
      const userId = targetUserId;
      let turnStatus = null;
      try {
        turnStatus = await resolveBot()?.persistStoppedAssistantMessage?.({
          userId,
          sessionId: stopPayload.sessionId,
          parentSessionId: String(payload?.parentSessionId || "").trim(),
          parentDialogProcessId: String(payload?.parentDialogProcessId || "").trim(),
          partialAssistant: {
            ...(stopPayload.partialAssistant || {}),
            sessionId: stopPayload.sessionId,
            dialogProcessId: stopPayload.dialogProcessId,
            turnScopeId: stopPayload.turnScopeId,
          },
        });
      } catch {
        turnStatus = null;
      }
      if (turnStatus?.status === "user_stopped") {
        const lifecycleContext = {
          userId,
          sessionId: stopPayload.sessionId,
          parentSessionId: String(payload?.parentSessionId || "").trim(),
          turnScopeId: stopPayload.turnScopeId,
          dialogProcessId: stopPayload.dialogProcessId,
          phase: TURN_PHASE.STOP,
        };
        const processed = await commitTurnLifecycle({
          ...lifecycleContext,
          commandId: `${stopCommandId}:processing-completed`,
          eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
        });
        if (!processed?.applied && !processed?.deduplicated) {
          sendEvent("error", {
            error: processed?.reason || "stop_processing_completed_failed",
            errorCode: processed?.reason || "stop_processing_completed_failed",
            failurePhase: TURN_PHASE.STOP,
            sessionId: stopPayload.sessionId,
            dialogProcessId: stopPayload.dialogProcessId,
            turnScopeId: stopPayload.turnScopeId,
          });
          return;
        }
        const completed = await commitTurnLifecycle({
          ...lifecycleContext,
          commandId: `${stopCommandId}:completed`,
          eventType: TURN_EVENT.STOP_COMPLETED,
          summaryVersion: Number(turnStatus?.version || 0),
        });
        if (!completed?.applied && !completed?.deduplicated) {
          sendEvent("error", {
            error: completed?.reason || "stop_completed_failed",
            errorCode: completed?.reason || "stop_completed_failed",
            failurePhase: TURN_PHASE.STOP,
            sessionId: stopPayload.sessionId,
            dialogProcessId: stopPayload.dialogProcessId,
            turnScopeId: stopPayload.turnScopeId,
          });
          return;
        }
        sendEvent("channel_state", {
          ...stopPayload,
          state: "stopping",
          sourceEvent: "stop_requested_idle_persisted",
          turnStatus,
        });
        sendEvent("user_stopped", {
          ...stopPayload,
          turnStatus,
        });
        return;
      }
      if (!turnStatus) {
        rememberPendingStop(stopPayload, stopPayload);
      }
      sendEvent("channel_state", {
        ...stopPayload,
        state: turnStatus?.status || "stopping",
        sourceEvent: turnStatus ? "stop_requested_terminal_exists" : "stop_requested_pending",
        turnStatus: turnStatus || undefined,
      });
      return;
    }
    if (state.isRunning && state.currentAbortController) {
      state.currentAbortController.abort({
        type: "user_stop",
        reason: "user stop action",
        stopPayload: state.currentStopPayload,
      });
    }
    sendEvent("channel_state", {
      ...state.currentStopPayload,
      state: "stopping",
      sourceEvent: "stop_requested",
    });
  };

  return handleStop;
}
