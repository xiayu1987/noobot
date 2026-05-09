/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./src/config.js";
import { ChannelManager } from "./src/channel-manager.js";
import { WsRouter } from "./src/ws-router.js";
import { proxyHttpRequest, writeProxyError } from "./src/http-proxy.js";
import { interceptConnectRequest } from "./src/connect-interceptor.js";
import { parseRequestPathname, parseRequestQuery, normalizeApiKey } from "./src/utils.js";

async function loadWebSocketLibrary() {
  try {
    return await import("ws");
  } catch {
    return import("../service/node_modules/ws/wrapper.mjs");
  }
}

const websocketLibrary = await loadWebSocketLibrary();
const WebSocket = websocketLibrary.default || websocketLibrary.WebSocket;
const WebSocketServer = websocketLibrary.WebSocketServer;

// ---- State ----
const channelManager = new ChannelManager(WebSocket);
const wsRouter = new WsRouter(channelManager);
let activeConnectionCount = 0;

// ---- HTTP Server ----
const httpServer = http.createServer((request, response) => {
  const pathname = parseRequestPathname(request);

  if (pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        service: "agentProxy",
        channelCount: channelManager.channelCount,
        activeConnections: activeConnectionCount,
      }),
    );
    return;
  }

  if (config.connectPaths.includes(pathname)) {
    interceptConnectRequest(request, response, channelManager).catch((error) => {
      writeProxyError(response, 500, error?.message || "agentProxy connect intercept error");
    });
    return;
  }

  proxyHttpRequest(request, response);
});

// ---- WebSocket Server ----
const websocketServer = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (request, socket, head) => {
  const { pathname } = parseRequestQuery(request);
  if (!config.wsPaths.includes(pathname)) {
    socket.destroy();
    return;
  }
  if (activeConnectionCount >= config.maxConnections) {
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocket.__agentProxySocketId = randomUUID();
    webSocket.__agentProxyChannelKeys = new Set();
    webSocket.__agentProxyLastSequenceByChannel = {};
    websocketServer.emit("connection", webSocket, request);
  });
});

websocketServer.on("connection", (socket, request) => {
  activeConnectionCount += 1;
  const requestInfo = parseRequestQuery(request);
  const connectionApiKey = normalizeApiKey(requestInfo.apiKey);
  const connectionLocale = requestInfo.locale;
  socket.__agentProxyApiKey = connectionApiKey;
  const socketIdentity = channelManager.resolveApiKeyIdentity(connectionApiKey);
  socket.__agentProxyUserId = String(socketIdentity?.userId || "").trim();

  if (!connectionApiKey) {
    channelManager.sendSocketError(socket, "agentProxy missing apikey");
    try {
      socket.close(1008, "missing_apikey");
    } catch {
      // ignore close errors
    }
    activeConnectionCount = Math.max(0, activeConnectionCount - 1);
    return;
  }

  // Delegate message routing to WsRouter
  wsRouter.handle(socket, connectionApiKey, connectionLocale);

  socket.on("close", () => {
    activeConnectionCount = Math.max(0, activeConnectionCount - 1);
    channelManager.detachSocketFromAllChannels(socket);
  });

  socket.on("error", () => {
    activeConnectionCount = Math.max(0, activeConnectionCount - 1);
    channelManager.detachSocketFromAllChannels(socket);
  });
});

// ---- Cleanup Timer ----
const cleanupTimer = setInterval(() => {
  channelManager.cleanupExpiredChannels();
}, config.cleanupIntervalMs);

cleanupTimer.unref?.();

// ---- Start ----
httpServer.listen(config.proxyPort, config.proxyHost, () => {
  console.log(
    `[agentProxy] listening on ${config.proxyHost}:${config.proxyPort}, upstream=${config.upstreamWsUrl}`,
  );
});
