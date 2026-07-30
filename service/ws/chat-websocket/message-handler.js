/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { unregisterActiveRun } from "./run-registry.js";
import { recordServiceWebSocketLifecycle } from "./runtime-events.js";
import { isAbortLikeError, isSocketCloseRunAbort, isUserStopRunAbort } from "./stop-lifecycle.js";
import { resetRunState } from "./connection-state.js";
import { TURN_COMMAND, TURN_PHASE } from "@noobot/authoritative-state/contracts";
import { EXECUTION_QUERY_COMMAND } from "@noobot/shared/execution-lifecycle-protocol";
import { createMessageQueryHandlers } from "./message-query-handlers.js";
import { createMessageStopHandler } from "./message-stop-handler.js";
import { createMessageRunHandler } from "./message-run-handler.js";

export function createMessageHandler({
  state,
  authInfo,
  webSocket,
  sendEvent,
  translateText,
  normalizeLocale,
  normalizeRunConfig,
  isForbiddenUserScope,
  resolveBot,
  sessionLogConfig,
  pendingInteractionRequests,
  rejectAllPendingInteractions,
  userInteractionBridge,
  buildRunStateSnapshot,
  finalizeTimeout,
  finalizeUserStopped,
  finalizeCompleted,
  finalizeAborted,
  finalizeGenericError,
  commitTurnLifecycle,
  recoverTurnFinalize,
}) {
  const canonicalRunOwnerId = String(authInfo?.userId || "").trim();

  const { handleInteractionResponse, handleSnapshotGet, handleExecutionQuery, handleFinalize } =
    createMessageQueryHandlers({
      state, authInfo, sendEvent, translateText, isForbiddenUserScope, resolveBot,
      pendingInteractionRequests, recoverTurnFinalize,
    });
  const handleStop = createMessageStopHandler({
    state, canonicalRunOwnerId, sendEvent, translateText, resolveBot, sessionLogConfig,
    rejectAllPendingInteractions, commitTurnLifecycle,
  });
  const { handleRun, commitCurrentFailure } = createMessageRunHandler({
    state, authInfo, sendEvent, translateText, normalizeLocale, normalizeRunConfig, isForbiddenUserScope,
    resolveBot, sessionLogConfig, userInteractionBridge, buildRunStateSnapshot,
    finalizeTimeout, finalizeUserStopped, finalizeCompleted, commitTurnLifecycle,
  });

  return async function onMessage(rawMessage) {
    let runMessageStarted = false;
    try {
      const payload = JSON.parse(String(rawMessage || "{}"));
      const action = String(payload?.action || "").trim().toLowerCase();
      const commandType = String(payload?.commandType || "").trim().toLowerCase();
      if (Object.values(EXECUTION_QUERY_COMMAND).includes(commandType)) {
        await handleExecutionQuery(payload, commandType);
        return;
      }
      if (commandType === TURN_COMMAND.SNAPSHOT_GET) {
        await handleSnapshotGet(payload);
        return;
      }
      if (commandType === TURN_COMMAND.FINALIZE) {
        await handleFinalize(payload);
        return;
      }
      const isContinueAction = action === "continue" || action === "resume";
      if (action === "interaction_response") {
        handleInteractionResponse(payload);
        return;
      }
      if (action === "stop") {
        await handleStop(payload);
        return;
      }
      if (state.isRunning) {
        sendEvent("error", { error: translateText("ws.sessionAlreadyRunning", state.currentLocale) });
        return;
      }
      runMessageStarted = true;
      const runResult = await handleRun(payload, { isContinueAction });
      if (runResult?.rebound === true) runMessageStarted = false;
    } catch (error) {
      if (!runMessageStarted || !state.currentRunMeta) {
        void recordServiceWebSocketLifecycle({
          sessionLogConfig,
          event: "service.websocket.request.rejected",
          data: { errorType: error?.name || "Error", errorCode: String(error?.errorCode || error?.code || "") },
        });
        sendEvent("error", {
          error: error?.message || translateText("ws.unknownError", state.currentLocale),
          status: Number(error?.statusCode || error?.status || 0) || undefined,
          errorCode: String(error?.errorCode || error?.code || "").trim() || undefined,
          currentVersion: error?.currentVersion,
          sessionId: state.currentRunMeta?.sessionId || "",
          turnScopeId: state.currentRunMeta?.turnScopeId || state.currentTurnScopeId || "",
        });
        webSocket.close(1008, "invalid request");
        return;
      }
      if (state.currentAbortSignal?.aborted || isAbortLikeError(error)) {
        if (state.currentRunTimedOut) {
          await finalizeTimeout(buildRunStateSnapshot(), {
            description: error?.message || "run timeout",
            errorObject: error,
          });
        } else if (
          isUserStopRunAbort({ stopRequested: state.stopRequested, abortSignal: state.currentAbortSignal })
        ) {
          await finalizeUserStopped(buildRunStateSnapshot());
        } else if (isSocketCloseRunAbort(state.currentAbortSignal)) {
          await commitCurrentFailure(error, state.currentLifecyclePhase || TURN_PHASE.ACTION);
          return;
        } else {
          void recordServiceWebSocketLifecycle({
            sessionLogConfig,
            event: "service.websocket.run.aborted",
            ...state.currentRunMeta,
            data: { errorType: error?.name || "Error" },
          });
          await commitCurrentFailure(error, TURN_PHASE.PROCESSING);
          await finalizeAborted(buildRunStateSnapshot(), { error });
        }
        return;
      }
      void recordServiceWebSocketLifecycle({
        sessionLogConfig,
        event: "service.websocket.run.failed",
        ...state.currentRunMeta,
        data: { errorType: error?.name || "Error" },
      });
      await commitCurrentFailure(error);
      await finalizeGenericError(buildRunStateSnapshot(), { error });
    } finally {
      if (runMessageStarted) {
        if (state.currentRunHandle) {
          unregisterActiveRun(state.currentRunHandle);
        }
        resetRunState(state);
        void recordServiceWebSocketLifecycle({
          sessionLogConfig,
          event: "service.websocket.run.stateReset",
          data: { completed: true },
        });
      }
    }
  };
}
