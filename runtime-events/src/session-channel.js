/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildSessionLogRecord,
  SESSION_LOG_AGENT_PROXY_DEFAULT_CATEGORY,
  SESSION_LOG_DEBUG_CATEGORY,
  SESSION_LOG_DEFAULT_CATEGORY,
} from "./session-log-protocol.js";
import { DEFAULT_WORKSPACE_ROOT } from "./constants.js";
import { safeSegment } from "./sanitize.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const SESSION_CHANNELS = Object.freeze({
  WEB_SOCKET: "ws",
  DIRECT: "direct",
  AGENT_PROXY_WEB_SOCKET: "agent-proxy-ws",
});

export const MAX_SESSION_CHANNEL_MESSAGE_BYTES = LENGTH_THRESHOLDS.sessionLog.maxPayloadBytes;
export const MAX_SESSION_CHANNEL_BATCH_SIZE = QUANTITY_THRESHOLDS.sessionLog.maxBatchSize;

const MAX_SESSION_CHANNEL_QUEUE_SIZE = QUANTITY_THRESHOLDS.sessionLog.maxQueueSize;
const DEFAULT_RETENTION_MS = TIME_THRESHOLDS.service.sessionLogRetentionMs;
const RECONNECT_DELAY_MS = TIME_THRESHOLDS.service.sessionLogMinIntervalMs;

function envMs(name, fallback, min = TIME_THRESHOLDS.service.sessionLogMinIntervalMs) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
}

export function resolveSessionChannelConfig(options = {}) {
  const explicitRoot = options.root || process.env.NOOBOT_SESSION_LOG_ROOT || "";
  return {
    root: explicitRoot ? path.resolve(String(explicitRoot)) : "",
    workspaceRoot: path.resolve(
      String(options.workspaceRoot || process.env.NOOBOT_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT),
    ),
    dirName: safeSegment(options.dirName || process.env.NOOBOT_SESSION_LOG_DIR_NAME || "logs"),
    retentionMs: envMs(
      "NOOBOT_SESSION_LOG_RETENTION_MS",
      Number(options.retentionMs || DEFAULT_RETENTION_MS),
    ),
    cleanupIntervalMs: envMs(
      "NOOBOT_SESSION_LOG_CLEANUP_INTERVAL_MS",
      Number(options.cleanupIntervalMs || TIME_THRESHOLDS.service.sessionLogCleanupIntervalMs),
    ),
    sessionLogControls: options.sessionLogControls,
  };
}

function buildSessionChannelRecord(event = {}, options = {}) {
  const record = buildSessionLogRecord(event, {
    defaultCategory: options.defaultCategory || SESSION_LOG_DEFAULT_CATEGORY,
    defaultEvent: options.defaultEvent,
    defaultSessionId: options.defaultSessionId || "unknown-session",
    includeTimestamp: options.includeTimestamp !== false,
    source: options.source,
  });
  if (options.channel || event.channel)
    record.channel = safeSegment(event.channel || options.channel);
  return record;
}

export async function cleanupSessionChannelRecords(
  config = resolveSessionChannelConfig(),
  now = Date.now(),
) {
  if (!config.root) return { ok: true, removed: 0, skipped: true };
  await fs.mkdir(config.root, { recursive: true });
  const entries = await fs.readdir(config.root, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(config.root, entry.name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (stat && now - stat.mtimeMs > config.retentionMs) {
      await fs.rm(fullPath, { recursive: true, force: true });
      removed += 1;
    }
  }
  return { ok: true, removed };
}

export function createSessionChannelWebSocketClient({
  WebSocketImpl,
  resolveWebSocketUrl,
  source = "agent-proxy",
  defaultCategory = SESSION_LOG_AGENT_PROXY_DEFAULT_CATEGORY,
  defaultEvent = "agentProxy.log",
  defaultSessionId = "agent-proxy",
  channel = SESSION_CHANNELS.AGENT_PROXY_WEB_SOCKET,
} = {}) {
  const sockets = new Map();
  const queues = new Map();
  const inFlights = new Map();
  const reconnectTimers = new Map();

  const getQueue = (key = "") => (queues.has(key) ? queues.get(key) : queues.set(key, []).get(key));
  const getInFlight = (key = "") =>
    inFlights.has(key) ? inFlights.get(key) : inFlights.set(key, []).get(key);

  function restoreInFlight(key = "") {
    const queue = getQueue(key);
    const inFlight = getInFlight(key);
    if (!inFlight.length) return;
    queue.unshift(...inFlight.splice(0));
    if (queue.length > MAX_SESSION_CHANNEL_QUEUE_SIZE)
      queue.splice(0, queue.length - MAX_SESSION_CHANNEL_QUEUE_SIZE);
  }

  function handleAck(key = "", raw = {}) {
    let parsed = null;
    try {
      parsed = JSON.parse(String(raw?.data || raw || "{}"));
    } catch {
      return;
    }
    if (parsed?.event !== "ack") return;
    const inFlight = getInFlight(key);
    const ackCount = Math.max(0, Math.min(Number(parsed.count || 1), inFlight.length));
    inFlight.splice(0, ackCount);
  }

  function scheduleReconnect(key = "") {
    if (!key || reconnectTimers.has(key) || !getQueue(key).length) return;
    const timer = setTimeout(() => {
      reconnectTimers.delete(key);
      connect(key);
      flush(key);
    }, RECONNECT_DELAY_MS);
    timer.unref?.();
    reconnectTimers.set(key, timer);
  }

  function connect(key = "") {
    if (!key || !WebSocketImpl) return null;
    const current = sockets.get(key);
    if (current && [WebSocketImpl.OPEN, WebSocketImpl.CONNECTING].includes(current.readyState))
      return current;
    const url = resolveWebSocketUrl?.(key);
    if (!url) return null;
    const socket = new WebSocketImpl(url);
    socket.onopen = () => flush(key);
    socket.onmessage = (raw) => handleAck(key, raw);
    socket.onclose = () => {
      restoreInFlight(key);
      sockets.delete(key);
      scheduleReconnect(key);
    };
    socket.onerror = () => {
      restoreInFlight(key);
      sockets.delete(key);
      scheduleReconnect(key);
    };
    sockets.set(key, socket);
    return socket;
  }

  function flush(key = "") {
    const socket = sockets.get(key);
    if (!socket || socket.readyState !== WebSocketImpl.OPEN) return;
    const queue = getQueue(key);
    const inFlight = getInFlight(key);
    while (queue.length) {
      const record = queue.shift();
      inFlight.push(record);
      socket.send(JSON.stringify(record));
    }
  }

  function log(key = "", event = {}) {
    const record = buildSessionChannelRecord(event, {
      source,
      defaultCategory,
      defaultEvent,
      defaultSessionId,
      includeTimestamp: false,
      channel,
    });
    const queue = getQueue(key);
    queue.push(record);
    if (queue.length > MAX_SESSION_CHANNEL_QUEUE_SIZE)
      queue.splice(0, queue.length - MAX_SESSION_CHANNEL_QUEUE_SIZE);
    connect(key);
    flush(key);
    return true;
  }

  function status(key = "") {
    return {
      queueLength: getQueue(key).length,
      inFlightLength: getInFlight(key).length,
      readyState: sockets.get(key)?.readyState ?? WebSocketImpl?.CLOSED,
      hasReconnectTimer: reconnectTimers.has(key),
    };
  }

  return {
    connect,
    log,
    debug: (key, event = {}) => log(key, { ...event, category: SESSION_LOG_DEBUG_CATEGORY }),
    status,
  };
}
