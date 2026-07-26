/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../shared/constants/chatConstants";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { createWebSocketTransportSupervisor } from "./webSocketTransportSupervisor";
import { logWorkflowDiagnostics } from "../../composables/chat/debug/workflowDiagnosticsLogger";

const TERMINAL_CHANNEL_STATES = Object.freeze([
  "user_stopped",
  "error",
  "no_conversation",
  "expired",
  "cancelled",
]);

function normalizeTrimmedString(value = "") {
  return String(value || "").trim();
}

function isTerminalChannelStateEvent(event = "", data = {}) {
  return (
    normalizeTrimmedString(event) === StreamEventEnum.CHANNEL_STATE &&
    TERMINAL_CHANNEL_STATES.includes(normalizeTrimmedString(data?.state))
  );
}

function isEventForStreamScope(data = {}, payload = {}) {
  const payloadTurnScopeId = normalizeTrimmedString(payload?.turnScopeId);
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  if (payloadTurnScopeId && eventTurnScopeId && payloadTurnScopeId !== eventTurnScopeId) {
    return false;
  }
  const payloadDialogProcessId = normalizeTrimmedString(payload?.dialogProcessId);
  const eventDialogProcessId = normalizeTrimmedString(data?.dialogProcessId);
  if (
    payloadDialogProcessId &&
    eventDialogProcessId &&
    payloadDialogProcessId !== eventDialogProcessId
  ) {
    return false;
  }
  return true;
}

function canSettleStreamForEvent(data = {}, payload = {}) {
  if (!isEventForStreamScope(data, payload)) return false;
  const payloadTurnScopeId = normalizeTrimmedString(payload?.turnScopeId);
  const payloadDialogProcessId = normalizeTrimmedString(payload?.dialogProcessId);
  if (!payloadTurnScopeId && !payloadDialogProcessId) return true;
  return Boolean(
    normalizeTrimmedString(data?.turnScopeId) ||
      normalizeTrimmedString(data?.dialogProcessId),
  );
}

export function createChatWebSocketClient({
  resolveWebSocketUrl = () => "",
  refreshAuthentication = null,
  stopConfirmationTimeoutMs,
  forceStopFinalizeMs,
  terminalChannelStateGraceMs = TIME_THRESHOLDS.client.wsTerminalChannelStateGraceMs,
  translateText = (key = "") => String(key || ""),
} = {}) {
  const resolvedStopConfirmationTimeoutMs =
    Number.isFinite(Number(stopConfirmationTimeoutMs))
      ? Number(stopConfirmationTimeoutMs)
      : Number.isFinite(Number(forceStopFinalizeMs))
        ? Number(forceStopFinalizeMs)
        : TIME_THRESHOLDS.client.wsForceStopFinalizeMs;
  const transport = createWebSocketTransportSupervisor({
    channelId: "chat",
    resolveWebSocketUrl,
    refreshAuthentication,
  });
  let stopRequested = false;
  let stopRequestedTurnScopeId = "";
  let stopConfirmationTimer = null;
  let resolveCurrentStream = null;
  let streamSerial = 0;
  let activeStreamContext = null;
  let stopLeaseSerial = 0;
  let activeStopLease = null;
  let protocolRequestSerial = 0;

  // Reconnect state
  let lastReceivedSeqMap = {};
  let lastReceivedTurnScopeIdMap = {};
  let reconnecting = false;
  let reconnectResolve = null;
  let reconnectReject = null;
  let reconnectTimeout = null;
  let liveEventSubscriber = null;
  const pendingJsonRequests = new Map();
  const socketHandlerStores = new WeakMap();
  const RECONNECT_TIMEOUT_MS = TIME_THRESHOLDS.client.wsReconnectTimeoutMs;

  function nextRequestId(kind = "command") {
    protocolRequestSerial += 1;
    return `${kind}:${Date.now()}:${protocolRequestSerial}`;
  }

  function registerSocketHandlers(socket, owner, handlers = {}) {
    if (!socket || !owner) return () => {};
    let store = socketHandlerStores.get(socket);
    if (!store) {
      store = new Map();
      socketHandlerStores.set(socket, store);
      for (const eventName of ["open", "message", "error", "close"]) {
        socket[`on${eventName}`] = (event) => {
          for (const subscriber of [...store.values()]) {
            subscriber?.[eventName]?.(event);
          }
        };
      }
    }
    store.set(owner, handlers);
    return () => {
      if (store.get(owner) === handlers) store.delete(owner);
    };
  }

  function rejectPendingJsonRequests(error) {
    for (const pending of pendingJsonRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingJsonRequests.clear();
  }

  function settlePendingJsonRequest(event, data = {}) {
    const commandId = normalizeTrimmedString(data?.commandId);
    const pending = commandId ? pendingJsonRequests.get(commandId) : null;
    if (!pending) return;
    if (event !== "error" && pending.expectedEvents.size && !pending.expectedEvents.has(event)) return;
    pendingJsonRequests.delete(commandId);
    clearTimeout(pending.timeout);
    if (event === "error") {
      const error = new Error(data?.error || data?.errorCode || "execution_query_failed");
      error.event = event;
      error.data = data;
      pending.reject(error);
    } else {
      pending.resolve({ event, data });
    }
  }

  function normalizeScopeFromPayload(payload = {}) {
    return {
      sessionId: normalizeTrimmedString(payload?.sessionId),
      dialogProcessId: normalizeTrimmedString(payload?.dialogProcessId),
      turnScopeId: normalizeTrimmedString(payload?.turnScopeId),
    };
  }

  function clearStopConfirmationTimer() {
    if (stopConfirmationTimer) {
      clearTimeout(stopConfirmationTimer);
      stopConfirmationTimer = null;
    }
  }

  function clearTimers() {
    clearStopConfirmationTimer();
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

  function attachTransportHandlers(ws) {
    if (!ws) return null;
    registerSocketHandlers(ws, "transport", {
      open: () => transport.markOpen(ws),
      message: (messageEvent) => {
        try {
          const parsed = JSON.parse(String(messageEvent?.data || "{}"));
          const event = String(parsed?.event || "message");
          const data = parsed?.data || {};
          const hasLiveSubscriber = typeof liveEventSubscriber === "function";
          logWorkflowDiagnostics("frontend.websocket.transportEventReceived", {
            sessionId: normalizeTrimmedString(data?.sessionId),
            dialogProcessId: normalizeTrimmedString(data?.dialogProcessId),
            turnScopeId: normalizeTrimmedString(data?.turnScopeId),
            protocolEvent: event,
            transportSequence: Number(data?.seq || 0) || null,
            authoritativeSequence: Number(data?.event?.sequence || 0) || null,
            reconnecting,
            activeStream: Boolean(activeStreamContext),
            hasLiveSubscriber,
          });
          if (event === "transport_ready") {
            transport.markReady(ws, { nextServerInstanceId: data?.serverInstanceId });
            return;
          }
          trackIncomingEvent(data);
          if (event === StreamEventEnum.DONE || event === StreamEventEnum.USER_STOPPED) {
            removeLastReceivedSeq(data?.dialogProcessId);
          }
          settlePendingJsonRequest(event, data);
          if (
            !reconnecting &&
            !activeStreamContext &&
            hasLiveSubscriber &&
            event !== StreamEventEnum.RECONNECT_DATA &&
            event !== StreamEventEnum.RECONNECT_COMPLETE
          ) {
            liveEventSubscriber({ event, data });
            logWorkflowDiagnostics("frontend.websocket.liveEventDispatched", {
              sessionId: normalizeTrimmedString(data?.sessionId),
              dialogProcessId: normalizeTrimmedString(data?.dialogProcessId),
              turnScopeId: normalizeTrimmedString(data?.turnScopeId),
              protocolEvent: event,
              transportSequence: Number(data?.seq || 0) || null,
              authoritativeSequence: Number(data?.event?.sequence || 0) || null,
              route: "transport_live_subscriber",
            });
          }
        } catch {}
      },
      error: () => closeFailedSocket(ws),
      close: () => cleanupSocketRef(ws),
    });
    return ws;
  }

  function isStopRequested() {
    return stopRequested;
  }

  function clearStopRequested() {
    stopRequested = false;
    stopRequestedTurnScopeId = "";
    activeStopLease = null;
    clearStopConfirmationTimer();
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
    if (pending?.serial === context.serial && typeof pending.reject === "function") {
      pending.reject(new Error("stream_cancelled_by_message_delete"));
      return true;
    }
    activeStreamContext = null;
    return true;
  }

  function getStopRequestedTurnScopeId() {
    return stopRequestedTurnScopeId;
  }

  function getLastReceivedSeqMap() {
    return { ...lastReceivedSeqMap };
  }

  function clearLastReceivedSeqMap() {
    lastReceivedSeqMap = {};
    lastReceivedTurnScopeIdMap = {};
  }

  function hasReconnectState() {
    return Object.keys(lastReceivedSeqMap).length > 0;
  }

  function updateLastReceivedSeq(dialogProcessId, seq, turnScopeId = "") {
    const dpId = String(dialogProcessId || "").trim();
    if (!dpId) return;
    const currentSeq = Number(lastReceivedSeqMap[dpId] || 0);
    if (Number(seq || 0) > currentSeq) {
      lastReceivedSeqMap[dpId] = Number(seq);
    }
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (normalizedTurnScopeId) {
      lastReceivedTurnScopeIdMap[dpId] = normalizedTurnScopeId;
    }
  }

  function trackIncomingEvent(data = {}) {
    const dialogProcessId = String(data?.dialogProcessId || "").trim();
    const sequence = Number(data?.seq || 0);
    if (dialogProcessId && sequence > 0) {
      updateLastReceivedSeq(dialogProcessId, sequence, data?.turnScopeId);
    }
  }

  function createStreamEventError(data = {}) {
    const error = new Error(data?.error || translateText("infra.websocketStreamError"));
    error.event = StreamEventEnum.ERROR;
    error.data = data || {};
    return error;
  }

  function createStopConfirmationTimeoutError(data = {}) {
    const error = new Error(
      translateText("chat.stopRequestTimeout") ||
        translateText("infra.websocketStreamError") ||
        "Stop request timed out before backend confirmation",
    );
    error.event = "stop_confirmation_timeout";
    error.code = "STOP_CONFIRMATION_TIMEOUT";
    error.data = {
      error: error.message,
      ...(data || {}),
    };
    return error;
  }

  function trackReconnectData(data = {}) {
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    for (const sessionEntry of sessions) {
      const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
        ? sessionEntry.dialogProcesses
        : [];
      for (const dialogProcess of dialogProcesses) {
        const dialogProcessId = String(dialogProcess?.dialogProcessId || "").trim();
        const messages = Array.isArray(dialogProcess?.messages)
          ? dialogProcess.messages
          : [];
        for (const envelope of messages) {
          const event = String(envelope?.event || "").trim();
          const eventData =
            envelope?.data && typeof envelope.data === "object" ? envelope.data : {};
          trackIncomingEvent({
            ...eventData,
            dialogProcessId: String(eventData?.dialogProcessId || dialogProcessId || "").trim(),
          });
          if (event === StreamEventEnum.DONE || event === StreamEventEnum.USER_STOPPED) {
            removeLastReceivedSeq(dialogProcessId || eventData?.dialogProcessId || "");
          }
        }
      }
    }
  }

  function removeLastReceivedSeq(dialogProcessId) {
    const dpId = String(dialogProcessId || "").trim();
    if (dpId) {
      delete lastReceivedSeqMap[dpId];
      delete lastReceivedTurnScopeIdMap[dpId];
    }
  }

  function connect() {
    const attempt = transport.acquire();
    if (!attempt?.socket || attempt.reused) return attempt?.socket || null;
    return attachTransportHandlers(attempt.socket);
  }

  async function stream(payload = {}, onEvent = () => {}, options = {}) {
    return new Promise((resolve, reject) => {
      payload = {
        ...payload,
        requestId: normalizeTrimmedString(payload?.requestId) || nextRequestId("stream"),
      };
      const currentStreamSerial = ++streamSerial;
      const streamScope = normalizeScopeFromPayload(payload);
      activeStreamContext = {
        serial: currentStreamSerial,
        payload,
        scope: streamScope,
        socket: null,
      };
      activeStopLease = null;
      clearStopConfirmationTimer();
      stopRequested = false;
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
        clearStopConfirmationTimer();
        if (activeStopLease?.streamSerial === currentStreamSerial) {
          activeStopLease = null;
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
          if (data?.dialogProcessId) {
            removeLastReceivedSeq(data.dialogProcessId);
          }
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
          ws.send(JSON.stringify(payload || {}));
        } catch (error) {
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
        unregisterStreamHandlers = registerSocketHandlers(streamSocket, `stream:${currentStreamSerial}`, {
          message: (messageEvent) => {
          if (settled) return;
          try {
            const parsed = JSON.parse(String(messageEvent?.data || "{}"));
            const event = String(parsed?.event || "message");
            const data = parsed?.data || {};
            if (event === "transport_ready") return;
            trackIncomingEvent(data);
            // Clear seq on done/stopped
            if (event === StreamEventEnum.DONE || event === StreamEventEnum.USER_STOPPED) {
              if (data?.dialogProcessId) {
                removeLastReceivedSeq(data.dialogProcessId);
              }
            }
            onEvent({ event, data });
            const eventMatchesCurrentStream = isEventForStreamScope(data, payload);
            const eventCanSettleCurrentStream = canSettleStreamForEvent(data, payload);
            if (event === StreamEventEnum.ERROR && eventMatchesCurrentStream) {
              finalize(() => reject(createStreamEventError(data)));
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
          },
          error: () => cleanupSocketRef(streamSocket),
          close: () => {
          if (doneReceived) {
            finalize(() => resolve());
            return;
          }
          // 未收到 done/stopped 就断开，按异常处理，避免 UI 一直显示“等待实时日志”
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
          };
        }
      }
    });
  }

  async function reconnect({ currentSessionId = "", userId = "", onReconnectData = () => {} } = {}) {
    return new Promise((resolve, reject) => {
      if (reconnecting) {
        reject(new Error(translateText("infra.reconnectInProgress")));
        return;
      }
      reconnecting = true;
      reconnectResolve = resolve;
      reconnectReject = reject;
      const requestId = nextRequestId("reconnect");

      // Reconnect is a logical command on the existing business transport.
      // Stream and replay subscribers are multiplexed by the dispatcher, so an
      // active stream no longer requires a second physical socket.
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
        const rejectFn = reconnectReject;
        reconnectReject = null;
        reconnectResolve = null;
        if (rejectRequests) rejectPendingJsonRequests(error);
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
            lastReceivedSeqMap: { ...lastReceivedSeqMap },
            lastReceivedTurnScopeIdMap: { ...lastReceivedTurnScopeIdMap },
            currentTurnScopeId: String(activeStreamContext?.scope?.turnScopeId || "").trim(),
            currentSessionId: String(currentSessionId || "").trim(),
            userId: String(userId || "").trim(),
          }));
        } catch (error) {
          failReconnect(error, { closeSocket: true });
        }
      };
      unregisterReconnectHandlers = registerSocketHandlers(ws, "reconnect", {
      open: sendReconnectCommand,
      message: (messageEvent) => {
        try {
          const parsed = JSON.parse(String(messageEvent?.data || "{}"));
          const event = String(parsed?.event || "message");
          const data = parsed?.data || {};
          if (event === "transport_ready") return;

          if (event === StreamEventEnum.RECONNECT_DATA) {
            if (normalizeTrimmedString(data?.requestId) && data.requestId !== requestId) {
              logWorkflowDiagnostics("frontend.websocket.reconnectControlRejected", {
                sessionId: normalizeTrimmedString(data?.sessionId || currentSessionId),
                protocolEvent: event,
                reason: "request_id_mismatch",
              });
              return;
            }
            trackReconnectData(data);
            onReconnectData(data);
            return;
          }

          if (event === StreamEventEnum.RECONNECT_COMPLETE) {
            if (normalizeTrimmedString(data?.requestId) && data.requestId !== requestId) {
              logWorkflowDiagnostics("frontend.websocket.reconnectControlRejected", {
                sessionId: normalizeTrimmedString(data?.sessionId || currentSessionId),
                protocolEvent: event,
                reason: "request_id_mismatch",
              });
              return;
            }
            reconnecting = false;
            clearTimers();
            // A reconnect during an active stream necessarily created a
            // replacement transport. Retire the old socket after replay has
            // completed so repeated online/focus signals cannot accumulate
            // live sockets on the server.
            retirePreviousSocket();
            const resolveFn = reconnectResolve;
            reconnectResolve = null;
            reconnectReject = null;
            liveEventSubscriber = onReconnectData;
            unregisterReconnectHandlers();
            if (resolveFn) resolveFn(data);
            return;
          }

          trackIncomingEvent(data);

          if (!activeStreamContext) {
            onReconnectData({ event, data });
            logWorkflowDiagnostics("frontend.websocket.liveEventDispatched", {
              sessionId: normalizeTrimmedString(data?.sessionId),
              dialogProcessId: normalizeTrimmedString(data?.dialogProcessId),
              turnScopeId: normalizeTrimmedString(data?.turnScopeId),
              protocolEvent: event,
              transportSequence: Number(data?.seq || 0) || null,
              authoritativeSequence: Number(data?.event?.sequence || 0) || null,
              route: "reconnect_live_subscriber",
              requestIdMatchesReconnect: normalizeTrimmedString(data?.requestId) === requestId,
            });
          }
          settlePendingJsonRequest(event, data);
        } catch (error) {
          failReconnect(error, { closeSocket: true });
        }
      },

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

  function requestStop(stopPayloadOrTimeout = {}, onStopConfirmationTimeout = () => {}) {
    const ws = getActiveSocket();
    const firstArgIsTimeoutCallback = typeof stopPayloadOrTimeout === "function";
    const normalizedStopPayload =
      !firstArgIsTimeoutCallback &&
      stopPayloadOrTimeout &&
      typeof stopPayloadOrTimeout === "object"
        ? stopPayloadOrTimeout
        : {};
    const notifyStopConfirmationTimeout =
      firstArgIsTimeoutCallback
        ? stopPayloadOrTimeout
        : typeof onStopConfirmationTimeout === "function"
        ? onStopConfirmationTimeout
        : () => {};
    const requestedTurnScopeId = normalizeTrimmedString(normalizedStopPayload?.turnScopeId);
    stopRequested = true;
    stopRequestedTurnScopeId = requestedTurnScopeId;
    const stopScope = normalizeScopeFromPayload(normalizedStopPayload);
    const stoppedStreamContext = activeStreamContext;
    const stopLease = {
      serial: ++stopLeaseSerial,
      streamSerial: stoppedStreamContext?.serial || 0,
      socket: ws || null,
      scope: stopScope,
      cancelled: false,
    };
    activeStopLease = stopLease;

    const notifyStopConfirmationTimeoutIfLeaseStillCurrent = () => {
      if (activeStopLease !== stopLease || stopLease.cancelled) return;
      const streamContext = activeStreamContext;
      const streamStillMatches =
        streamContext &&
        streamContext.serial === stopLease.streamSerial &&
        (!stopLease.socket || streamContext.socket === stopLease.socket);
      if (!streamStillMatches) return;
      notifyStopConfirmationTimeout({
        sessionId: stopScope.sessionId,
        dialogProcessId: stopScope.dialogProcessId,
        turnScopeId: stopScope.turnScopeId,
        stopLeaseSerial: stopLease.serial,
        streamSerial: stopLease.streamSerial,
      });
      const rejectStream = resolveCurrentStream;
      if (
        rejectStream &&
        rejectStream.serial === stopLease.streamSerial &&
        typeof rejectStream.reject === "function"
      ) {
        rejectStream.reject(createStopConfirmationTimeoutError({
          sessionId: stopScope.sessionId,
          dialogProcessId: stopScope.dialogProcessId,
          turnScopeId: stopScope.turnScopeId,
        }));
      }
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ action: "stop", ...normalizedStopPayload }));
      } catch {}
      clearStopConfirmationTimer();
      stopConfirmationTimer = setTimeout(() => {
        stopConfirmationTimer = null;
        notifyStopConfirmationTimeoutIfLeaseStillCurrent();
      }, resolvedStopConfirmationTimeoutMs);
      return true;
    }

    if (ws && ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, "stop_requested");
      clearStopConfirmationTimer();
      stopConfirmationTimer = setTimeout(() => {
        stopConfirmationTimer = null;
        notifyStopConfirmationTimeoutIfLeaseStillCurrent();
      }, resolvedStopConfirmationTimeoutMs);
      return true;
    }

    return false;
  }

  function sendJson(payload = {}) {
    const ws = getActiveSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(translateText("infra.interactionChannelUnavailable"));
    }
    ws.send(JSON.stringify(payload || {}));
  }

  function requestJson(payload = {}, { expectedEvents = [], timeoutMs = RECONNECT_TIMEOUT_MS } = {}) {
    const commandId = normalizeTrimmedString(payload?.commandId);
    if (!commandId) return Promise.reject(new Error("commandId is required"));
    if (pendingJsonRequests.has(commandId)) {
      return Promise.reject(new Error("commandId request already pending"));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingJsonRequests.delete(commandId);
        reject(new Error(translateText("infra.websocketRequestTimeout") || "websocket_request_timeout"));
      }, Number(timeoutMs) > 0 ? Number(timeoutMs) : RECONNECT_TIMEOUT_MS);
      pendingJsonRequests.set(commandId, {
        resolve,
        reject,
        timeout,
        expectedEvents: new Set((Array.isArray(expectedEvents) ? expectedEvents : [expectedEvents]).filter(Boolean)),
      });
      try {
        sendJson(payload);
      } catch (error) {
        clearTimeout(timeout);
        pendingJsonRequests.delete(commandId);
        reject(error);
      }
    });
  }

  function dispose() {
    clearTimers();
    rejectPendingJsonRequests(new Error("websocket_client_disposed"));
    transport.dispose();
    resolveCurrentStream = null;
    activeStreamContext = null;
    activeStopLease = null;
    stopRequested = false;
    stopRequestedTurnScopeId = "";
    reconnecting = false;
    reconnectResolve = null;
    reconnectReject = null;
    liveEventSubscriber = null;
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
    isStopRequested,
    clearStopRequested,
    getStopRequestedTurnScopeId,
    getLastReceivedSeqMap,
    clearLastReceivedSeqMap,
    hasReconnectState,
    dispose,
  };
}
