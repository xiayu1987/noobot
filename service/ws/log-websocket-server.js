/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WebSocketServer } from "ws";
import {
  MAX_SESSION_CHANNEL_BATCH_SIZE,
  MAX_SESSION_CHANNEL_MESSAGE_BYTES,
} from "@noobot/runtime-events/session-channel";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  normalizeRuntimeEventEnvelope,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import {
  isSessionLogDebugEvent,
  requireSessionLogChannel,
  requireSessionLogReceipt,
  resolveSessionLogClientPolicy,
} from "@noobot/runtime-events/session-log-protocol";
import { HTTP_STATUS } from "#agent/constants";

const MAX_LOG_MESSAGE_BYTES = MAX_SESSION_CHANNEL_MESSAGE_BYTES;
const MAX_LOG_BATCH_SIZE = MAX_SESSION_CHANNEL_BATCH_SIZE;

function logDiagnostic(message, data = {}) {
  void writeRuntimeEvent({
    scope: "system",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: "session-log-ws",
    event: "service.logWebSocket.diagnostic",
    data: {
      message: String(message || ""),
      ...(data && typeof data === "object" ? data : {}),
    },
  });
}

export async function writeSessionLogEvent(event = {}) {
  requireSessionLogChannel(event.channel);
  const result = await writeRuntimeEvent(event);
  if (result.ok && !result.skipped)
    logDiagnostic("written", {
      file: result.file,
      category: event.category,
      sessionId: event.sessionId,
    });
  return result;
}

function sendUpgradeError(socket, statusCode = HTTP_STATUS.UNAUTHORIZED, message = "Unauthorized") {
  if (!socket.writable) return;
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
  socket.destroy();
}

export function registerLogWebSocketServer(
  server,
  { resolveAuthByApiKey, writeLogEvent = writeSessionLogEvent } = {},
) {
  const wss = new WebSocketServer({ noServer: true });
  logDiagnostic("registered", {
    path: "/logs/ws",
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
    const reportWriteFailure = (error, count = 0, record) => {
      void writeRuntimeEvent({
        scope: "system",
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.WEB_SOCKET,
        category: "transport",
        level: "warn",
        event: "service.logWebSocket.write.failed",
        data: {
          userIdLength: String(request?.auth?.userId || "").length,
          ...(record
            ? {
                rejectedEvent: {
                  event: record.event,
                  source: record.source,
                  scope: record.scope,
                  channel: record.channel,
                  sessionId: record.sessionId,
                  parentSessionId: record.parentSessionId,
                  dialogProcessId: record.dialogProcessId,
                  turnScopeId: record.turnScopeId,
                },
              }
            : {}),
        },
        error,
      });
      if (ws.readyState === ws.OPEN)
        ws.send(
          JSON.stringify(requireSessionLogReceipt({ event: "error", count, error: error.message })),
        );
    };
    logDiagnostic("connected", { userId: request.auth?.userId || "" });
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          event: "session_log_policy",
          policy: resolveSessionLogClientPolicy(),
        }),
      );
    }
    async function processLogMessage(raw) {
      let receiptCount = 1;
      let rejectedRecord;
      try {
        if (Buffer.byteLength(raw || "") > MAX_LOG_MESSAGE_BYTES) {
          throw new Error("log payload too large");
        }
        const parsed = JSON.parse(String(raw || "{}"));
        const events = Array.isArray(parsed?.events) ? parsed.events : [parsed];
        receiptCount = events.length;
        if (events.length > MAX_LOG_BATCH_SIZE) {
          throw new Error("log batch too large");
        }
        logDiagnostic("received", { count: events.length });
        const records = events.map((item) => ({
          ...item,
          userId: request.auth.userId,
        }));

        for (const record of records) {
          requireSessionLogChannel(record.channel);
          normalizeRuntimeEventEnvelope(record);
        }
        const reliableWrites = [];
        const reliableRecords = [];
        for (const record of records) {
          if (isSessionLogDebugEvent(record)) {
            void Promise.resolve(writeLogEvent(record)).then(
              (result) => {
                if (result.ok === false) reportWriteFailure(result.error, 0, record);
              },
              (error) => reportWriteFailure(error, 0, record),
            );
          } else {
            reliableRecords.push(record);
            reliableWrites.push(
              Promise.resolve(writeLogEvent(record)).then((result) => {
                if (result.ok === false) throw result.error;
                return result;
              }),
            );
          }
        }
        const results = await Promise.allSettled(reliableWrites);
        const failureIndex = results.findIndex((result) => result.status === "rejected");
        if (failureIndex !== -1) {
          rejectedRecord = reliableRecords[failureIndex];
          throw results[failureIndex].reason;
        }
        if (ws.readyState === ws.OPEN)
          ws.send(JSON.stringify(requireSessionLogReceipt({ event: "ack", count: events.length })));
      } catch (error) {
        reportWriteFailure(error, receiptCount, rejectedRecord);
      }
    }
    let messageQueue = Promise.resolve();
    ws.on("message", (raw) => {
      messageQueue = messageQueue.then(() => processLogMessage(raw));
    });
  });
  return { webSocketServer: wss };
}
