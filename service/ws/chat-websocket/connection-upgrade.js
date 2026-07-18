/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HTTP_STATUS } from "#agent/constants";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

export function sendUpgradeError(
  socket,
  statusCode = HTTP_STATUS.UNAUTHORIZED,
  message = "Unauthorized",
) {
  if (!socket.writable) return;
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
  socket.destroy();
}

export function registerWebSocketUpgrade(
  server,
  webSocketServer,
  {
    resolveRequestLocale,
    defaultLocale,
    translateText,
    resolveAuthByApiKey,
    sessionLogConfig,
  } = {},
) {
  server.on("upgrade", (request, socket, head) => {
    const requestLocale = resolveRequestLocale(request, defaultLocale);
    let requestPathname = "";
    try {
      requestPathname = new URL(request.url || "", "http://localhost").pathname;
    } catch (error) {
      const rawUrl = String(request?.url || "");
      const urlPathPreview = rawUrl.split("?")[0].slice(0, 200);
      void writeRoutedRuntimeEvent({
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
        level: "warn",
        event: "service.websocket.upgradeUrlParse.failed",
        data: {
          urlPathPreview,
          urlLength: rawUrl.length,
        },
        error,
      }, sessionLogConfig);
      sendUpgradeError(
        socket,
        HTTP_STATUS.BAD_REQUEST,
        translateText("ws.badRequest", requestLocale),
      );
      return;
    }

    if (requestPathname.startsWith("/ide/")) {
      return;
    }

    if (requestPathname !== "/chat/ws") return;

    const authInfo = resolveAuthByApiKey(request);
    if (!authInfo) {
      void writeRoutedRuntimeEvent({
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.BACKEND_WEBSOCKET,
        level: "warn",
        event: "service.websocket.upgrade.authentication.failed",
        data: { pathname: requestPathname },
      }, sessionLogConfig);
      sendUpgradeError(
        socket,
        HTTP_STATUS.UNAUTHORIZED,
        translateText("auth.missingApiKey", requestLocale),
      );
      return;
    }
    void writeRoutedRuntimeEvent({
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.BACKEND_WEBSOCKET,
      event: "service.websocket.upgrade.authentication.succeeded",
      data: { pathname: requestPathname },
    }, sessionLogConfig);
    request.auth = authInfo;
    request.locale = requestLocale;

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });
}
