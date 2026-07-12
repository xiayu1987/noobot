/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WebSocketServer } from "ws";
import {
  recordServiceWebSocketRuntimeError,
  recordServiceWebSocketSendFailure,
} from "./chat-websocket/telemetry.js";
import { registerWebSocketUpgrade } from "./chat-websocket/connection-upgrade.js";
import { createUserInteractionBridge } from "./chat-websocket/user-interaction-bridge.js";
import {
  createTurnFinalizer,
  snapshotRunState,
} from "./chat-websocket/terminal-outcomes.js";
import { createConnectionState } from "./chat-websocket/connection-state.js";
import { createMessageHandler } from "./chat-websocket/message-handler.js";

export { recordServiceWebSocketSendFailure, recordServiceWebSocketRuntimeError };

export function registerChatWebSocketServer(
  server,
  {
    bot,
    getBot,
    resolveRequestLocale,
    resolveAuthByApiKey,
    isForbiddenUserScope,
    normalizeRunConfig,
    normalizeLocale,
    defaultLocale,
    translateText,
    sessionLogConfig,
  } = {},
) {
  const resolveBot = () => {
    if (typeof getBot === "function") return getBot();
    return bot;
  };

  const persistTurnStatus = async ({
    runMeta = {},
    command = "",
    description = "",
    error = null,
  } = {}) => {
    const normalizedCommand = String(command || "").trim();
    const userId = String(runMeta?.userId || "").trim();
    const sessionId = String(runMeta?.sessionId || "").trim();
    const turnScopeId = String(runMeta?.turnScopeId || "").trim();
    const dialogProcessId = String(runMeta?.dialogProcessId || "").trim();
    if (!normalizedCommand || !userId || !sessionId || (!turnScopeId && !dialogProcessId)) {
      return null;
    }
    try {
      const result = await resolveBot()?.upsertTurnStatus?.({
        userId,
        sessionId,
        parentSessionId: String(runMeta?.parentSessionId || "").trim(),
        parentDialogProcessId: String(runMeta?.parentDialogProcessId || "").trim(),
        turnScopeId,
        dialogProcessId,
        command: normalizedCommand,
        description,
        error,
      });
      return result?.turnStatus || null;
    } catch (persistError) {
      void recordServiceWebSocketRuntimeError({
        sessionLogConfig,
        event: "service.websocket.upsertTurnStatus.failed",
        userId,
        sessionId,
        parentSessionId: String(runMeta?.parentSessionId || "").trim(),
        dialogProcessId,
        turnScopeId,
        error: persistError,
        data: { command: normalizedCommand },
      });
      return null;
    }
  };

  const webSocketServer = new WebSocketServer({ noServer: true });

  registerWebSocketUpgrade(server, webSocketServer, {
    resolveRequestLocale,
    defaultLocale,
    translateText,
    resolveAuthByApiKey,
    sessionLogConfig,
  });

  webSocketServer.on("connection", (webSocket, request) => {
    const authInfo = request?.auth || null;
    const state = createConnectionState({
      locale: normalizeLocale(request?.locale || defaultLocale),
    });
    const pendingInteractionRequests = new Map();

    let eventSequence = 0;
    const sendEvent = (eventName, data = {}) => {
      if (webSocket.readyState !== 1) return;
      eventSequence += 1;
      const enrichedData = {
        ...(data && typeof data === "object" ? data : {}),
        seq: eventSequence,
        dialogProcessId: String(data?.dialogProcessId || "").trim(),
        sessionId: String(data?.sessionId || "").trim(),
        turnScopeId: String(data?.turnScopeId || state.currentRunMeta?.turnScopeId || "").trim(),
      };
      try {
        webSocket.send(JSON.stringify({ event: eventName, data: enrichedData }));
      } catch (error) {
        void recordServiceWebSocketSendFailure({
          sessionLogConfig,
          eventName: String(eventName || ""),
          userId: state.currentRunMeta?.userId || "",
          dialogProcessId: enrichedData.dialogProcessId,
          sessionId: enrichedData.sessionId,
          turnScopeId: enrichedData.turnScopeId,
          error,
        });
      }
    };

    const rejectUnpersistedTurnStatus = ({ runMeta = {}, status = "" } = {}) => {
      const errorCode = "turn_status_persistence_failed";
      const errorMessage = `failed to persist terminal turn status: ${String(status || "unknown").trim()}`;
      sendEvent("error", {
        error: errorMessage,
        errorCode,
        sessionId: String(runMeta?.sessionId || "").trim(),
        dialogProcessId: String(runMeta?.dialogProcessId || "").trim(),
        turnScopeId: String(runMeta?.turnScopeId || state.currentTurnScopeId || "").trim(),
        turnStatus: null,
      });
      webSocket.close(1011, errorCode);
    };

    const {
      finalizeTimeout,
      finalizeUserStopped,
      finalizeCompleted,
      finalizeAborted,
      finalizeGenericError,
    } = createTurnFinalizer({
      sendEvent,
      persistTurnStatus,
      rejectUnpersistedTurnStatus,
      resolveBot,
      translateText,
      sessionLogConfig,
      webSocket,
    });

    const buildRunStateSnapshot = () =>
      snapshotRunState({
        runMeta: state.currentRunMeta,
        turnScopeId: state.currentTurnScopeId,
        stopPayload: state.currentStopPayload,
        abortSignal: state.currentAbortSignal,
        locale: state.currentLocale,
      });

    const { userInteractionBridge, rejectAllPendingInteractions } = createUserInteractionBridge({
      sendEvent,
      translateText,
      getCurrentLocale: () => state.currentLocale,
      getCurrentRunMeta: () => state.currentRunMeta,
      pendingInteractionRequests,
      sessionLogConfig,
    });

    webSocket.on(
      "message",
      createMessageHandler({
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
      }),
    );

    webSocket.on("close", (code, reasonBuffer) => {
      if (state.currentAbortController) {
        const reasonText =
          typeof reasonBuffer === "string"
            ? reasonBuffer
            : Buffer.isBuffer(reasonBuffer)
              ? reasonBuffer.toString("utf8")
              : "";
        state.currentAbortController.abort({
          type: "socket_close",
          code: Number(code || 0) || undefined,
          reason: reasonText || "websocket closed",
        });
      }
      if (state.currentRunTimeoutTimer) {
        clearTimeout(state.currentRunTimeoutTimer);
        state.currentRunTimeoutTimer = null;
      }
      rejectAllPendingInteractions(new Error(translateText("ws.socketClosed", state.currentLocale)));
    });
  });

  return { webSocketServer };
}
