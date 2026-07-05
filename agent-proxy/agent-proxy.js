/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./src/config.js";
import { ChannelManager } from "./src/channel-manager.js";
import { WsRouter } from "./src/ws-router.js";
import {
  AGENT_PROXY_CLOSE_REASON,
  AGENT_PROXY_ERROR,
} from "./src/constants.js";
import {
  proxyHttpRequest,
  writeProxyError,
  decorateProxyResponseHeaders,
  normalizeProxyPathname,
} from "./src/http-proxy.js";
import { interceptConnectRequest } from "./src/connect-interceptor.js";
import { createSessionLogClient } from "./src/session-log-client.js";
import { parseRequestPathname, parseRequestQuery, normalizeApiKey } from "./src/utils.js";
import {
  createFixedWindowRateLimiter,
  getClientIp,
  isIpTrusted,
  isOriginTrusted,
} from "./src/security.js";
import { resolveLocaleFromRequest } from "noobot-i18n/agent-proxy";
import { writeAgentProxyHttpServerListenStartedEvent } from "./src/startup-events.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

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
const sessionLogClient = createSessionLogClient({ WebSocketImpl: WebSocket });
const channelManager = new ChannelManager(WebSocket, { sessionLogClient });
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
const ideWsRateLimiter = createFixedWindowRateLimiter({
  windowMs: config.ideWsRateLimitWindowMs,
  maxRequests: config.ideWsRateLimitMaxUpgrades,
});
const ideHttpRateLimiter = createFixedWindowRateLimiter({
  windowMs: config.ideHttpRateLimitWindowMs,
  maxRequests: config.ideHttpRateLimitMaxRequests,
});

const frontendRoot = String(process.env.AGENT_PROXY_FRONTEND_ROOT || "").trim();
const frontendIndexPath = frontendRoot ? path.join(frontendRoot, "index.html") : "";
const shouldServeFrontend = Boolean(frontendRoot && fs.existsSync(frontendIndexPath));

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".ico") return "image/x-icon";
  if (extension === ".woff") return "font/woff";
  if (extension === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function isFrontendBypassPath(pathname = "") {
  return pathname === "/health"
    || pathname === "/internal/connect"
    || pathname === "/api/internal/connect"
    || pathname === "/agent-proxy/ws"
    || pathname === "/api/agent-proxy/ws"
    || pathname === "/chat/ws"
    || pathname === "/api/chat/ws"
    || pathname === "/logs/ws"
    || pathname === "/api/logs/ws"
    || pathname.startsWith("/api/")
    || pathname === "/ide"
    || pathname.startsWith("/ide/");
}

function tryServeFrontend(request, response, pathname) {
  if (!shouldServeFrontend || isFrontendBypassPath(pathname)) return false;
  if (!(["GET", "HEAD"].includes(String(request?.method || "GET").toUpperCase()))) return false;
  let decodedPathname = "/";
  try {
    decodedPathname = decodeURIComponent(pathname || "/");
  } catch {
    response.writeHead(400, decorateProxyResponseHeaders({ "content-type": "text/plain; charset=utf-8" }));
    response.end("Bad Request");
    return true;
  }
  const relativePath = decodedPathname === "/" ? "index.html" : decodedPathname.replace(/^\/+/, "");
  const candidatePath = path.resolve(frontendRoot, relativePath);
  const normalizedRoot = path.resolve(frontendRoot);
  if (!candidatePath.startsWith(`${normalizedRoot}${path.sep}`) && candidatePath !== normalizedRoot) {
    response.writeHead(403, decorateProxyResponseHeaders({ "content-type": "text/plain; charset=utf-8" }));
    response.end("Forbidden");
    return true;
  }
  const filePath = fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()
    ? candidatePath
    : frontendIndexPath;
  response.writeHead(200, decorateProxyResponseHeaders({ "content-type": getContentType(filePath) }));
  if (String(request?.method || "GET").toUpperCase() === "HEAD") {
    response.end();
    return true;
  }
  fs.createReadStream(filePath).pipe(response);
  return true;
}

function isIdeProxyPath(pathname = "") {
  const normalizedPathname = String(pathname || "").trim();
  return normalizedPathname === "/ide" || normalizedPathname.startsWith("/ide/");
}

function isLogProxyPath(pathname = "") {
  return pathname === "/logs/ws" || pathname === "/api/logs/ws";
}

function agentProxyLogDiagnostic(message, data = {}) {
  const raw = String(process.env.AGENT_PROXY_SESSION_LOG_DIAGNOSTIC || "true").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(raw)) return;
  void writeRoutedRuntimeEvent({
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: "debug",
    event: "agentProxy.sessionLogWs.diagnostic",
    data: {
      message: String(message || ""),
      detailKeys: data && typeof data === "object" ? Object.keys(data).slice(0, 20) : [],
      statusCode: Number(data?.statusCode || 0),
      pathname: String(data?.pathname || "").slice(0, 200),
      reason: String(data?.reason || "").slice(0, 120),
    },
  });
}

function logAgentProxyEvent(apiKey = "", event = {}) {
  sessionLogClient.log(apiKey, event);
}

function proxyUpgradeToHttpUpstream(request, socket, head) {
  let upstreamUrl = null;
  try {
    upstreamUrl = new URL(request?.url || "/", config.upstreamHttpBase);
    upstreamUrl.pathname = normalizeProxyPathname(upstreamUrl.pathname);
    if (isLogProxyPath(parseRequestPathname(request))) {
      agentProxyLogDiagnostic("proxy upgrade", {
        from: request?.url || "",
        to: `${upstreamUrl.pathname}${upstreamUrl.search}`,
        upstream: `${upstreamUrl.protocol}//${upstreamUrl.host}`,
      });
    }
  } catch {
    agentProxyLogDiagnostic("proxy upgrade failed", { reason: "invalid-url", url: request?.url || "" });
    socket.destroy();
    return;
  }
  const isHttps = upstreamUrl.protocol === "https:";
  const transport = isHttps ? https : http;
  const requestHeaders = { ...(request?.headers || {}) };
  requestHeaders.host = `${upstreamUrl.hostname}${upstreamUrl.port ? `:${upstreamUrl.port}` : ""}`;
  const upstreamRequest = transport.request({
    protocol: upstreamUrl.protocol,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    method: request?.method || "GET",
    path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
    headers: requestHeaders,
    timeout: config.httpUpstreamTimeoutMs,
  });
  upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    if (isLogProxyPath(parseRequestPathname(request))) {
      agentProxyLogDiagnostic("proxy upgrade accepted", { statusCode: upstreamResponse.statusCode || 101 });
    }
    socket.write(
      `HTTP/1.1 ${upstreamResponse.statusCode || 101} ${upstreamResponse.statusMessage || "Switching Protocols"}\r\n` +
        Object.entries(upstreamResponse.headers || {})
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
          .join("\r\n") +
        "\r\n\r\n",
    );
    if (upstreamHead?.length) socket.write(upstreamHead);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  upstreamRequest.on("response", (upstreamResponse) => {
    if (isLogProxyPath(parseRequestPathname(request))) {
      agentProxyLogDiagnostic("proxy upgrade response", {
        pathname: upstreamUrl?.pathname || "",
        statusCode: upstreamResponse.statusCode || 0,
      });
    }
    const statusCode = upstreamResponse.statusCode || 502;
    const statusMessage = upstreamResponse.statusMessage || "Bad Gateway";
    socket.write(
      `HTTP/1.1 ${statusCode} ${statusMessage}\r\n` +
        Object.entries(upstreamResponse.headers || {})
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
          .join("\r\n") +
        "\r\n\r\n",
    );
    upstreamResponse.on("data", (chunk) => {
      if (socket.writable) socket.write(chunk);
    });
    upstreamResponse.on("end", () => socket.destroy());
  });
  upstreamRequest.on("timeout", () => {
    upstreamRequest.destroy(new Error("upstream timeout"));
  });
  upstreamRequest.on("error", (error) => {
    if (isLogProxyPath(parseRequestPathname(request))) {
      agentProxyLogDiagnostic("proxy upgrade error", { pathname: upstreamUrl?.pathname || "", error: error?.message || String(error) });
    }
    socket.destroy();
  });
  upstreamRequest.end(head);
}

// ---- HTTP Server ----
const httpServer = http.createServer((request, response) => {
  const locale = resolveLocaleFromRequest(request);
  const pathname = parseRequestPathname(request);
  const clientIp = getClientIp(request);
  const requestOrigin = String(request?.headers?.origin || "").trim();

  if (!isIpTrusted(clientIp, config.trustedIps)) {
    writeProxyError(response, 403, AGENT_PROXY_ERROR.CLIENT_IP_NOT_ALLOWED, locale);
    return;
  }
  if (requestOrigin && !isOriginTrusted(requestOrigin, config.trustedOrigins)) {
    writeProxyError(response, 403, AGENT_PROXY_ERROR.ORIGIN_NOT_ALLOWED, locale);
    return;
  }
  if (config.httpRateLimitEnabled) {
    const isIdePath = isIdeProxyPath(pathname);
    const rateLimited =
      isIdePath && config.ideHttpRateLimitEnabled
        ? ideHttpRateLimiter.check(clientIp || "unknown-ip")
        : !isIdePath
          ? httpRateLimiter.check(clientIp || "unknown-ip")
          : { ok: true, retryAfterSec: 0 };
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

  if (tryServeFrontend(request, response, pathname)) return;

  if (config.connectPaths.includes(pathname)) {
    interceptConnectRequest(request, response, channelManager).catch((error) => {
      writeProxyError(
        response,
        500,
        error?.message || AGENT_PROXY_ERROR.CONNECT_INTERCEPT_ERROR,
        locale,
      );
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
  if (!isIpTrusted(clientIp, config.trustedIps)) {
    socket.destroy();
    return;
  }
  if (requestOrigin && !isOriginTrusted(requestOrigin, config.trustedOrigins)) {
    socket.destroy();
    return;
  }
  if (isIdeProxyPath(pathname)) {
    if (config.ideWsRateLimitEnabled) {
      const ideRateLimited = ideWsRateLimiter.check(clientIp || "unknown-ip");
      if (!ideRateLimited.ok) {
        socket.destroy();
        return;
      }
    }
    proxyUpgradeToHttpUpstream(request, socket, head);
    return;
  }

  if (isLogProxyPath(pathname)) {
    agentProxyLogDiagnostic("log path hit", { pathname, clientIp, hasApiKey: Boolean(parseRequestQuery(request).apiKey) });
    logAgentProxyEvent(parseRequestQuery(request).apiKey, {
      category: "agent-proxy",
      event: "agentProxy.logs.upgrade",
      sessionId: "agent-proxy",
      data: { pathname, clientIp },
    });
    proxyUpgradeToHttpUpstream(request, socket, head);
    return;
  }

  if (!config.wsPaths.includes(pathname)) {
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
  socket.__agentProxyLocale = connectionLocale;
  const socketIdentity = channelManager.resolveApiKeyIdentity(connectionApiKey);
  socket.__agentProxyUserId = String(socketIdentity?.userId || "").trim();
  logAgentProxyEvent(connectionApiKey, {
    category: "agent-proxy",
    event: "agentProxy.chat.connected",
    sessionId: "agent-proxy",
    data: { pathname: requestInfo.pathname, socketId: socket.__agentProxySocketId },
  });

  if (!connectionApiKey) {
    channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.MISSING_APIKEY);
    try {
      socket.close(1008, AGENT_PROXY_CLOSE_REASON.MISSING_APIKEY);
    } catch {
      // ignore close errors
    }
    activeConnectionCount = Math.max(0, activeConnectionCount - 1);
    return;
  }

  // Delegate message routing to WsRouter
  wsRouter.handle(socket, connectionApiKey, connectionLocale);

  socket.on("close", () => {
    logAgentProxyEvent(connectionApiKey, {
      category: "agent-proxy",
      event: "agentProxy.chat.closed",
      sessionId: "agent-proxy",
      data: { socketId: socket.__agentProxySocketId, channels: [...(socket.__agentProxyChannelKeys || [])] },
    });
    activeConnectionCount = Math.max(0, activeConnectionCount - 1);
    channelManager.detachSocketFromAllChannels(socket);
  });

  socket.on("error", () => {
    logAgentProxyEvent(connectionApiKey, {
      category: "agent-proxy",
      level: "warn",
      event: "agentProxy.chat.error",
      sessionId: "agent-proxy",
      data: { socketId: socket.__agentProxySocketId, channels: [...(socket.__agentProxyChannelKeys || [])] },
    });
    activeConnectionCount = Math.max(0, activeConnectionCount - 1);
    channelManager.detachSocketFromAllChannels(socket);
  });
});

// ---- Cleanup Timer ----
const cleanupTimer = setInterval(() => {
  channelManager.cleanupExpiredChannels();
  httpRateLimiter.cleanup(config.httpRateLimitWindowMs * 3);
  wsRateLimiter.cleanup(config.wsRateLimitWindowMs * 3);
  ideWsRateLimiter.cleanup(config.ideWsRateLimitWindowMs * 3);
  ideHttpRateLimiter.cleanup(config.ideHttpRateLimitWindowMs * 3);
}, config.cleanupIntervalMs);

cleanupTimer.unref?.();

// ---- Start ----
httpServer.listen(config.proxyPort, config.proxyHost, () => {
  void writeAgentProxyHttpServerListenStartedEvent({
    host: config.proxyHost,
    port: config.proxyPort,
  });
});
