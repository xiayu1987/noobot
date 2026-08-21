/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WebSocketServer } from "ws";
import {
  recordServiceWebSocketRuntimeError,
  recordServiceWebSocketSendFailure,
} from "./chat-websocket/runtime-events.js";
import { registerWebSocketUpgrade } from "./chat-websocket/connection-upgrade.js";
import { createChatConnectionHandler } from "./chat-websocket/connection-handler.js";

export { recordServiceWebSocketSendFailure, recordServiceWebSocketRuntimeError };

export function registerChatWebSocketServer(
  server,
  {
    bot,
    getBot,
    resolveRequestLocale,
    resolveAuthByApiKey,
    mapAgentRunCommand,
    connectorAccessPort,
    normalizeLocale,
    defaultLocale,
    translateText,
    sessionLogConfig,
  } = {},
) {
  const resolveBot = () => {
    if (typeof getBot === "function") return getBot();
    return bot;
  };

  const webSocketServer = new WebSocketServer({ noServer: true });

  registerWebSocketUpgrade(server, webSocketServer, {
    resolveRequestLocale,
    defaultLocale,
    translateText,
    resolveAuthByApiKey,
    sessionLogConfig,
  });

  webSocketServer.on(
    "connection",
    createChatConnectionHandler({
      resolveBot,
      normalizeLocale,
      defaultLocale,
      translateText,
      mapAgentRunCommand,
      connectorAccessPort,
      sessionLogConfig,
    }),
  );

  return { webSocketServer };
}
