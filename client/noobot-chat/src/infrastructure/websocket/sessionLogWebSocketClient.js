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
import { closeWebSocket } from "./closeWebSocket.js";

const MAX_QUEUE_SIZE = QUANTITY_THRESHOLDS.sessionLog.maxQueueSize;
const MAX_BATCH_SIZE = QUANTITY_THRESHOLDS.sessionLog.maxBatchSize;
const DEFAULT_MAX_DEBUG_QUEUE_SIZE = QUANTITY_THRESHOLDS.sessionLog.maxDebugQueueSize;
const DEFAULT_MAX_DEBUG_QUEUE_BYTES = QUANTITY_THRESHOLDS.sessionLog.maxDebugQueueBytes;
const DEFAULT_DEBUG_TTL_MS = TIME_THRESHOLDS.client.sessionLogDebugTtlMs;

function envFlag(name, fallback = false) {
  const raw = String(import.meta?.env?.[name] || "")
    .trim()
    .toLowerCase();
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
  resolveTransportOwner = () => "",
  source = "frontend",
  refreshAuthentication = null,
} = {}) {
  const reliableQueue = [];
  const debugQueue = [];
  const inFlight = [];
  let debugQueueBytes = 0;
  let droppedDebugCount = 0;
  let rejectedReliableCount = 0;
  let policy = {
    debug: {},
    limits: {
      maxDebugQueue: DEFAULT_MAX_DEBUG_QUEUE_SIZE,
      maxDebugBytes: DEFAULT_MAX_DEBUG_QUEUE_BYTES,
      debugTtlMs: DEFAULT_DEBUG_TTL_MS,
    },
  };
  let disposed = false;
  const transport = createWebSocketTransportSupervisor({
    channelId: "session-log",
    resolveWebSocketUrl,
    resolveTransportOwner,
    refreshAuthentication,
    reconnectBaseDelayMs: TIME_THRESHOLDS.client.sessionLogReconnectBaseDelayMs,
    reconnectMaxDelayMs: TIME_THRESHOLDS.client.sessionLogReconnectMaxDelayMs,
  });
  const isSuspended = () => transport.status().phase === WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED;

  function scheduleReconnect() {
    if (disposed || isSuspended()) return;
    if (!reliableQueue.length && !debugQueue.length && !inFlight.length) return;
    transport.scheduleReconnect(() => {
      connect();
      flush();
    });
  }

  function recoverAuthentication() {
    void transport.recover({
      reconnect: () => {
        if (disposed || (!reliableQueue.length && !debugQueue.length && !inFlight.length)) return;
        connect();
        flush();
      },
      suspendOnAuthenticationFailure: false,
    });
  }

  function handleDisconnect(currentSocket, event = {}, { closeSocket = false } = {}) {
    if (!transport.isCurrent(currentSocket)) return;
    const restored = restoreInFlight();
    if (debugQueue.length) {
      droppedDebugCount += debugQueue.length;
      debugQueue.length = 0;
      debugQueueBytes = 0;
    }
    transport.noteFailure(currentSocket);
    if (closeSocket) {
      closeWebSocket(currentSocket, 1011, "transport_error");
    }
    logDiagnostic("disconnected", {
      code: event?.code || 0,
      reason: event?.reason || "",
      queueLength: reliableQueue.length + debugQueue.length,
      restored,
      reconnectAttempt: transport.status().reconnectAttempt,
    });
    if (!disposed && (reliableQueue.length || inFlight.some((entry) => entry.reliable))) {
      recoverAuthentication();
    }
  }

  function restoreInFlight() {
    if (!inFlight.length) return 0;
    const pending = inFlight.splice(0);
    const reliable = pending.filter((entry) => entry.reliable);
    const dropped = pending.length - reliable.length;
    reliableQueue.unshift(...reliable);
    droppedDebugCount += dropped;
    return reliable.length;
  }

  function handleAck(raw) {
    let parsed = null;
    try {
      parsed = JSON.parse(String(raw?.data || raw || "{}"));
    } catch {
      return;
    }
    if (parsed?.event === "session_log_policy") {
      updatePolicy(parsed.policy);
      return;
    }
    if (parsed?.event !== "ack") return;
    const ackCount = Math.max(0, Math.min(Number(parsed.count || 1), inFlight.length));
    inFlight.splice(0, ackCount);
    logDiagnostic("ack", {
      count: ackCount,
      queueLength: reliableQueue.length + debugQueue.length,
      inFlightLength: inFlight.length,
    });
    if (!inFlight.length) flush();
  }

  function connect() {
    if (disposed || isSuspended()) return null;
    const attempt = transport.acquire();
    if (!attempt?.socket) {
      logDiagnostic("connect skipped", {
        reason: "empty-url",
        queueLength: reliableQueue.length + debugQueue.length,
      });
      return null;
    }
    const currentSocket = attempt.socket;
    if (attempt.identityChanged) {
      const nextOwner = String(attempt.transportOwner || "").trim();
      const retainOwner = (entry) => String(entry?.record?.userId || "").trim() === nextOwner;
      const retainedReliable = reliableQueue.filter(retainOwner);
      const retainedDebug = debugQueue.filter(retainOwner);
      rejectedReliableCount += reliableQueue.length - retainedReliable.length;
      droppedDebugCount += debugQueue.length - retainedDebug.length;
      reliableQueue.splice(0, reliableQueue.length, ...retainedReliable);
      debugQueue.splice(0, debugQueue.length, ...retainedDebug);
      debugQueueBytes = retainedDebug.reduce((total, entry) => total + entry.bytes, 0);
      rejectedReliableCount += inFlight.filter((entry) => entry.reliable).length;
      droppedDebugCount += inFlight.filter((entry) => !entry.reliable).length;
      inFlight.length = 0;
    }
    if (attempt.reused) return currentSocket;
    logDiagnostic("connecting", {
      queueLength: reliableQueue.length + debugQueue.length,
      generation: attempt.generation,
    });
    currentSocket.onopen = () => {
      if (!transport.markOpen(currentSocket) || disposed) return;
      logDiagnostic("open", {
        queueLength: reliableQueue.length + debugQueue.length,
        inFlightLength: inFlight.length,
      });
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
    // Keep one bounded batch in flight. The server ACK is the authority that
    // permits advancing the window; otherwise reconnect recovery can reorder
    // or silently discard records from an arbitrarily large in-flight set.
    if (inFlight.length) return;
    const now = Date.now();
    while (debugQueue.length && debugQueue[0].expiresAt <= now) {
      debugQueueBytes -= debugQueue.shift().bytes;
      droppedDebugCount += 1;
    }
    const sourceQueue = reliableQueue.length ? reliableQueue : debugQueue;
    const count = Math.min(sourceQueue.length, MAX_BATCH_SIZE);
    while (inFlight.length < count) {
      const entry = sourceQueue.shift();
      if (!entry.reliable) debugQueueBytes -= entry.bytes;
      inFlight.push(entry);
      try {
        socket.send(JSON.stringify(entry.record));
      } catch (error) {
        logDiagnostic("send failed", { errorType: error?.name || "Error" });
        handleDisconnect(socket, { reason: "send_failed" });
        closeWebSocket(socket, 1011, "send_failed");
        break;
      }
    }
    if (count) logDiagnostic("flushed", { count, inFlightLength: inFlight.length });
  }

  function debugTypeOf(event = {}) {
    return String(event.debugType || event.data?.debugType || event.event || "")
      .trim()
      .toLowerCase();
  }

  function isEnabled(debugType = "") {
    const type = String(debugType || "")
      .trim()
      .toLowerCase();
    return Boolean(type && policy.debug?.[type] === true);
  }

  function updatePolicy(nextPolicy = {}) {
    if (!nextPolicy || typeof nextPolicy !== "object") return false;
    policy = {
      debug:
        nextPolicy.debug && typeof nextPolicy.debug === "object" ? { ...nextPolicy.debug } : {},
      limits: {
        maxDebugQueue: Number.isFinite(Number(nextPolicy.limits?.maxDebugQueue))
          ? Math.max(0, Number(nextPolicy.limits.maxDebugQueue))
          : DEFAULT_MAX_DEBUG_QUEUE_SIZE,
        maxDebugBytes: Number.isFinite(Number(nextPolicy.limits?.maxDebugBytes))
          ? Math.max(0, Number(nextPolicy.limits.maxDebugBytes))
          : DEFAULT_MAX_DEBUG_QUEUE_BYTES,
        debugTtlMs: Number.isFinite(Number(nextPolicy.limits?.debugTtlMs))
          ? Math.max(0, Number(nextPolicy.limits.debugTtlMs))
          : DEFAULT_DEBUG_TTL_MS,
      },
    };
    for (let index = debugQueue.length - 1; index >= 0; index -= 1) {
      if (isEnabled(debugTypeOf(debugQueue[index].record))) continue;
      debugQueueBytes -= debugQueue[index].bytes;
      debugQueue.splice(index, 1);
      droppedDebugCount += 1;
    }
    return true;
  }

  function log(event = {}) {
    if (disposed) return false;
    const resolvedEvent = event;
    if (!resolvedEvent || typeof resolvedEvent !== "object") return false;
    const record = buildSessionLogRecord(resolvedEvent, {
      source,
      defaultCategory: SESSION_LOG_DEFAULT_CATEGORY,
      includeTimestamp: false,
    });
    const isDebug =
      record.category === "debug" || record.level === "debug" || Boolean(record.data?.debugType);
    if (isDebug) {
      if (
        !isEnabled(debugTypeOf(record)) ||
        reliableQueue.length ||
        inFlight.some((entry) => entry.reliable)
      ) {
        droppedDebugCount += 1;
        return false;
      }
      const bytes = new TextEncoder().encode(JSON.stringify(record)).length;
      if (
        debugQueue.length >= policy.limits.maxDebugQueue ||
        debugQueueBytes + bytes > policy.limits.maxDebugBytes
      ) {
        droppedDebugCount += 1;
        return false;
      }
      debugQueue.push({
        record,
        reliable: false,
        bytes,
        expiresAt: Date.now() + policy.limits.debugTtlMs,
      });
      debugQueueBytes += bytes;
    } else {
      const reliableInFlight = inFlight.filter((entry) => entry.reliable).length;
      if (reliableQueue.length + reliableInFlight >= MAX_QUEUE_SIZE) {
        rejectedReliableCount += 1;
        return false;
      }
      reliableQueue.push({ record, reliable: true, bytes: 0, expiresAt: Infinity });
    }
    logDiagnostic("queued", {
      category: record.category,
      event: record.event,
      sessionId: record.sessionId,
      queueLength: reliableQueue.length + debugQueue.length,
    });
    connect();
    flush();
    return true;
  }

  function status() {
    return {
      queueLength: reliableQueue.length + debugQueue.length,
      reliableQueueLength: reliableQueue.length,
      debugQueueLength: debugQueue.length,
      debugQueueBytes,
      inFlightLength: inFlight.length,
      droppedDebugCount,
      rejectedReliableCount,
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
    reliableQueue.length = 0;
    debugQueue.length = 0;
    debugQueueBytes = 0;
    inFlight.length = 0;
    transport.dispose();
  }

  return {
    connect,
    log,
    debug: (debugTypeOrEvent = {}, factory = null) => {
      const type =
        typeof debugTypeOrEvent === "string"
          ? String(debugTypeOrEvent).trim().toLowerCase()
          : debugTypeOf(debugTypeOrEvent);
      if (!type || !isEnabled(type)) return false;
      const event = typeof factory === "function" ? factory() : debugTypeOrEvent;
      return log({ ...event, debugType: type, category: "debug" });
    },
    isEnabled,
    updatePolicy,
    status,
    resume,
    dispose,
  };
}
