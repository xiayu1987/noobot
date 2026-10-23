/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  COMMAND_RESULT_EVENTS,
  createCommandResultError,
  isCommandFailureResult,
} from "./chatWebSocketProtocol.js";
import { validateProtocolEvent } from "@noobot/event-protocol";

export function createWebSocketCommandRequests({
  getActiveSocket,
  timeoutMs,
  translateText,
  onCommandSending,
  onCommandSent,
  onCommandSendFailed,
}) {
  const pendingRequests = new Map();

  function rejectAll(error) {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  function settle(event, data) {
    const commandResult = COMMAND_RESULT_EVENTS.has(event);
    const commandId = commandResult ? data.commandId : data.causality?.commandId;
    const pending = pendingRequests.get(commandId);
    if (!pending) return;
    if (!commandResult) {
      if (pending.expectedEvents.size && !pending.expectedEvents.has(event)) return;
      const validation = validateProtocolEvent(data);
      if (!validation.valid) throw new TypeError(validation.errors.join(","));
    }
    pendingRequests.delete(commandId);
    clearTimeout(pending.timeout);
    if (commandResult && isCommandFailureResult(event, data)) {
      pending.reject(createCommandResultError(event, data));
      return;
    }
    pending.resolve({ event, data });
  }

  function sendJson(payload) {
    onCommandSending(payload);
    const ws = getActiveSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const error = new Error(translateText("infra.interactionChannelUnavailable"));
      onCommandSendFailed(payload, error);
      throw error;
    }
    try {
      ws.send(JSON.stringify(payload));
      onCommandSent(payload);
    } catch (error) {
      onCommandSendFailed(payload, error);
      throw error;
    }
  }

  function requestJson(payload, { expectedEvents }) {
    const { commandId } = payload;
    if (!commandId) return Promise.reject(new Error("commandId is required"));
    if (pendingRequests.has(commandId)) {
      return Promise.reject(new Error("commandId request already pending"));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(commandId);
        reject(new Error(translateText("infra.websocketRequestTimeout")));
      }, timeoutMs);
      pendingRequests.set(commandId, {
        resolve,
        reject,
        timeout,
        expectedEvents: new Set(expectedEvents),
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
