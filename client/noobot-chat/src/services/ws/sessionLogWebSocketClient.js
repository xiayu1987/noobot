/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */

import {
  buildSessionLogRecord,
  isSessionLogDebugEnabled,
  SESSION_LOG_DEFAULT_CATEGORY,
} from "@noobot/shared/session-log-protocol";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

const DEBUG_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta?.env?.VITE_NOOBOT_SESSION_LOG_DEBUG || "").trim().toLowerCase(),
);
const MAX_QUEUE_SIZE = QUANTITY_THRESHOLDS.sessionLog.maxQueueSize;

function envFlag(name, fallback = false) {
  const raw = String(import.meta?.env?.[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

const DIAGNOSTIC_ENABLED = envFlag("VITE_NOOBOT_SESSION_LOG_DIAGNOSTIC", true);

function logDiagnostic(message, data = {}) {
  if (!DIAGNOSTIC_ENABLED) return;
  console.info("[session-log-ws][frontend]", message, data);
}

export function createSessionLogWebSocketClient({ resolveWebSocketUrl = () => "", source = "frontend" } = {}) {
  let socket = null;
  const queue = [];
  const inFlight = [];
  let reconnectTimer = null;

  function scheduleReconnect() {
    if (reconnectTimer || (!queue.length && !inFlight.length)) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
      flush();
    }, 1000);
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
    if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return socket;
    const url = resolveWebSocketUrl();
    if (!url) {
      logDiagnostic("connect skipped", { reason: "empty-url", queueLength: queue.length });
      return null;
    }
    logDiagnostic("connecting", { url, queueLength: queue.length });
    socket = new WebSocket(url);
    socket.onopen = () => {
      logDiagnostic("open", { queueLength: queue.length, inFlightLength: inFlight.length });
      flush();
    };
    socket.onmessage = (raw) => {
      logDiagnostic("message", { payload: String(raw?.data || raw || "").slice(0, 300) });
      handleAck(raw);
    };
    socket.onclose = (event) => {
      const restored = restoreInFlight();
      logDiagnostic("close", { code: event?.code, reason: event?.reason || "", queueLength: queue.length, restored });
      socket = null;
      scheduleReconnect();
    };
    socket.onerror = () => {
      const restored = restoreInFlight();
      logDiagnostic("error", { queueLength: queue.length, restored });
      socket = null;
      scheduleReconnect();
    };
    return socket;
  }

  function flush() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const count = queue.length;
    while (queue.length) {
      const record = queue.shift();
      inFlight.push(record);
      socket.send(JSON.stringify(record));
    }
    if (count) logDiagnostic("flushed", { count, inFlightLength: inFlight.length });
  }

  function log(event = {}) {
    const record = buildSessionLogRecord(event, {
      source,
      defaultCategory: SESSION_LOG_DEFAULT_CATEGORY,
      includeTimestamp: false,
    });
    if (!isSessionLogDebugEnabled(record.category, DEBUG_ENABLED)) return false;
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
      readyState: socket?.readyState ?? WebSocket.CLOSED,
      hasReconnectTimer: Boolean(reconnectTimer),
    };
  }

  return { connect, log, debug: (event = {}) => log({ ...event, category: "debug" }), status };
}
