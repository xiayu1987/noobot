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
import {
  proxyHttpRequest,
  writeProxyError,
  decorateProxyResponseHeaders,
} from "./src/http-proxy.js";
import { interceptConnectRequest } from "./src/connect-interceptor.js";
import { parseRequestPathname, parseRequestQuery, normalizeApiKey } from "./src/utils.js";
import {
  createFixedWindowRateLimiter,
  getClientIp,
  isIpTrusted,
  isOriginTrusted,
} from "./src/security.js";

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
const httpRateLimiter = createFixedWindowRateLimiter({
  windowMs: config.httpRateLimitWindowMs,
  maxRequests: config.httpRateLimitMaxRequests,
});
const wsRateLimiter = createFixedWindowRateLimiter({
  windowMs: config.wsRateLimitWindowMs,
  maxRequests: config.wsRateLimitMaxUpgrades,
});

// ---- HTTP Server ----
const httpServer = http.createServer((request, response) => {
  const pathname = parseRequestPathname(request);
  const clientIp = getClientIp(request);
  const requestOrigin = String(request?.headers?.origin || "").trim();

  if (!isIpTrusted(clientIp, config.trustedIps)) {
    writeProxyError(response, 403, "agentProxy client ip not allowed");
    return;
  }
  if (requestOrigin && !isOriginTrusted(requestOrigin, config.trustedOrigins)) {
    writeProxyError(response, 403, "agentProxy origin not allowed");
    return;
  }
  if (config.httpRateLimitEnabled) {
    const rateLimited = httpRateLimiter.check(clientIp || "unknown-ip");
    if (!rateLimited.ok) {
      response.writeHead(
        429,
        decorateProxyResponseHeaders({
          "content-type": "application/json; charset=utf-8",
          "retry-after": String(rateLimited.retryAfterSec || 1),
        }),
      );
      response.end(JSON.stringify({ ok: false, error: "Too Many Requests" }));
      return;
    }
  }

  if (pathname === "/health") {
    response.writeHead(
      200,
      decorateProxyResponseHeaders({ "Content-Type": "application/json" }),
    );
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
  const clientIp = getClientIp(request);
  const requestOrigin = String(request?.headers?.origin || "").trim();
  if (!config.wsPaths.includes(pathname)) {
    socket.destroy();
    return;
  }
  if (!isIpTrusted(clientIp, config.trustedIps)) {
    socket.destroy();
    return;
  }
  if (requestOrigin && !isOriginTrusted(requestOrigin, config.trustedOrigins)) {
    socket.destroy();
    return;
  }
  if (config.wsRateLimitEnabled) {
    const rateLimited = wsRateLimiter.check(clientIp || "unknown-ip");
    if (!rateLimited.ok) {
      socket.destroy();
      return;
    }
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
  httpRateLimiter.cleanup(config.httpRateLimitWindowMs * 3);
  wsRateLimiter.cleanup(config.wsRateLimitWindowMs * 3);
}, config.cleanupIntervalMs);

cleanupTimer.unref?.();

// ---- Start ----
httpServer.listen(config.proxyPort, config.proxyHost, () => {
  console.log(
    `[agentProxy] listening on ${config.proxyHost}:${config.proxyPort}, upstream=${config.upstreamWsUrl}`,
  );
});
