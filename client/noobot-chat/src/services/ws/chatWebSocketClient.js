/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../shared/constants/chatConstants";

export function createChatWebSocketClient({
  resolveWebSocketUrl = () => "",
  stopCloseDelayMs = 300,
  forceStopFinalizeMs = 5000,
  translateText = (key = "") => String(key || ""),
} = {}) {
  let activeSocket = null;
  let stopRequested = false;
  let stopCloseTimer = null;
  let forceStopFinalizeTimer = null;
  let resolveCurrentStream = null;

  // Reconnect state
  let lastReceivedSeqMap = {};
  let reconnecting = false;
  let reconnectResolve = null;
  let reconnectReject = null;
  let reconnectTimeout = null;
  const RECONNECT_TIMEOUT_MS = 15000;

  function clearTimers() {
    if (stopCloseTimer) {
      clearTimeout(stopCloseTimer);
      stopCloseTimer = null;
    }
    if (forceStopFinalizeTimer) {
      clearTimeout(forceStopFinalizeTimer);
      forceStopFinalizeTimer = null;
    }
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
          if (event === StreamEventEnum.DONE || event === StreamEventEnum.STOPPED) {
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
        if (event === StreamEventEnum.DONE || event === StreamEventEnum.STOPPED) {
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

  async function stream(payload = {}, onEvent = () => {}) {
    return new Promise((resolve, reject) => {
      stopRequested = false;
      let settled = false;
      let doneReceived = false;
      const finalize = (fn) => {
        if (settled) return;
        settled = true;
        clearTimers();
        resolveCurrentStream = null;
        fn();
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
        setTimeout(waitOpen, 100);
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
        resolveCurrentStream = () => finalize(() => resolve());
        bindStreamSocketHandlers(ws);

        ws.send(JSON.stringify(payload || {}));
      }

      function bindStreamSocketHandlers(streamSocket) {
        if (!streamSocket) return;
        streamSocket.onmessage = (messageEvent) => {
          try {
            const parsed = JSON.parse(String(messageEvent?.data || "{}"));
            const event = String(parsed?.event || "message");
            const data = parsed?.data || {};
            if (event === StreamEventEnum.ERROR) {
              throw new Error(
                data?.error || translateText("infra.websocketStreamError"),
              );
            }
            trackIncomingEvent(data);
            // Clear seq on done/stopped
            if (event === StreamEventEnum.DONE || event === StreamEventEnum.STOPPED) {
              if (data?.dialogProcessId) {
                removeLastReceivedSeq(data.dialogProcessId);
              }
            }
            onEvent({ event, data });
            if (event === StreamEventEnum.DONE) {
              doneReceived = true;
              finalize(() => resolve());
            } else if (event === StreamEventEnum.STOPPED) {
              doneReceived = true;
              finalize(() => resolve());
            }
          } catch (error) {
            streamSocket.close(1011, "invalid_event");
            finalize(() => reject(error));
          }
        };

        streamSocket.onerror = () => {
          // 错误时清理引用，不 reject（连接由 connect 管理）
          cleanupSocketRef(streamSocket);
        };

        streamSocket.onclose = () => {
          if (doneReceived || stopRequested) {
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

  async function reconnect({ currentSessionId = "", onReconnectData = () => {} } = {}) {
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
        }));
      };

      ws.onmessage = (messageEvent) => {
        try {
          const parsed = JSON.parse(String(messageEvent?.data || "{}"));
          const event = String(parsed?.event || "message");
          const data = parsed?.data || {};

          if (event === StreamEventEnum.ERROR) {
            throw new Error(data?.error || translateText("infra.reconnectError"));
          }

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

  function requestStop(stopPayloadOrFinalize = {}, onForceFinalize = () => {}) {
    stopRequested = true;
    const ws = activeSocket;
    const firstArgIsFinalize = typeof stopPayloadOrFinalize === "function";
    const normalizedStopPayload =
      !firstArgIsFinalize &&
      stopPayloadOrFinalize &&
      typeof stopPayloadOrFinalize === "object"
        ? stopPayloadOrFinalize
        : {};
    const forceFinalize =
      firstArgIsFinalize
        ? stopPayloadOrFinalize
        : typeof onForceFinalize === "function"
        ? onForceFinalize
        : () => {};

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ action: "stop", ...normalizedStopPayload }));
      } catch {}
      clearTimers();
      stopCloseTimer = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "stop_requested");
        }
      }, stopCloseDelayMs);
      forceStopFinalizeTimer = setTimeout(() => {
        const latestSocket = activeSocket;
        if (
          latestSocket &&
          (latestSocket.readyState === WebSocket.OPEN ||
            latestSocket.readyState === WebSocket.CONNECTING)
        ) {
          latestSocket.close(1000, "stop_force_finalize");
        }
        const resolveStream = resolveCurrentStream;
        if (typeof resolveStream === "function") {
          resolveStream();
        }
        forceFinalize();
      }, forceStopFinalizeMs);
      return true;
    }

    if (ws && ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, "stop_requested");
      clearTimers();
      forceStopFinalizeTimer = setTimeout(() => {
        const resolveStream = resolveCurrentStream;
        if (typeof resolveStream === "function") {
          resolveStream();
        }
        forceFinalize();
      }, forceStopFinalizeMs);
      return true;
    }

    if (stopRequested) {
      forceFinalize();
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
    stopRequested = false;
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
    getLastReceivedSeqMap,
    clearLastReceivedSeqMap,
    hasReconnectState,
    dispose,
  };
}
