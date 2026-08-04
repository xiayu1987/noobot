/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./chatWebSocketProtocol.js";

export function createWebSocketCommandRequests({
  getActiveSocket,
  timeoutMs,
  translateText,
  onCommandSending = null,
  onCommandSent = null,
  onCommandSendFailed = null,
}) {
  const pendingRequests = new Map();

  function rejectAll(error) {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  function settle(event, data = {}) {
    const commandId = normalizeTrimmedString(data?.commandId);
    const pending = commandId ? pendingRequests.get(commandId) : null;
    if (!pending) return;
    if (event !== "error" && pending.expectedEvents.size && !pending.expectedEvents.has(event)) return;
    pendingRequests.delete(commandId);
    clearTimeout(pending.timeout);
    if (event === "error") {
      const error = new Error(data?.error || data?.errorCode || "execution_query_failed");
      error.event = event;
      error.data = data;
      pending.reject(error);
      return;
    }
    pending.resolve({ event, data });
  }

  function sendJson(payload = {}) {
    onCommandSending?.(payload);
    const ws = getActiveSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const error = new Error(translateText("infra.interactionChannelUnavailable"));
      onCommandSendFailed?.(payload, error);
      throw error;
    }
    try {
      ws.send(JSON.stringify(payload || {}));
      onCommandSent?.(payload);
    } catch (error) {
      onCommandSendFailed?.(payload, error);
      throw error;
    }
  }

  function requestJson(payload = {}, { expectedEvents = [], timeoutMs: requestTimeoutMs = timeoutMs } = {}) {
    const commandId = normalizeTrimmedString(payload?.commandId);
    if (!commandId) return Promise.reject(new Error("commandId is required"));
    if (pendingRequests.has(commandId)) {
      return Promise.reject(new Error("commandId request already pending"));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(commandId);
        reject(new Error(translateText("infra.websocketRequestTimeout") || "websocket_request_timeout"));
      }, Number(requestTimeoutMs) > 0 ? Number(requestTimeoutMs) : timeoutMs);
      pendingRequests.set(commandId, {
        resolve,
        reject,
        timeout,
        expectedEvents: new Set((Array.isArray(expectedEvents) ? expectedEvents : [expectedEvents]).filter(Boolean)),
      });
      try {
        sendJson(payload);
      } catch (error) {
        clearTimeout(timeout);
        pendingRequests.delete(commandId);
        reject(error);
      }
    });
  }

  return { rejectAll, requestJson, sendJson, settle };
}
