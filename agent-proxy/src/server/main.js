/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "../shared/config.js";
import { ChannelManager } from "../channel/channel-manager.js";
import { WsRouter } from "../websocket/ws-router.js";
import { initializeDownstreamSocketState } from "../websocket/downstream-socket-state.js";
import { AGENT_PROXY_HTTP_ERROR_CODE } from "../shared/constants.js";
import { TURN_LIFECYCLE_TRANSPORT_PROTOCOL_VERSION } from "@noobot/session-protocol";
import { AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";
import {
  proxyHttpRequest,
  writeProxyError,
  decorateProxyResponseHeaders,
} from "../http/http-proxy.js";
import { interceptConnectRequest } from "../http/connect-interceptor.js";
import { createSessionLogClient } from "../websocket/session-log-client.js";
import { nowMs, parseRequestPathname, parseRequestQuery } from "../shared/utils.js";
import {
  createFixedWindowRateLimiter,
  getClientIp,
  isIpTrusted,
  isOriginTrusted,
} from "../http/security.js";
import { resolveLocaleFromRequest } from "noobot-i18n/agent-proxy";
import { writeAgentProxyHttpServerListenStartedEvent } from "../runtime-events/startup-events.js";
import { writeAgentProxyDataPlaneMetricsEvent } from "../runtime-events/ws-runtime-events.js";
import { DownstreamConnectionRegistry } from "../websocket/downstream-connection-registry.js";
import { authenticateDownstreamSocket } from "../websocket/connection-auth.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { text } from "@noobot/shared/value";
import { createFrontendStaticHandler } from "./frontend-static.js";
import {
  agentProxyLogDiagnostic,
  isIdeProxyPath,
  isLogProxyPath,
  proxyUpgradeToHttpUpstream,
} from "./upgrade-proxy.js";

async function loadWebSocketLibrary() {
  try {
    return await import("ws");
  } catch {
    return import("../../../service/node_modules/ws/wrapper.mjs");
  }
}

function createRateLimiters() {
  const httpRateLimiter = createFixedWindowRateLimiter({
    windowMs: TIME_THRESHOLDS.agentProxy.httpRateLimitWindowMs,
    maxRequests: QUANTITY_THRESHOLDS.agentProxy.httpRateLimitMaxRequests,
  });
  const wsRateLimiter = createFixedWindowRateLimiter({
    windowMs: TIME_THRESHOLDS.agentProxy.wsRateLimitWindowMs,
    maxRequests: QUANTITY_THRESHOLDS.agentProxy.wsRateLimitMaxUpgrades,
  });
  const ideWsRateLimiter = createFixedWindowRateLimiter({
    windowMs: TIME_THRESHOLDS.agentProxy.ideWsRateLimitWindowMs,
    maxRequests: QUANTITY_THRESHOLDS.agentProxy.ideWsRateLimitMaxUpgrades,
  });
  const ideHttpRateLimiter = createFixedWindowRateLimiter({
    windowMs: TIME_THRESHOLDS.agentProxy.ideHttpRateLimitWindowMs,
    maxRequests: QUANTITY_THRESHOLDS.agentProxy.ideHttpRateLimitMaxRequests,
  });
  return { httpRateLimiter, wsRateLimiter, ideWsRateLimiter, ideHttpRateLimiter };
}

function createHttpRequestHandler(runtime) {
  const {
    channelManager,
    downstreamConnections,
    httpRateLimiter,
    ideHttpRateLimiter,
    tryServeFrontend,
  } = runtime;
  return (request, response) => {
    const locale = resolveLocaleFromRequest(request);
    let pathname;
    try {
      pathname = parseRequestPathname(request);
    } catch {
      writeProxyError(response, {
        statusCode: 400,
        code: AGENT_PROXY_HTTP_ERROR_CODE.INVALID_REQUEST_URL,
        locale,
      });
      return;
    }
    const clientIp = getClientIp(request, config.trustedProxies);
    const requestOrigin = text(request?.headers?.origin);

    if (!isIpTrusted(clientIp, config.trustedIps)) {
      writeProxyError(response, {
        statusCode: 403,
        code: AGENT_PROXY_HTTP_ERROR_CODE.CLIENT_IP_NOT_ALLOWED,
        locale,
      });
      return;
    }
    if (requestOrigin && !isOriginTrusted(requestOrigin, config.trustedOrigins)) {
      writeProxyError(response, {
        statusCode: 403,
        code: AGENT_PROXY_HTTP_ERROR_CODE.ORIGIN_NOT_ALLOWED,
        locale,
      });
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
      response.writeHead(200, decorateProxyResponseHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          ok: true,
          service: "agentProxy",
          channelCount: channelManager.channelCount,
          activeConnections: downstreamConnections.size,
        }),
      );
      return;
    }

    if (tryServeFrontend(request, response, pathname)) return;

    if (config.connectPaths.includes(pathname)) {
      interceptConnectRequest(request, response, channelManager).catch((error) => {
        writeProxyError(response, {
          statusCode: 500,
          code: AGENT_PROXY_HTTP_ERROR_CODE.CONNECT_INTERCEPT_ERROR,
          locale,
          detail: error.message,
        });
      });
      return;
    }

    proxyHttpRequest(request, response);
  };
}

function createUpgradeHandler(runtime, websocketServer) {
  const { downstreamConnections, ideWsRateLimiter, logAgentProxyEvent, wsRateLimiter } = runtime;
  return (request, socket, head) => {
    let pathname;
    try {
      pathname = parseRequestPathname(request);
    } catch {
      socket.destroy();
      return;
    }
    const clientIp = getClientIp(request, config.trustedProxies);
    const requestOrigin = text(request?.headers?.origin);
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
      agentProxyLogDiagnostic("log path hit", {
        pathname,
        clientIp,
        hasApiKey: Boolean(parseRequestQuery(request).apiKey),
      });
      logAgentProxyEvent(parseRequestQuery(request).apiKey, {
        category: "agent-proxy",
        event: "agentProxy.logs.upgrade",
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
    if (downstreamConnections.size >= QUANTITY_THRESHOLDS.agentProxy.maxConnections) {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      initializeDownstreamSocketState(webSocket);
      websocketServer.emit("connection", webSocket, request);
    });
  };
}

function createConnectionHandler(runtime) {
  const { channelManager, downstreamConnections, logAgentProxyEvent, serverInstanceId, wsRouter } =
    runtime;
  return (socket, request) => {
    downstreamConnections.register(socket, {
      onFinalize: () => {
        channelManager.releaseSocket(socket);
      },
    });
    const requestInfo = parseRequestQuery(request);
    const connectionApiKey = requestInfo.apiKey;
    logAgentProxyEvent(connectionApiKey, {
      category: "agent-proxy",
      event: "agentProxy.chat.connected",
      data: { pathname: requestInfo.pathname, socketId: socket.__agentProxySocketId },
    });
    const authenticated = authenticateDownstreamSocket({
      socket,
      requestInfo,
      channelManager,
      close: (target, options) => downstreamConnections.close(target, options),
    });
    if (!authenticated) return;

    wsRouter.handle(socket);
    channelManager.sendSocketEvent(socket, {
      event: AGENT_TRANSPORT_EVENT.READY,
      data: { serverInstanceId, protocolVersion: TURN_LIFECYCLE_TRANSPORT_PROTOCOL_VERSION },
    });

    socket.on("close", () => {
      logAgentProxyEvent(connectionApiKey, {
        category: "agent-proxy",
        event: "agentProxy.chat.closed",
        data: {
          socketId: socket.__agentProxySocketId,
          channels: [...socket.__agentProxyChannelKeys],
        },
      });
      downstreamConnections.finalize(socket, "close");
    });

    socket.on("error", () => {
      logAgentProxyEvent(connectionApiKey, {
        category: "agent-proxy",
        level: "warn",
        event: "agentProxy.chat.error",
        data: {
          socketId: socket.__agentProxySocketId,
          channels: [...socket.__agentProxyChannelKeys],
        },
      });
      downstreamConnections.terminate(socket, "error");
    });
    socket.on("message", () => downstreamConnections.touch(socket));
    socket.on("pong", () => downstreamConnections.touch(socket));
  };
}

function startMaintenanceTimers(runtime) {
  const {
    channelManager,
    downstreamConnections,
    httpRateLimiter,
    ideHttpRateLimiter,
    ideWsRateLimiter,
    wsRateLimiter,
  } = runtime;
  const cleanupTimer = setInterval(() => {
    channelManager.cleanupExpiredChannels();
    httpRateLimiter.cleanup(TIME_THRESHOLDS.agentProxy.httpRateLimitWindowMs * 3);
    wsRateLimiter.cleanup(TIME_THRESHOLDS.agentProxy.wsRateLimitWindowMs * 3);
    ideWsRateLimiter.cleanup(TIME_THRESHOLDS.agentProxy.ideWsRateLimitWindowMs * 3);
    ideHttpRateLimiter.cleanup(TIME_THRESHOLDS.agentProxy.ideHttpRateLimitWindowMs * 3);
  }, TIME_THRESHOLDS.agentProxy.cleanupIntervalMs);

  cleanupTimer.unref?.();

  const dataPlaneMetricsTimer = setInterval(() => {
    const metrics = channelManager.drainSuccessfulDataPlaneMetrics();
    if (metrics) void writeAgentProxyDataPlaneMetricsEvent({ metrics });
  }, TIME_THRESHOLDS.agentProxy.dataPlaneMetricsIntervalMs);

  dataPlaneMetricsTimer.unref?.();

  const heartbeatTimer = setInterval(() => {
    downstreamConnections.sweepHeartbeat({
      timeoutMs: TIME_THRESHOLDS.agentProxy.webSocketHeartbeatTimeoutMs,
      onTimeout: (timedOutSocket) => {
        downstreamConnections.close(timedOutSocket, { code: 1001, reason: "heartbeat_timeout" });
      },
    });
    for (const channel of channelManager.channelStore.values()) {
      channel.transport.sweepHeartbeat({
        timeoutMs: TIME_THRESHOLDS.agentProxy.webSocketHeartbeatTimeoutMs,
        onTimeout: () => channelManager.closeUpstreamChannel(channel, 1001, "heartbeat_timeout"),
      });
    }
  }, TIME_THRESHOLDS.agentProxy.webSocketHeartbeatIntervalMs);

  heartbeatTimer.unref?.();
}

export async function startAgentProxy() {
  const websocketLibrary = await loadWebSocketLibrary();
  const WebSocket = websocketLibrary.default || websocketLibrary.WebSocket;
  const WebSocketServer = websocketLibrary.WebSocketServer;

  const sessionLogClient = createSessionLogClient({ WebSocketImpl: WebSocket });
  const channelManager = new ChannelManager(WebSocket, { sessionLogClient });
  const wsRouter = new WsRouter(channelManager);
  const downstreamConnections = new DownstreamConnectionRegistry({ now: nowMs });
  const serverInstanceId = randomUUID();
  const runtime = {
    channelManager,
    downstreamConnections,
    serverInstanceId,
    wsRouter,
    ...createRateLimiters(),
    tryServeFrontend: createFrontendStaticHandler(text(process.env.AGENT_PROXY_FRONTEND_ROOT)),
    logAgentProxyEvent: (apiKey = "", event = {}) =>
      sessionLogClient.log(apiKey, { ...event, scope: "system" }),
  };

  const httpServer = http.createServer(createHttpRequestHandler(runtime));
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: LENGTH_THRESHOLDS.agentProxy.webSocketMaxPayloadBytes,
    perMessageDeflate: false,
  });
  httpServer.on("upgrade", createUpgradeHandler(runtime, websocketServer));
  websocketServer.on("connection", createConnectionHandler(runtime));
  startMaintenanceTimers(runtime);

  httpServer.listen(config.proxyPort, config.proxyHost, () => {
    void writeAgentProxyHttpServerListenStartedEvent({
      host: config.proxyHost,
      port: config.proxyPort,
    });
  });
}
