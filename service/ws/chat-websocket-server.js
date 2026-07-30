/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WebSocketServer } from "ws";
import {
  recordServiceWebSocketRuntimeError,
  recordServiceWebSocketSendFailure,
  recordServiceWebSocketLifecycle,
} from "./chat-websocket/runtime-events.js";
import { registerWebSocketUpgrade } from "./chat-websocket/connection-upgrade.js";
import { createUserInteractionBridge } from "./chat-websocket/user-interaction-bridge.js";
import {
  createTurnFinalizer,
  snapshotRunState,
} from "./chat-websocket/terminal-outcomes.js";
import { createConnectionState } from "./chat-websocket/connection-state.js";
import { createMessageHandler } from "./chat-websocket/message-handler.js";
import { createTurnLifecycleBridge } from "./chat-websocket/turn-lifecycle-bridge.js";
import { createAuthorityEventDispatcher } from "./chat-websocket/authority-event-dispatcher.js";
import { recoverTurnFinalize } from "./chat-websocket/finalize-recovery.js";
import {
  detachRunTransport,
  isRunTransportAttached,
} from "./chat-websocket/run-registry.js";

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

    const logConnection = (event, data = {}) => {
      const meta = state.currentRunMeta || {};
      void recordServiceWebSocketLifecycle({ sessionLogConfig, event, userId: meta.userId, sessionId: meta.sessionId, dialogProcessId: meta.dialogProcessId, turnScopeId: meta.turnScopeId, data });
    };
    logConnection("service.websocket.connection.opened", { authenticated: Boolean(authInfo) });
    webSocket.once("close", (code, reason) => logConnection("service.websocket.connection.closed", { code, reasonLength: String(reason || "").length }));
    webSocket.once("error", (error) => logConnection("service.websocket.connection.error", { error: error?.message || String(error || "") }));

    let eventSequence = 0;
    const sendEvent = (eventName, data = {}) => {
      const authoritativeEvent =
        data?.channelKind === "message_event" && data?.event && typeof data.event === "object"
          ? data.event
          : null;
      const eventType = String(
        authoritativeEvent?.eventType || data?.eventType || data?.messageEvent?.eventType || "",
      ).trim();
      const toolFrame = eventType === "tool_call_start" || eventType === "tool_call_end";
      if (webSocket.readyState !== 1) {
        if (toolFrame) logConnection("service.websocket.toolFrame.dropped", {
          eventName, eventType, readyState: webSocket.readyState,
          sessionId: data?.sessionId, dialogProcessId: data?.dialogProcessId,
          turnScopeId: data?.turnScopeId,
        });
        return false;
      }
      eventSequence += 1;
      const enrichedData = {
        ...(data && typeof data === "object" ? data : {}),
        seq: eventSequence,
        dialogProcessId: String(
          authoritativeEvent?.dialogProcessId || data?.dialogProcessId || "",
        ).trim(),
        sessionId: String(
          authoritativeEvent?.sessionId || data?.route?.sessionId || data?.sessionId || "",
        ).trim(),
        turnScopeId: String(
          authoritativeEvent?.turnScopeId || data?.turnScopeId || state.currentRunMeta?.turnScopeId || "",
        ).trim(),
      };
      try {
        webSocket.send(JSON.stringify({ event: eventName, data: enrichedData }));
        if (toolFrame) logConnection("service.websocket.toolFrame.sent", {
          eventName, eventType, seq: eventSequence,
          sessionId: enrichedData.sessionId,
          dialogProcessId: enrichedData.dialogProcessId,
          turnScopeId: enrichedData.turnScopeId,
        });
        return true;
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
        return false;
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

    const dispatchAuthorityEvents = createAuthorityEventDispatcher({ resolveBot, sendEvent });
    const commitTurnLifecycle = createTurnLifecycleBridge({ resolveBot, dispatchAuthorityEvents });
    const recoverPersistedTurnFinalize = (request = {}) => recoverTurnFinalize({
      ...request,
      bot: resolveBot(),
      commitTurnLifecycle,
    });

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
      commitTurnLifecycle,
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

    const messageHandler = createMessageHandler({
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
      dispatchAuthorityEvents,
      recoverTurnFinalize: recoverPersistedTurnFinalize,
    });
    webSocket.on("message", (rawMessage) => {
      void messageHandler(rawMessage).catch((error) => {
        void recordServiceWebSocketLifecycle({
          sessionLogConfig,
          event: "service.websocket.message.unhandledFailure",
          data: { errorType: error?.name || "Error", errorCode: String(error?.code || "") },
        });
        sendEvent("error", {
          error: error?.message || translateText("ws.unknownError", state.currentLocale),
          errorCode: String(error?.errorCode || error?.code || "message_handler_failed"),
          sessionId: state.currentRunMeta?.sessionId || "",
          turnScopeId: state.currentRunMeta?.turnScopeId || state.currentTurnScopeId || "",
        });
        try { webSocket.close(1011, "message handler failed"); } catch {}
      });
    });

    webSocket.on("close", (code, reasonBuffer) => {
      const transportStillOwned =
        !state.currentRunHandle ||
        isRunTransportAttached(state.currentRunHandle, state.currentRunTransportBinding);
      if (state.currentAbortController && transportStillOwned) {
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
      if (transportStillOwned && state.currentRunHandle) {
        detachRunTransport(state.currentRunHandle, state.currentRunTransportBinding);
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
