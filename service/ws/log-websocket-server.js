/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WebSocketServer } from "ws";
import {
  cleanupSessionChannelRecords,
  MAX_SESSION_CHANNEL_BATCH_SIZE,
  MAX_SESSION_CHANNEL_MESSAGE_BYTES,
  resolveSessionChannelConfig,
} from "@noobot/runtime-events/session-channel";
import { RUNTIME_EVENT_CHANNELS, writeRoutedRuntimeEvent } from "@noobot/runtime-events";
import { HTTP_STATUS } from "#agent/constants";

const MAX_LOG_MESSAGE_BYTES = MAX_SESSION_CHANNEL_MESSAGE_BYTES;
const MAX_LOG_BATCH_SIZE = MAX_SESSION_CHANNEL_BATCH_SIZE;
const DIAG_PREFIX = "[session-log-ws]";

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function diagnosticEnabled() {
  return envFlag("NOOBOT_SESSION_LOG_DIAGNOSTIC", true);
}

function logDiagnostic(message, data = {}) {
  if (!diagnosticEnabled()) return;
  void writeRoutedRuntimeEvent({
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.WEB_SOCKET,
    category: "debug",
    level: "info",
    event: "service.logWebSocket.diagnostic",
    data: {
      message: String(message || ""),
      ...(data && typeof data === "object" ? data : {}),
    },
  });
}

export function resolveSessionLogConfig(options = {}) {
  return resolveSessionChannelConfig(options);
}

export async function writeSessionLogEvent(event = {}, config = resolveSessionLogConfig()) {
  const runtimeEventConfig = config.logRoot ? { ...config, root: config.logRoot } : config;
  const result = await writeRoutedRuntimeEvent({
      scope: "session", ...event, channel: event.channel || RUNTIME_EVENT_CHANNELS.WEB_SOCKET }, runtimeEventConfig);
  if (!result.skipped) logDiagnostic("written", { file: result.file, category: event.category, sessionId: event.sessionId });
  return result;
}

export async function cleanupSessionLogs(config = resolveSessionLogConfig(), now = Date.now()) {
  return cleanupSessionChannelRecords(config, now);
}

function sendUpgradeError(socket, statusCode = HTTP_STATUS.UNAUTHORIZED, message = "Unauthorized") {
  if (!socket.writable) return;
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  socket.destroy();
}

export function registerLogWebSocketServer(server, { resolveAuthByApiKey, logConfig = resolveSessionLogConfig() } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  logDiagnostic("registered", {
    path: "/logs/ws",
    logRoot: logConfig.logRoot,
    workspaceRoot: logConfig.workspaceRoot,
    logDirName: logConfig.logDirName,
    retentionMs: logConfig.retentionMs,
    cleanupIntervalMs: logConfig.cleanupIntervalMs,
  });
  server.on("upgrade", (request, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(request.url || "", "http://localhost").pathname;
    } catch {
      return sendUpgradeError(socket, HTTP_STATUS.BAD_REQUEST || 400, "Bad Request");
    }
    if (pathname !== "/logs/ws") return;
    const authInfo = resolveAuthByApiKey?.(request);
    if (!authInfo) {
      logDiagnostic("upgrade rejected", { reason: "unauthorized", url: request.url });
      return sendUpgradeError(socket);
    }
    request.auth = authInfo;
    logDiagnostic("upgrade accepted", { userId: authInfo.userId || "", url: request.url });
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });
  wss.on("connection", (ws, request) => {
    logDiagnostic("connected", { userId: request.auth?.userId || "" });
    ws.on("message", async (raw) => {
      try {
        if (Buffer.byteLength(raw || "") > MAX_LOG_MESSAGE_BYTES) {
          throw new Error("log payload too large");
        }
        const parsed = JSON.parse(String(raw || "{}"));
        const events = Array.isArray(parsed?.events) ? parsed.events : [parsed];
        if (events.length > MAX_LOG_BATCH_SIZE) {
          throw new Error("log batch too large");
        }
        logDiagnostic("received", { count: events.length });
        for (const item of events) {
          await writeSessionLogEvent({ ...item, userId: request.auth?.userId || item.userId }, logConfig);
        }
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event: "ack", count: events.length }));
      } catch (error) {
        void writeRoutedRuntimeEvent({
          source: "service",
          channel: RUNTIME_EVENT_CHANNELS.WEB_SOCKET,
          category: "transport",
          level: "warn",
          event: "service.logWebSocket.write.failed",
          data: { userIdLength: String(request?.auth?.userId || "").length },
          error,
        }, logConfig);
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event: "error", error: error?.message || "log write failed" }));
      }
    });
  });
  const timer = setInterval(() => cleanupSessionLogs(logConfig).catch(() => {}), logConfig.cleanupIntervalMs);
  timer.unref?.();
  cleanupSessionLogs(logConfig).catch(() => {});
  return { webSocketServer: wss, cleanupTimer: timer, logConfig };
}
