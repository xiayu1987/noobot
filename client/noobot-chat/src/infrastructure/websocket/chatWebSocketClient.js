/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../modules/chat/model/chatConstants.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { createWebSocketTransportSupervisor } from "./webSocketTransportSupervisor.js";
import { logWorkflowDiagnostics } from "../../modules/debug/loggers/workflowDiagnosticsLogger.js";
import {
  createTurnLifecycleReceipt,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  validateTurnLifecycleEnvelope,
} from "@noobot/session-protocol";
import {
  AGENT_TRANSPORT_DEBUG_TYPE,
  summarizeAgentTransportCommand,
} from "@noobot/agent-transport-protocol";

import { createWebSocketCommandRequests } from "./chatWebSocketCommandRequests.js";
import { createSocketHandlerRegistry } from "./chatWebSocketSocketHandlers.js";
import {
  canSettleStreamForEvent,
  createStreamEventError,
  isEventForStreamScope,
  isTerminalChannelStateEvent,
  normalizeErrorMessage,
  normalizeTrimmedString,
} from "./chatWebSocketProtocol.js";

export function createChatWebSocketClient({
  resolveWebSocketUrl = () => "",
  refreshAuthentication = null,
  sessionLogSink = null,
  terminalChannelStateGraceMs = TIME_THRESHOLDS.client.wsTerminalChannelStateGraceMs,
  translateText = (key = "") => String(key || ""),
} = {}) {
  const transport = createWebSocketTransportSupervisor({
    channelId: "chat",
    resolveWebSocketUrl,
    refreshAuthentication,
  });
  let resolveCurrentStream = null;
  let streamSerial = 0;
  let activeStreamContext = null;
  let activeReconnectContext = null;
  let protocolRequestSerial = 0;

  let reconnecting = false;
  let reconnectResolve = null;
  let reconnectReject = null;
  let reconnectTimeout = null;
  let liveEventSubscriber = null;
  // A server can answer the turn immediately after the command is sent. Keep
  // authoritative message events received during the short handler-bind
  // window until the stream owns the socket; dropping them makes live
  // artifacts appear only after a later replay.
  const pendingMessageEvents = [];
  const RECONNECT_TIMEOUT_MS = TIME_THRESHOLDS.client.wsReconnectTimeoutMs;
  function logAgentTransportCommand(event, command, extra = {}) {
    try {
      if (!sessionLogSink?.isEnabled?.(AGENT_TRANSPORT_DEBUG_TYPE)) return false;
      return sessionLogSink.debug?.(AGENT_TRANSPORT_DEBUG_TYPE, () => {
        const summary = summarizeAgentTransportCommand(command, extra);
        return {
          category: "debug",
          level: "debug",
          debugType: AGENT_TRANSPORT_DEBUG_TYPE,
          event,
          sessionId: summary.sessionId,
          dialogProcessId: summary.dialogProcessId,
          turnScopeId: summary.turnScopeId,
          data: { debugType: AGENT_TRANSPORT_DEBUG_TYPE, event, ...summary },
        };
      });
    } catch {
      return false;
    }
  }
  const commandRequests = createWebSocketCommandRequests({
    getActiveSocket: () => getActiveSocket(),
    timeoutMs: RECONNECT_TIMEOUT_MS,
    translateText,
    onCommandSending: (command) => logAgentTransportCommand(
      "frontend.agentTransport.commandSending",
      command,
      { transport: "websocket" },
    ),
    onCommandSent: (command) => logAgentTransportCommand(
      "frontend.agentTransport.commandSent",
      command,
      { transport: "websocket" },
    ),
    onCommandSendFailed: (command, error) => logAgentTransportCommand(
      "frontend.agentTransport.commandSendFailed",
      command,
      {
        transport: "websocket",
        errorType: String(error?.name || "Error"),
        errorCode: String(error?.code || ""),
      },
    ),
  });
  const { register: registerSocketHandlers } = createSocketHandlerRegistry();

  function nextRequestId(kind = "command") {
    protocolRequestSerial += 1;
    return `${kind}:${Date.now()}:${protocolRequestSerial}`;
  }





  function normalizeScopeFromPayload(payload = {}) {
    return {
      sessionId: normalizeTrimmedString(payload?.sessionId),
      dialogProcessId: normalizeTrimmedString(payload?.dialogProcessId),
      turnScopeId: normalizeTrimmedString(payload?.turnScopeId),
    };
  }

  function clearTimers() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  }

  function cleanupSocketRef(ws) {
    transport.release(ws);
  }

  function closeFailedSocket(ws, reason = "transport_error") {
    cleanupSocketRef(ws);
    try { ws?.close?.(1011, reason); } catch {}
  }

  function getActiveSocket() {
    return transport.current();
  }

  function acknowledgeTurnLifecycleReceipt(ws, event, data = {}) {
    if (event !== TURN_LIFECYCLE_WIRE_EVENT) return;
    const validation = validateTurnLifecycleEnvelope(data);
    if (!validation.valid) {
      logWorkflowDiagnostics("frontend.websocket.lifecycleReceiptRejected", () => ({
        sessionId: normalizeTrimmedString(data?.sessionId),
        dialogProcessId: normalizeTrimmedString(data?.dialogProcessId),
        turnScopeId: normalizeTrimmedString(data?.turnScopeId),
        eventId: normalizeTrimmedString(data?.eventId),
        reasons: validation.errors,
      }));
      return;
    }
    try {
      ws.send(JSON.stringify(createTurnLifecycleReceipt(data)));
    } catch (error) {
      logWorkflowDiagnostics("frontend.websocket.lifecycleReceiptSendFailed", () => ({
        sessionId: normalizeTrimmedString(data?.sessionId),
        dialogProcessId: normalizeTrimmedString(data?.dialogProcessId),
        turnScopeId: normalizeTrimmedString(data?.turnScopeId),
        eventId: normalizeTrimmedString(data?.eventId),
        errorType: normalizeTrimmedString(error?.name || "Error"),
        errorMessage: normalizeTrimmedString(error?.message),
      }));
    }
  }

  function resolveAuthoritativeSequence(event, data = {}) {
    return Number(
      event === TURN_LIFECYCLE_WIRE_EVENT
        ? data?.sequence
        : data?.event?.sequence,
    ) || null;
  }

  function logTransportEventReceived(event, data = {}, { hasLiveSubscriber = false } = {}) {
    const authoritativeEvent = data?.event && typeof data.event === "object" ? data.event : {};
    try {
      sessionLogSink?.log?.({
        category: "transport",
        level: "debug",
        event: "frontend.websocket.transportEventReceived",
        sessionId: normalizeTrimmedString(data?.sessionId || authoritativeEvent.sessionId),
        dialogProcessId: normalizeTrimmedString(data?.dialogProcessId || authoritativeEvent.dialogProcessId),
        turnScopeId: normalizeTrimmedString(data?.turnScopeId || authoritativeEvent.turnScopeId),
        data: {
          protocolEvent: event,
          eventId: normalizeTrimmedString(data?.eventId || authoritativeEvent.eventId),
          eventType: normalizeTrimmedString(data?.eventType || authoritativeEvent.eventType),
          parentSessionId: normalizeTrimmedString(data?.parentSessionId || authoritativeEvent.parentSessionId),
          messageId: normalizeTrimmedString(data?.messageId || authoritativeEvent.messageId),
          presentationMessageId: normalizeTrimmedString(
            data?.presentationMessageId || authoritativeEvent.presentationMessageId,
          ),
          transportSequence: Number(data?.seq || 0) || null,
          authoritativeSequence: resolveAuthoritativeSequence(event, data),
          contentLength: String(authoritativeEvent?.content ?? authoritativeEvent?.text ?? data?.text ?? "").length,
          attachmentCount: Array.isArray(authoritativeEvent?.attachments) ? authoritativeEvent.attachments.length : 0,
          transferEnvelopeCount: Array.isArray(authoritativeEvent?.transferEnvelopes)
            ? authoritativeEvent.transferEnvelopes.length
            : 0,
          reconnecting,
          activeStream: Boolean(activeStreamContext),
          hasLiveSubscriber,
        },
      });
    } catch {
      // Observability must not alter protocol delivery.
    }
  }

  function attachTransportHandlers(ws) {
    if (!ws) return null;
    registerSocketHandlers(ws, "transport", {
      open: () => transport.markOpen(ws),
      message: (messageEvent) => {
        let parsedEvent = "";
        let parsedData = {};
        try {
          const parsed = JSON.parse(String(messageEvent?.data || "{}"));
          const event = String(parsed?.event || "message");
          const data = parsed?.data || {};
          parsedEvent = event;
          parsedData = data;
          const hasLiveSubscriber = typeof liveEventSubscriber === "function";
          logTransportEventReceived(event, data, { hasLiveSubscriber });
          logWorkflowDiagnostics("frontend.websocket.transportEventReceived", () => ({
            sessionId: normalizeTrimmedString(data?.sessionId),
            dialogProcessId: normalizeTrimmedString(data?.dialogProcessId),
            turnScopeId: normalizeTrimmedString(data?.turnScopeId),
            protocolEvent: event,
            eventId: normalizeTrimmedString(data?.eventId || data?.event?.eventId),
            eventType: normalizeTrimmedString(data?.eventType || data?.event?.eventType),
            parentSessionId: normalizeTrimmedString(data?.parentSessionId || data?.event?.parentSessionId),
            transportSequence: Number(data?.seq || 0) || null,
            authoritativeSequence: resolveAuthoritativeSequence(event, data),
            reconnecting,
            activeStream: Boolean(activeStreamContext),
            hasLiveSubscriber,
          }));
          if (event === "transport_ready") {
            transport.markReady(ws, { nextServerInstanceId: data?.serverInstanceId });
            return;
          }
          commandRequests.settle(event, data);
          const reconnectControlEvent =
            event === StreamEventEnum.RECONNECT_DATA ||
            event === StreamEventEnum.RECONNECT_COMPLETE;
          const owner = reconnecting && activeReconnectContext && reconnectControlEvent
            ? "reconnect_handler"
            : activeStreamContext?.handleProtocolEvent
              ? "stream_handler"
              : reconnecting && activeReconnectContext
                ? "reconnect_handler"
                : hasLiveSubscriber
                  ? "transport_live_subscriber"
                : "unowned";
          const dispatchEligible = owner !== "unowned";
          if (owner === "unowned" && event === "message_event") {
            pendingMessageEvents.push({ event, data });
            return;
          }
          if (event === TURN_LIFECYCLE_WIRE_EVENT) {
            if (
              data?.eventType === TURN_EVENT.ACTION_ACCEPTED &&
              activeStreamContext?.payload &&
              activeStreamContext.agentTransportAcceptedLogged !== true
            ) {
              activeStreamContext.agentTransportAcceptedLogged = true;
              logAgentTransportCommand(
                "frontend.agentTransport.commandAccepted",
                activeStreamContext.payload,
                {
                  accepted: true,
                  acknowledgedByBackend: true,
                  transport: "websocket",
                  lifecycleEventType: TURN_EVENT.ACTION_ACCEPTED,
                  lifecycleEventId: normalizeTrimmedString(data?.eventId),
                  lifecycleRevision: Number(data?.revision || 0),
                },
              );
            }
            logWorkflowDiagnostics("frontend.websocket.lifecycleDispatchEvaluated", () => ({
              sessionId: normalizeTrimmedString(data?.sessionId),
              parentSessionId: normalizeTrimmedString(data?.parentSessionId),
              dialogProcessId: normalizeTrimmedString(data?.dialogProcessId),
              turnScopeId: normalizeTrimmedString(data?.turnScopeId),
              eventId: normalizeTrimmedString(data?.eventId),
              eventType: normalizeTrimmedString(data?.eventType),
              transportSequence: Number(data?.seq || 0) || null,
              authoritativeSequence: Number(data?.sequence || 0) || null,
              reconnecting,
              activeStream: Boolean(activeStreamContext),
              hasLiveSubscriber,
              dispatchEligible,
              owner,
            }));
            // Receipt is a transport acknowledgement. Send it immediately after
            // validating the envelope so a business reducer failure cannot stall
            // the authoritative lifecycle delivery queue.
            acknowledgeTurnLifecycleReceipt(ws, event, data);
          }
          if (owner === "reconnect_handler") {
            activeReconnectContext.handleProtocolEvent({ event, data });
          } else if (owner === "stream_handler") {
            activeStreamContext.handleProtocolEvent({ event, data });
          } else if (owner === "transport_live_subscriber") {
            liveEventSubscriber({ event, data });
          }
          logWorkflowDiagnostics("frontend.websocket.protocolEventDispatched", () => ({
            sessionId: normalizeTrimmedString(data?.sessionId),
            dialogProcessId: normalizeTrimmedString(data?.dialogProcessId),
            turnScopeId: normalizeTrimmedString(data?.turnScopeId),
            eventId: normalizeTrimmedString(data?.eventId || data?.event?.eventId),
            protocolEvent: event,
            transportSequence: Number(data?.seq || 0) || null,
            authoritativeSequence: resolveAuthoritativeSequence(event, data),
            owner,
            dispatched: dispatchEligible,
          }));
        } catch (error) {
          logWorkflowDiagnostics("frontend.websocket.transportEventRejected", () => ({
            sessionId: normalizeTrimmedString(parsedData?.sessionId),
            parentSessionId: normalizeTrimmedString(parsedData?.parentSessionId),
            dialogProcessId: normalizeTrimmedString(parsedData?.dialogProcessId),
            turnScopeId: normalizeTrimmedString(parsedData?.turnScopeId),
            protocolEvent: parsedEvent,
            eventId: normalizeTrimmedString(parsedData?.eventId),
            eventType: normalizeTrimmedString(parsedData?.eventType),
            errorType: normalizeTrimmedString(error?.name || "Error"),
            errorMessage: normalizeTrimmedString(error?.message),
            reconnecting,
            activeStream: Boolean(activeStreamContext),
          }));
        }
      },
      error: () => closeFailedSocket(ws),
      close: () => cleanupSocketRef(ws),
    });
    return ws;
  }

  function cancelStreamForTurn({ sessionId = "", turnScopeId = "", dialogProcessId = "" } = {}) {
    const context = activeStreamContext;
    if (!context) return false;
    const scope = context.scope || {};
    const sameSession = !sessionId || !scope.sessionId || String(sessionId) === String(scope.sessionId);
    const sameTurn = !turnScopeId || !scope.turnScopeId || String(turnScopeId) === String(scope.turnScopeId);
    const sameDialog = !dialogProcessId || !scope.dialogProcessId || String(dialogProcessId) === String(scope.dialogProcessId);
    if (!sameSession || !sameTurn || !sameDialog) return false;
    const pending = resolveCurrentStream;
    if (pending?.serial === context.serial && typeof pending.fn === "function") {
      pending.fn();
      return true;
    }
    activeStreamContext = null;
    return true;
  }

  function connect() {
    const attempt = transport.acquire();
    if (!attempt?.socket || attempt.reused) return attempt?.socket || null;
    return attachTransportHandlers(attempt.socket);
  }

  async function stream(payload = {}, onEvent = () => {}, options = {}) {
    return new Promise((resolve, reject) => {
      const currentStreamSerial = ++streamSerial;
      const streamScope = normalizeScopeFromPayload(payload);
      activeStreamContext = {
        serial: currentStreamSerial,
        payload,
        scope: streamScope,
        socket: null,
      };
      let settled = false;
      let doneReceived = false;
      let terminalChannelStateTimer = null;
      let handshakeTimeout = null;
      let authenticationRetryStarted = false;
      let unregisterStreamHandlers = () => {};
      let unregisterHandshakeHandlers = () => {};
      const finalize = (fn) => {
        if (settled) return;
        settled = true;
        if (terminalChannelStateTimer) {
          clearTimeout(terminalChannelStateTimer);
          terminalChannelStateTimer = null;
        }
        if (handshakeTimeout) {
          clearTimeout(handshakeTimeout);
          handshakeTimeout = null;
        }
        if (activeStreamContext?.serial === currentStreamSerial) {
          activeStreamContext = null;
        }
        if (resolveCurrentStream?.serial === currentStreamSerial) {
          resolveCurrentStream = null;
        }
        unregisterHandshakeHandlers();
        unregisterStreamHandlers();
        fn();
      };

      const scheduleTerminalChannelStateFinalize = (data = {}) => {
        if (settled || doneReceived || terminalChannelStateTimer) return;
        terminalChannelStateTimer = setTimeout(() => {
          terminalChannelStateTimer = null;
          if (settled || doneReceived) return;
          doneReceived = true;
          finalize(() => resolve());
        }, Math.max(0, Number(terminalChannelStateGraceMs || 0)));
      };

      let ws = null;
      beginHandshake();

      function rejectHandshake() {
        finalize(() => reject(new Error(translateText("infra.websocketStreamError"))));
      }

      async function recoverHandshakeAuthentication(failedSocket) {
        if (settled || authenticationRetryStarted) return;
        if (typeof refreshAuthentication !== "function") {
          rejectHandshake();
          return;
        }
        authenticationRetryStarted = true;
        if (handshakeTimeout) {
          clearTimeout(handshakeTimeout);
          handshakeTimeout = null;
        }
        transport.noteFailure(failedSocket);
        try { failedSocket?.close?.(1000, "authentication_retry"); } catch {}
        const refreshed = await transport.refreshCredentials();
        if (settled) return;
        if (refreshed !== true) {
          rejectHandshake();
          return;
        }
        transport.scheduleReconnect(beginHandshake, { immediate: true });
      }

      function bindHandshakeHandlers(candidate) {
        unregisterHandshakeHandlers();
        unregisterHandshakeHandlers = registerSocketHandlers(candidate, `handshake:${currentStreamSerial}`, {
          open: () => {
            if (!settled && candidate === getActiveSocket()) onSocketReady();
          },
          error: () => void recoverHandshakeAuthentication(candidate),
          close: () => void recoverHandshakeAuthentication(candidate),
        });
      }

      function beginHandshake() {
        if (settled) return;
        ws = getActiveSocket();
        if (!ws || ![WebSocket.OPEN, WebSocket.CONNECTING].includes(ws.readyState)) {
          connect();
          ws = getActiveSocket();
        }
        if (!ws) {
          rejectHandshake();
          return;
        }
        if (ws.readyState === WebSocket.OPEN) {
          onSocketReady();
          return;
        }
        bindHandshakeHandlers(ws);
        if (!handshakeTimeout) {
          handshakeTimeout = setTimeout(() => {
            handshakeTimeout = null;
            void recoverHandshakeAuthentication(ws);
          }, TIME_THRESHOLDS.client.wsReconnectTimeoutMs);
        }
      }

      function onSocketReady() {
        if (handshakeTimeout) {
          clearTimeout(handshakeTimeout);
          handshakeTimeout = null;
        }
        ws = getActiveSocket();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          finalize(() =>
            reject(new Error(translateText("infra.websocketStreamError"))),
          );
          return;
        }
        transport.markOpen(ws);
        if (activeStreamContext?.serial === currentStreamSerial) {
          activeStreamContext = {
            ...activeStreamContext,
            socket: ws,
          };
        }
        resolveCurrentStream = {
          serial: currentStreamSerial,
          fn: () => finalize(() => resolve()),
          reject: (error) => finalize(() => reject(error)),
        };
        bindStreamSocketHandlers(ws);

        try {
          logAgentTransportCommand(
            "frontend.agentTransport.commandSending",
            payload,
            { transport: "websocket", stream: true },
          );
          ws.send(JSON.stringify(payload || {}));
          logAgentTransportCommand(
            "frontend.agentTransport.commandSent",
            payload,
            { transport: "websocket", stream: true },
          );
        } catch (error) {
          logAgentTransportCommand(
            "frontend.agentTransport.commandSendFailed",
            payload,
            {
              transport: "websocket",
              stream: true,
              errorType: String(error?.name || "Error"),
              errorCode: String(error?.code || ""),
            },
          );
          cleanupSocketRef(ws);
          finalize(() => reject(error));
          try { ws.close?.(1011, "stream_send_failed"); } catch {}
          return;
        }
        if (typeof options?.onPayloadSent === "function") {
          options.onPayloadSent(payload || {});
        }
      }

      function bindStreamSocketHandlers(streamSocket) {
        if (!streamSocket) return;
        unregisterHandshakeHandlers();
        unregisterStreamHandlers();
        const handleProtocolEvent = ({ event, data }) => {
          if (settled) return;
          try {
            if (event === "transport_ready") return;
            onEvent({ event, data });
            const eventMatchesCurrentStream = isEventForStreamScope(data, payload);
            const eventCanSettleCurrentStream = canSettleStreamForEvent(data, payload);
            if (event === StreamEventEnum.ERROR && eventMatchesCurrentStream) {
              finalize(() => reject(createStreamEventError(data, translateText)));
              return;
            }
            if (event === StreamEventEnum.DONE && eventCanSettleCurrentStream) {
              doneReceived = true;
              finalize(() => resolve());
            } else if (event === StreamEventEnum.USER_STOPPED && eventCanSettleCurrentStream) {
              doneReceived = true;
              finalize(() => resolve());
            } else if (eventCanSettleCurrentStream && isTerminalChannelStateEvent(event, data)) {
              scheduleTerminalChannelStateFinalize(data);
            }
          } catch (error) {
            finalize(() => reject(error));
            streamSocket.close(1011, "invalid_event");
          }
        };
        unregisterStreamHandlers = registerSocketHandlers(streamSocket, `stream:${currentStreamSerial}`, {
          error: () => cleanupSocketRef(streamSocket),
          close: () => {
          if (doneReceived) {
            finalize(() => resolve());
            return;
          }
          cleanupSocketRef(streamSocket);
          if (!settled) {
            finalize(() =>
              reject(new Error(translateText("infra.websocketStreamError"))),
            );
          }
          },
        });
        if (activeStreamContext?.serial === currentStreamSerial) {
          activeStreamContext = {
            ...activeStreamContext,
            socket: streamSocket,
            rebindSocket: bindStreamSocketHandlers,
            handleProtocolEvent,
          };
          const pending = pendingMessageEvents.splice(0, pendingMessageEvents.length);
          for (const packet of pending) {
            if (isEventForStreamScope(packet.data, payload)) handleProtocolEvent(packet);
            else pendingMessageEvents.push(packet);
          }
        }
      }
    });
  }

  async function reconnect({
    currentSessionId = "",
    userId = "",
    knownLifecycleSequenceMap = {},
    onReconnectData = () => {},
  } = {}) {
    return new Promise((resolve, reject) => {
      if (reconnecting) {
        reject(new Error(translateText("infra.reconnectInProgress")));
        return;
      }
      reconnecting = true;
      reconnectResolve = resolve;
      reconnectReject = reject;
      const requestId = nextRequestId("reconnect");

      const currentSocket = getActiveSocket();
      const reusableSocket = currentSocket &&
        [WebSocket.OPEN, WebSocket.CONNECTING].includes(currentSocket.readyState)
        ? currentSocket
        : null;
      const replacement = reusableSocket ? null : transport.replace();
      const previousSocket = reusableSocket ? null : replacement?.previousSocket;
      const ws = reusableSocket || replacement?.socket;
      if (!ws) {
        reconnecting = false;
        reconnectReject = null;
        reconnectResolve = null;
        reject(new Error(translateText("infra.reconnectConnectFailed")));
        return;
      }
      if (replacement?.socket) {
        attachTransportHandlers(ws);
        activeStreamContext?.rebindSocket?.(ws);
      }
      const retirePreviousSocket = () => {
        if (!previousSocket || previousSocket === ws) return;
        try {
          previousSocket.close(1000, "replaced_by_reconnect");
        } catch {}
      };
      let unregisterReconnectHandlers = () => {};
      const failReconnect = (error, { closeSocket = false, rejectRequests = true } = {}) => {
        if (!reconnecting) return;
        reconnecting = false;
        clearTimers();
        cleanupSocketRef(ws);
        unregisterReconnectHandlers();
        if (activeReconnectContext?.requestId === requestId) activeReconnectContext = null;
        const rejectFn = reconnectReject;
        reconnectReject = null;
        reconnectResolve = null;
        if (rejectRequests) commandRequests.rejectAll(error);
        if (closeSocket) {
          try { ws.close(1011, "reconnect_failed"); } catch {}
        }
        rejectFn?.(error);
      };

      reconnectTimeout = setTimeout(() => {
        failReconnect(new Error(translateText("infra.reconnectTimeout")), { closeSocket: true });
      }, RECONNECT_TIMEOUT_MS);

      const sendReconnectCommand = () => {
        try {
          transport.markOpen(ws);
          ws.send(JSON.stringify({
            action: "reconnect",
            requestId,
            currentSessionId: String(currentSessionId || "").trim(),
            userId: String(userId || "").trim(),
            knownLifecycleSequenceMap:
              knownLifecycleSequenceMap && typeof knownLifecycleSequenceMap === "object"
                ? knownLifecycleSequenceMap
                : {},
          }));
        } catch (error) {
          failReconnect(error, { closeSocket: true });
        }
      };
      const handleReconnectProtocolEvent = ({ event, data }) => {
        try {
          if (event === "transport_ready") return;

          if (event === StreamEventEnum.RECONNECT_DATA) {
            if (normalizeTrimmedString(data?.requestId) && data.requestId !== requestId) {
              logWorkflowDiagnostics("frontend.websocket.reconnectControlRejected", () => ({
                sessionId: normalizeTrimmedString(data?.sessionId || currentSessionId),
                protocolEvent: event,
                reason: "request_id_mismatch",
              }));
              return;
            }
            onReconnectData(data);
            return;
          }

          if (event === StreamEventEnum.RECONNECT_COMPLETE) {
            if (normalizeTrimmedString(data?.requestId) && data.requestId !== requestId) {
              logWorkflowDiagnostics("frontend.websocket.reconnectControlRejected", () => ({
                sessionId: normalizeTrimmedString(data?.sessionId || currentSessionId),
                protocolEvent: event,
                reason: "request_id_mismatch",
              }));
              return;
            }
            reconnecting = false;
            clearTimers();
            retirePreviousSocket();
            const resolveFn = reconnectResolve;
            reconnectResolve = null;
            reconnectReject = null;
            liveEventSubscriber = onReconnectData;
            unregisterReconnectHandlers();
            if (activeReconnectContext?.requestId === requestId) activeReconnectContext = null;
            if (resolveFn) resolveFn(data);
            return;
          }

          if (!activeStreamContext) {
            onReconnectData({ event, data });
          }
        } catch (error) {
          failReconnect(error, { closeSocket: true });
        }
      };
      activeReconnectContext = { requestId, handleProtocolEvent: handleReconnectProtocolEvent };
      unregisterReconnectHandlers = registerSocketHandlers(ws, "reconnect", {
      open: sendReconnectCommand,

      error: () => {
        failReconnect(new Error(translateText("infra.reconnectConnectFailed")));
      },

      close: () => {
        failReconnect(new Error(translateText("infra.reconnectClosed")));
      },
      });
      if (reusableSocket && ws.readyState === WebSocket.OPEN) {
        sendReconnectCommand();
      }
    });
  }

  function requestStop(stopPayload = {}) {
    return requestJson(
      stopPayload,
      { expectedEvents: [StreamEventEnum.TURN_LIFECYCLE] },
    ).then(() => true);
  }

  const sendJson = commandRequests.sendJson;
  const requestJson = commandRequests.requestJson;

  function dispose() {
    clearTimers();
    commandRequests.rejectAll(new Error("websocket_client_disposed"));
    transport.dispose();
    resolveCurrentStream = null;
    activeStreamContext = null;
    reconnecting = false;
    reconnectResolve = null;
    reconnectReject = null;
    liveEventSubscriber = null;
    activeReconnectContext = null;
  }

  return {
    connect,
    stream,
    reconnect,
    requestStop,
    cancelStreamForTurn,
    sendJson,
    requestJson,
    getActiveSocket,
    getTransportStatus: transport.status,
    dispose,
  };
}
