/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../shared/constants/chatConstants";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

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
  let activeSocket = null;
  let stopRequested = false;
  let stopRequestedTurnScopeId = "";
  let stopConfirmationTimer = null;
  let resolveCurrentStream = null;
  let streamSerial = 0;
  let activeStreamContext = null;
  let stopLeaseSerial = 0;
  let activeStopLease = null;

  // Reconnect state
  let lastReceivedSeqMap = {};
  let reconnecting = false;
  let reconnectResolve = null;
  let reconnectReject = null;
  let reconnectTimeout = null;
  const RECONNECT_TIMEOUT_MS = TIME_THRESHOLDS.client.wsReconnectTimeoutMs;

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
    if (activeSocket === ws) {
      activeSocket = null;
    }
  }

  function getActiveSocket() {
    return activeSocket;
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

  function getStopRequestedTurnScopeId() {
    return stopRequestedTurnScopeId;
  }

  function getLastReceivedSeqMap() {
    return { ...lastReceivedSeqMap };
  }

  function clearLastReceivedSeqMap() {
    lastReceivedSeqMap = {};
  }

  function hasReconnectState() {
    return Object.keys(lastReceivedSeqMap).length > 0;
  }

  function updateLastReceivedSeq(dialogProcessId, seq) {
    const dpId = String(dialogProcessId || "").trim();
    if (!dpId) return;
    const currentSeq = Number(lastReceivedSeqMap[dpId] || 0);
    if (Number(seq || 0) > currentSeq) {
      lastReceivedSeqMap[dpId] = Number(seq);
    }
  }

  function trackIncomingEvent(data = {}) {
    const dialogProcessId = String(data?.dialogProcessId || "").trim();
    const sequence = Number(data?.seq || 0);
    if (dialogProcessId && sequence > 0) {
      updateLastReceivedSeq(dialogProcessId, sequence);
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
    if (dpId) delete lastReceivedSeqMap[dpId];
  }

  function connect() {
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      return; // 已连接，不重复建立
    }
    if (activeSocket && activeSocket.readyState === WebSocket.CONNECTING) {
      return; // 正在连接中
    }
    const wsUrl = resolveWebSocketUrl();
    const ws = new WebSocket(wsUrl);
    activeSocket = ws;
    ws.onopen = () => {
      // 连接建立后不发送任何消息，仅保持连接
    };
    ws.onmessage = (messageEvent) => {
      try {
        const parsed = JSON.parse(String(messageEvent?.data || "{}"));
        const event = String(parsed?.event || "message");
        const data = parsed?.data || {};
        trackIncomingEvent(data);
        if (event === StreamEventEnum.DONE || event === StreamEventEnum.USER_STOPPED) {
          const dialogProcessId = String(data?.dialogProcessId || "");
          if (dialogProcessId) {
            removeLastReceivedSeq(dialogProcessId);
          }
        }
      } catch (e) {
        // 静默处理，不中断连接
      }
    };
    ws.onerror = () => {
      // 错误时清理引用，让下次 connect 重试
      cleanupSocketRef(ws);
    };
    ws.onclose = () => {
      cleanupSocketRef(ws);
    };
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
      activeStopLease = null;
      clearStopConfirmationTimer();
      stopRequested = false;
      let settled = false;
      let doneReceived = false;
      let terminalChannelStateTimer = null;
      const finalize = (fn) => {
        if (settled) return;
        settled = true;
        if (terminalChannelStateTimer) {
          clearTimeout(terminalChannelStateTimer);
          terminalChannelStateTimer = null;
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

      // 复用已有连接，如果没有则新建
      let ws = getActiveSocket();
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connect();
        // 等待连接建立
        const waitOpen = () => {
          ws = getActiveSocket();
          if (ws && ws.readyState === WebSocket.OPEN) {
            onSocketReady();
          } else if (ws && ws.readyState === WebSocket.CONNECTING) {
            // 监听 once
            const origOnOpen = ws.onopen;
            ws.onopen = (e) => {
              if (typeof origOnOpen === "function") origOnOpen(e);
              onSocketReady();
            };
          } else {
            // 连接失败
            finalize(() =>
              reject(new Error(translateText("infra.websocketStreamError"))),
            );
          }
        };
        setTimeout(waitOpen, TIME_THRESHOLDS.client.wsOpenPollIntervalMs);
      } else {
        onSocketReady();
      }

      function onSocketReady() {
        ws = getActiveSocket();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          finalize(() =>
            reject(new Error(translateText("infra.websocketStreamError"))),
          );
          return;
        }
        activeSocket = ws;
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

        ws.send(JSON.stringify(payload || {}));
        if (typeof options?.onPayloadSent === "function") {
          options.onPayloadSent(payload || {});
        }
      }

      function bindStreamSocketHandlers(streamSocket) {
        if (!streamSocket) return;
        streamSocket.onmessage = (messageEvent) => {
          if (settled) return;
          try {
            const parsed = JSON.parse(String(messageEvent?.data || "{}"));
            const event = String(parsed?.event || "message");
            const data = parsed?.data || {};
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
        };

        streamSocket.onerror = () => {
          // 错误时清理引用，不 reject（连接由 connect 管理）
          cleanupSocketRef(streamSocket);
        };

        streamSocket.onclose = () => {
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
        };
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

      const wsUrl = resolveWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      activeSocket = ws;

      reconnectTimeout = setTimeout(() => {
        if (reconnecting) {
          reconnecting = false;
          cleanupSocketRef(ws);
          try { ws.close(1000, "reconnect_timeout"); } catch {}
          reconnectReject = null;
          reject(new Error(translateText("infra.reconnectTimeout")));
        }
      }, RECONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          action: "reconnect",
          lastReceivedSeqMap: { ...lastReceivedSeqMap },
          currentSessionId: String(currentSessionId || "").trim(),
          userId: String(userId || "").trim(),
        }));
      };

      ws.onmessage = (messageEvent) => {
        try {
          const parsed = JSON.parse(String(messageEvent?.data || "{}"));
          const event = String(parsed?.event || "message");
          const data = parsed?.data || {};

          if (event === StreamEventEnum.RECONNECT_DATA) {
            trackReconnectData(data);
            onReconnectData(data);
            return;
          }

          if (event === StreamEventEnum.RECONNECT_COMPLETE) {
            reconnecting = false;
            clearTimers();
            const resolveFn = reconnectResolve;
            reconnectResolve = null;
            reconnectReject = null;
            if (resolveFn) resolveFn(data);
            return;
          }

          trackIncomingEvent(data);

          onReconnectData({ event, data });
        } catch (error) {
          reconnecting = false;
          clearTimers();
          cleanupSocketRef(ws);
          const rejectFn = reconnectReject;
          reconnectReject = null;
          reconnectResolve = null;
          if (rejectFn) rejectFn(error);
        }
      };

      ws.onerror = () => {
        reconnecting = false;
        clearTimers();
        cleanupSocketRef(ws);
        const rejectFn = reconnectReject;
        reconnectReject = null;
        reconnectResolve = null;
        rejectFn?.(new Error(translateText("infra.reconnectConnectFailed")));
      };

      ws.onclose = () => {
        if (reconnecting) {
          reconnecting = false;
          clearTimers();
          cleanupSocketRef(ws);
          const rejectFn = reconnectReject;
          reconnectReject = null;
          reconnectResolve = null;
          rejectFn?.(new Error(translateText("infra.reconnectClosed")));
        }
      };
    });
  }

  function requestStop(stopPayloadOrTimeout = {}, onStopConfirmationTimeout = () => {}) {
    const ws = activeSocket;
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
    const ws = activeSocket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(translateText("infra.interactionChannelUnavailable"));
    }
    ws.send(JSON.stringify(payload || {}));
  }

  function dispose() {
    clearTimers();
    const ws = activeSocket;
    if (ws) {
      try {
        ws.close(1000, "dispose");
      } catch {}
      activeSocket = null;
    }
    resolveCurrentStream = null;
    activeStreamContext = null;
    activeStopLease = null;
    stopRequested = false;
    stopRequestedTurnScopeId = "";
    reconnecting = false;
    reconnectResolve = null;
    reconnectReject = null;
  }

  return {
    connect,
    stream,
    reconnect,
    requestStop,
    sendJson,
    getActiveSocket,
    isStopRequested,
    clearStopRequested,
    getStopRequestedTurnScopeId,
    getLastReceivedSeqMap,
    clearLastReceivedSeqMap,
    hasReconnectState,
    dispose,
  };
}
