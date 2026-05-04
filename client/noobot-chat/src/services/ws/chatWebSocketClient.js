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

  function clearTimers() {
    if (stopCloseTimer) {
      clearTimeout(stopCloseTimer);
      stopCloseTimer = null;
    }
    if (forceStopFinalizeTimer) {
      clearTimeout(forceStopFinalizeTimer);
      forceStopFinalizeTimer = null;
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

  async function stream(payload = {}, onEvent = () => {}) {
    return new Promise((resolve, reject) => {
      const wsUrl = resolveWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      activeSocket = ws;
      stopRequested = false;
      let settled = false;
      let doneReceived = false;

      const finalize = (fn) => {
        if (settled) return;
        settled = true;
        clearTimers();
        resolveCurrentStream = null;
        cleanupSocketRef(ws);
        fn();
      };
      resolveCurrentStream = () => finalize(() => resolve());

      ws.onopen = () => {
        ws.send(JSON.stringify(payload || {}));
      };

      ws.onmessage = (messageEvent) => {
        try {
          const parsed = JSON.parse(String(messageEvent?.data || "{}"));
          const event = String(parsed?.event || "message");
          const data = parsed?.data || {};
          if (event === StreamEventEnum.ERROR) {
            throw new Error(
              data?.error || translateText("infra.websocketStreamError"),
            );
          }
          onEvent({ event, data });
          if (event === StreamEventEnum.DONE) {
            doneReceived = true;
            ws.close(1000, "done");
          } else if (event === StreamEventEnum.STOPPED) {
            doneReceived = true;
            ws.close(1000, "stopped");
          }
        } catch (error) {
          ws.close(1011, "invalid_event");
          finalize(() => reject(error));
        }
      };

      ws.onerror = () => {
        finalize(
          () => reject(new Error(translateText("infra.websocketConnectFailed"))),
        );
      };

      ws.onclose = () => {
        if (doneReceived || stopRequested) {
          finalize(() => resolve());
          return;
        }
        finalize(() => reject(new Error(translateText("infra.websocketClosed"))));
      };
    });
  }

  function requestStop(onForceFinalize = () => {}) {
    stopRequested = true;
    const ws = activeSocket;

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ action: "stop" }));
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
        onForceFinalize();
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
        onForceFinalize();
      }, forceStopFinalizeMs);
      return true;
    }

    if (stopRequested) {
      onForceFinalize();
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
  }

  return {
    stream,
    requestStop,
    sendJson,
    getActiveSocket,
    isStopRequested,
    clearStopRequested,
    dispose,
  };
}
