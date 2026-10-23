/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createCommandResultError, isCommandFailureResult } from "./chatWebSocketProtocol.js";
import {
  AGENT_TRANSPORT_EVENT,
  validateAgentCommandReceipt,
  validateAgentCommandRejection,
} from "@noobot/agent-transport-protocol";
import { validateProtocolEvent } from "@noobot/event-protocol";

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

  const COMMAND_RESULT_VALIDATORS = new Map([
    [AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, validateAgentCommandReceipt],
    [AGENT_TRANSPORT_EVENT.COMMAND_REJECTED, validateAgentCommandRejection],
  ]);

  function settle(event, data) {
    const commandResultValidator = COMMAND_RESULT_VALIDATORS.get(event);
    const commandId = commandResultValidator ? data.commandId : data.causality?.commandId;
    const pending = pendingRequests.get(commandId);
    if (!pending) return;
    if (
      !commandResultValidator &&
      pending.expectedEvents.size &&
      !pending.expectedEvents.has(event)
    ) {
      return;
    }
    const validation = (commandResultValidator || validateProtocolEvent)(data);
    if (!validation.valid) throw new TypeError(validation.errors.join(","));
    pendingRequests.delete(commandId);
    clearTimeout(pending.timeout);
    if (commandResultValidator && isCommandFailureResult(event, data)) {
      pending.reject(createCommandResultError(event, data));
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

  function requestJson(
    payload = {},
    { expectedEvents = [], timeoutMs: requestTimeoutMs = timeoutMs } = {},
  ) {
    const { commandId } = payload;
    if (!commandId) return Promise.reject(new Error("commandId is required"));
    if (pendingRequests.has(commandId)) {
      return Promise.reject(new Error("commandId request already pending"));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          pendingRequests.delete(commandId);
          reject(
            new Error(
              translateText("infra.websocketRequestTimeout") || "websocket_request_timeout",
            ),
          );
        },
        Number(requestTimeoutMs) > 0 ? Number(requestTimeoutMs) : timeoutMs,
      );
      pendingRequests.set(commandId, {
        resolve,
        reject,
        timeout,
        expectedEvents: new Set(
          (Array.isArray(expectedEvents) ? expectedEvents : [expectedEvents]).filter(Boolean),
        ),
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
