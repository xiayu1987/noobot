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
import {
  CONNECTION_CLOSE_POLICY,
  createChatConnectionHandler,
} from "./chat-websocket/connection-handler.js";
import { AUTHORITY_EVENT_CONSUMER } from "./chat-websocket/authority-event-dispatcher.js";

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
      consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
      closePolicy: CONNECTION_CLOSE_POLICY.DETACH_RUN,
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
