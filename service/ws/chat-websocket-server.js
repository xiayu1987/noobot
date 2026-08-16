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
import { createTurnFinalizer, snapshotRunState } from "./chat-websocket/terminal-outcomes.js";
import { createConnectionState } from "./chat-websocket/connection-state.js";
import { createMessageHandler } from "./chat-websocket/message-handler.js";
import { createTurnLifecycleBridge } from "./chat-websocket/turn-lifecycle-bridge.js";
import { createAuthorityEventDispatcher } from "./chat-websocket/authority-event-dispatcher.js";
import { recoverSnapshotOrphan, recoverTurnFinalize } from "./chat-websocket/finalize-recovery.js";
import { TURN_LIFECYCLE_WIRE_EVENT, validateTurnLifecycleEnvelope } from "@noobot/session-protocol";
import {
  detachRunTransport,
  findActiveRun,
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
    mapAgentRunCommand,
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
      void recordServiceWebSocketLifecycle({
        sessionLogConfig,
        event,
        userId: meta.userId,
        sessionId: meta.sessionId,
        dialogProcessId: meta.dialogProcessId,
        turnScopeId: meta.turnScopeId,
        data,
      });
    };
    logConnection("service.websocket.connection.opened", { authenticated: Boolean(authInfo) });
    webSocket.once("close", (code, reason) =>
      logConnection("service.websocket.connection.closed", {
        code,
        reasonLength: String(reason || "").length,
      }),
    );
    webSocket.once("error", (error) =>
      logConnection("service.websocket.connection.error", {
        error: error?.message || String(error || ""),
      }),
    );

    let eventSequence = 0;
    const sendEvent = (eventName, data = {}, transportContext = {}) => {
      if (eventName === TURN_LIFECYCLE_WIRE_EVENT) {
        const validation = validateTurnLifecycleEnvelope(data);
        if (!validation.valid) {
          logConnection("service.authorityOutbox.eventRejected", {
            eventId: String(data?.eventId || "").trim(),
            eventType: String(data?.eventType || "").trim(),
            errors: validation.errors,
          });
          return false;
        }
      }
      const authoritativeEvent =
        data?.channelKind === "message_event" && data?.event && typeof data.event === "object"
          ? data.event
          : null;
      const eventType = String(
        authoritativeEvent?.eventType || data?.eventType || data?.messageEvent?.eventType || "",
      ).trim();
      const transportDiagnostic = {
        eventId: String(authoritativeEvent?.eventId || data?.eventId || "").trim(),
        eventType,
        messageId: String(authoritativeEvent?.messageId || data?.messageId || "").trim(),
        presentationMessageId: String(
          authoritativeEvent?.presentationMessageId || data?.presentationMessageId || "",
        ).trim(),
        runHandleId: String(transportContext?.runHandleId || "").trim(),
        bindingId: String(transportContext?.bindingId || "").trim(),
        readyState: webSocket.readyState,
      };
      if (authoritativeEvent) {
        logConnection("service.websocket.messageEvent.sendStarted", transportDiagnostic);
      }
      const toolFrame = eventType === "tool_call_start" || eventType === "tool_call_end";
      const terminalLifecycle =
        eventName === "turn_lifecycle" &&
        ["turn.completed", "turn.stop_completed", "turn.failed"].includes(eventType);
      if (webSocket.readyState !== 1) {
        if (authoritativeEvent) {
          logConnection("service.websocket.messageEvent.sendRejected", transportDiagnostic);
        }
        if (toolFrame)
          logConnection("service.websocket.toolFrame.dropped", {
            eventName,
            eventType,
            readyState: webSocket.readyState,
            sessionId: data?.sessionId,
            dialogProcessId: data?.dialogProcessId,
            turnScopeId: data?.turnScopeId,
          });
        if (terminalLifecycle)
          logConnection("service.authorityOutbox.terminalSendRejected", {
            eventId: data?.eventId,
            eventType,
            sequence: Number(data?.sequence || 0),
            sessionId: data?.sessionId,
            parentSessionId: data?.parentSessionId,
            dialogProcessId: data?.dialogProcessId,
            turnScopeId: data?.turnScopeId,
            readyState: webSocket.readyState,
          });
        return false;
      }
      eventSequence += 1;
      const enrichedData =
        eventName === "attachment_lifecycle"
          ? data
          : {
              ...(data && typeof data === "object" ? data : {}),
              seq: eventSequence,
              dialogProcessId: String(
                authoritativeEvent?.dialogProcessId || data?.dialogProcessId || "",
              ).trim(),
              sessionId: String(
                authoritativeEvent?.sessionId || data?.route?.sessionId || data?.sessionId || "",
              ).trim(),
              turnScopeId: String(
                authoritativeEvent?.turnScopeId || data?.turnScopeId || "",
              ).trim(),
            };
      const recordSendFailure = (error) => {
        void recordServiceWebSocketSendFailure({
          sessionLogConfig,
          eventName: String(eventName || ""),
          userId: state.currentRunMeta?.userId || "",
          dialogProcessId: enrichedData.dialogProcessId,
          sessionId: enrichedData.sessionId,
          turnScopeId: enrichedData.turnScopeId,
          error,
        });
      };
      try {
        const packet = JSON.stringify({ event: eventName, data: enrichedData });
        return new Promise((resolve) => {
          webSocket.send(packet, (error) => {
            if (error) {
              if (authoritativeEvent) {
                logConnection("service.websocket.messageEvent.sendFailed", {
                  ...transportDiagnostic,
                  error: error?.message || String(error || "websocket_send_failed"),
                });
              }
              recordSendFailure(error);
              resolve(false);
              return;
            }
            if (authoritativeEvent) {
              logConnection("service.websocket.messageEvent.sendCompleted", {
                ...transportDiagnostic,
                transportSequence: eventSequence,
                readyState: webSocket.readyState,
              });
            }
            if (toolFrame)
              logConnection("service.websocket.toolFrame.sent", {
                eventName,
                eventType,
                seq: eventSequence,
                sessionId: enrichedData.sessionId,
                dialogProcessId: enrichedData.dialogProcessId,
                turnScopeId: enrichedData.turnScopeId,
              });
            if (terminalLifecycle)
              logConnection("service.authorityOutbox.terminalSent", {
                eventId: enrichedData.eventId,
                eventType,
                lifecycleSequence: Number(enrichedData.sequence || 0),
                transportSequence: eventSequence,
                sessionId: enrichedData.sessionId,
                parentSessionId: enrichedData.parentSessionId,
                dialogProcessId: enrichedData.dialogProcessId,
                turnScopeId: enrichedData.turnScopeId,
              });
            resolve(true);
          });
        });
      } catch (error) {
        recordSendFailure(error);
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
    const recoverPersistedTurnFinalize = (request = {}) =>
      recoverTurnFinalize({
        ...request,
        bot: resolveBot(),
        commitTurnLifecycle,
      });
    const recoverPersistedSnapshotOrphan = (request = {}) =>
      recoverSnapshotOrphan({
        ...request,
        bot: resolveBot(),
        commitTurnLifecycle,
        inspectExecution: ({ turnScopeId, dialogProcessId }) => ({
          alive: Boolean(
            findActiveRun({
              userId: String(authInfo?.userId || "").trim(),
              sessionId: request.sessionId,
              turnScopeId,
              dialogProcessId,
            }),
          ),
          observedAtMs: Date.now(),
        }),
      });

    const {
      finalizeTimeout,
      finalizeUserStopped,
      finalizeCompleted,
      finalizeAborted,
      finalizeGenericError,
    } = createTurnFinalizer({
      sendEvent,
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
      mapAgentRunCommand,
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
      recoverSnapshotOrphan: recoverPersistedSnapshotOrphan,
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
        try {
          webSocket.close(1011, "message handler failed");
        } catch {}
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
      rejectAllPendingInteractions(
        new Error(translateText("ws.socketClosed", state.currentLocale)),
      );
    });
  });

  return { webSocketServer };
}
