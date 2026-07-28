/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  buildSessionLogRecord,
  SESSION_LOG_DEFAULT_CATEGORY,
} from "@noobot/runtime-events/session-log-protocol";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  createWebSocketTransportSupervisor,
  WEB_SOCKET_TRANSPORT_PHASE,
} from "./webSocketTransportSupervisor.js";

const MAX_QUEUE_SIZE = QUANTITY_THRESHOLDS.sessionLog.maxQueueSize;

function envFlag(name, fallback = false) {
  const raw = String(import.meta?.env?.[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

const DIAGNOSTIC_ENABLED = envFlag("VITE_NOOBOT_SESSION_LOG_DIAGNOSTIC", false);

function logDiagnostic(message, data = {}) {
  if (!DIAGNOSTIC_ENABLED) return;
  console.info("[session-log-ws][frontend]", message, data);
}

export function createSessionLogWebSocketClient({
  resolveWebSocketUrl = () => "",
  source = "frontend",
  refreshAuthentication = null,
} = {}) {
  const queue = [];
  const inFlight = [];
  let disposed = false;
  const transport = createWebSocketTransportSupervisor({
    channelId: "session-log",
    resolveWebSocketUrl,
    refreshAuthentication,
    reconnectBaseDelayMs: TIME_THRESHOLDS.client.sessionLogReconnectBaseDelayMs,
    reconnectMaxDelayMs: TIME_THRESHOLDS.client.sessionLogReconnectMaxDelayMs,
  });
  const isSuspended = () => transport.status().phase === WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED;

  function scheduleReconnect() {
    if (disposed || isSuspended()) return;
    if (!queue.length && !inFlight.length) return;
    transport.scheduleReconnect(() => {
      connect();
      flush();
    });
  }

  function recoverAuthentication() {
    void transport.recover({
      reconnect: () => {
        if (disposed || (!queue.length && !inFlight.length)) return;
        connect();
        flush();
      },
      suspendOnAuthenticationFailure: false,
    });
  }

  function handleDisconnect(currentSocket, event = {}, { closeSocket = false } = {}) {
    if (!transport.isCurrent(currentSocket)) return;
    const restored = restoreInFlight();
    transport.noteFailure(currentSocket);
    if (closeSocket) {
      try { currentSocket?.close?.(1011, "transport_error"); } catch {}
    }
    logDiagnostic("disconnected", {
      code: event?.code || 0,
      reason: event?.reason || "",
      queueLength: queue.length,
      restored,
      reconnectAttempt: transport.status().reconnectAttempt,
    });
    if (!disposed) recoverAuthentication();
  }

  function restoreInFlight() {
    if (!inFlight.length) return 0;
    const count = inFlight.length;
    queue.unshift(...inFlight.splice(0));
    if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
    return count;
  }

  function handleAck(raw) {
    let parsed = null;
    try {
      parsed = JSON.parse(String(raw?.data || raw || "{}"));
    } catch {
      return;
    }
    if (parsed?.event !== "ack") return;
    const ackCount = Math.max(0, Math.min(Number(parsed.count || 1), inFlight.length));
    inFlight.splice(0, ackCount);
    logDiagnostic("ack", { count: ackCount, queueLength: queue.length, inFlightLength: inFlight.length });
  }

  function connect() {
    if (disposed || isSuspended()) return null;
    const current = transport.current();
    if (current && [WebSocket.OPEN, WebSocket.CONNECTING].includes(current.readyState)) return current;
    const attempt = transport.acquire();
    if (!attempt?.socket) {
      logDiagnostic("connect skipped", { reason: "empty-url", queueLength: queue.length });
      return null;
    }
    const currentSocket = attempt.socket;
    logDiagnostic("connecting", { queueLength: queue.length, generation: attempt.generation });
    currentSocket.onopen = () => {
      if (!transport.markOpen(currentSocket) || disposed) return;
      logDiagnostic("open", { queueLength: queue.length, inFlightLength: inFlight.length });
      flush();
    };
    currentSocket.onmessage = (raw) => {
      if (!transport.isCurrent(currentSocket) || disposed) return;
      logDiagnostic("message", { payload: String(raw?.data || raw || "").slice(0, 300) });
      handleAck(raw);
    };
    currentSocket.onclose = (event) => {
      handleDisconnect(currentSocket, event);
    };
    currentSocket.onerror = () => {
      handleDisconnect(currentSocket, {}, { closeSocket: true });
    };
    return currentSocket;
  }

  function flush() {
    const socket = transport.current();
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const count = queue.length;
    while (queue.length) {
      const record = queue.shift();
      inFlight.push(record);
      try {
        socket.send(JSON.stringify(record));
      } catch (error) {
        logDiagnostic("send failed", { errorType: error?.name || "Error" });
        handleDisconnect(socket, { reason: "send_failed" });
        try { socket.close?.(1011, "send_failed"); } catch {}
        break;
      }
    }
    if (count) logDiagnostic("flushed", { count, inFlightLength: inFlight.length });
  }

  function log(event = {}) {
    if (disposed) return false;
    const record = buildSessionLogRecord(event, {
      source,
      defaultCategory: SESSION_LOG_DEFAULT_CATEGORY,
      includeTimestamp: false,
    });
    queue.push(record);
    if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
    logDiagnostic("queued", { category: record.category, event: record.event, sessionId: record.sessionId, queueLength: queue.length });
    connect();
    flush();
    return true;
  }

  function status() {
    return {
      queueLength: queue.length,
      inFlightLength: inFlight.length,
      ...transport.status(),
      suspended: isSuspended(),
    };
  }

  function resume() {
    if (disposed) return false;
    transport.resume();
    connect();
    flush();
    return true;
  }

  function dispose() {
    disposed = true;
    queue.length = 0;
    inFlight.length = 0;
    transport.dispose();
  }

  return {
    connect,
    log,
    debug: (event = {}) => log({ ...event, category: "debug" }),
    status,
    resume,
    dispose,
  };
}
