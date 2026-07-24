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

export function createSessionLogWebSocketClient({ resolveWebSocketUrl = () => "", source = "frontend" } = {}) {
  let socket = null;
  const queue = [];
  const inFlight = [];
  let reconnectTimer = null;
  let disposed = false;

  function scheduleReconnect() {
    if (disposed) return;
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
    if (disposed) return null;
    if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return socket;
    const url = resolveWebSocketUrl();
    if (!url) {
      logDiagnostic("connect skipped", { reason: "empty-url", queueLength: queue.length });
      return null;
    }
    logDiagnostic("connecting", { url, queueLength: queue.length });
    socket = new WebSocket(url);
    const currentSocket = socket;
    currentSocket.onopen = () => {
      if (socket !== currentSocket || disposed) return;
      logDiagnostic("open", { queueLength: queue.length, inFlightLength: inFlight.length });
      runtimeDiagnostic("frontend.sessionLogWs.open", { queueLength: queue.length, inFlightLength: inFlight.length });
      flush();
    };
    currentSocket.onmessage = (raw) => {
      if (socket !== currentSocket || disposed) return;
      logDiagnostic("message", { payload: String(raw?.data || raw || "").slice(0, 300) });
      handleAck(raw);
    };
    currentSocket.onclose = (event) => {
      if (socket !== currentSocket) return;
      const restored = restoreInFlight();
      logDiagnostic("close", { code: event?.code, reason: event?.reason || "", queueLength: queue.length, restored });
      runtimeDiagnostic("frontend.sessionLogWs.close", { code: event?.code || 0, reason: event?.reason || "", queueLength: queue.length, restored });
      socket = null;
      if (!disposed) scheduleReconnect();
    };
    currentSocket.onerror = () => {
      if (socket !== currentSocket) return;
      const restored = restoreInFlight();
      logDiagnostic("error", { queueLength: queue.length, restored });
      runtimeDiagnostic("frontend.sessionLogWs.error", { queueLength: queue.length, restored });
      socket = null;
      if (!disposed) scheduleReconnect();
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

  // Transport diagnostics intentionally use the same structured session-log
  // path as business diagnostics. This makes dropped/queued/reconnected
  // frontend logs observable in runtime-events instead of only DevTools.
  function runtimeDiagnostic(event, data = {}) {
    if (disposed) return false;
    // Diagnostics must never evict a business record from the bounded delivery
    // queue. Recording remains controlled by runtime-events-config on the
    // consumer side; this only establishes transport priority under pressure.
    if (queue.length >= MAX_QUEUE_SIZE) return false;
    const record = buildSessionLogRecord({
      category: "debug",
      level: "debug",
      debugType: "session-log-ws",
      event,
      data: { event, ...data },
    }, { source, includeTimestamp: true });
    queue.push(record);
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

  function dispose() {
    disposed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const currentSocket = socket;
    socket = null;
    queue.length = 0;
    inFlight.length = 0;
    try { currentSocket?.close?.(1000, "dispose"); } catch {}
  }

  return {
    connect,
    log,
    debug: (event = {}) => log({ ...event, category: "debug" }),
    status,
    dispose,
  };
}
