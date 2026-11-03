/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import https from "node:https";
import { config } from "../shared/config.js";
import { normalizeProxyPathname } from "../http/http-proxy.js";
import { bridgeDuplexStreams } from "../http/duplex-stream-bridge.js";
import { parseRequestPathname } from "../shared/utils.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { text } from "@noobot/shared/value";

export function isIdeProxyPath(pathname = "") {
  const normalizedPathname = text(pathname);
  return normalizedPathname === "/ide" || normalizedPathname.startsWith("/ide/");
}

export function isLogProxyPath(pathname = "") {
  return pathname === "/logs/ws" || pathname === "/api/logs/ws";
}

export function agentProxyLogDiagnostic(message, data = {}) {
  void writeRuntimeEvent({
    scope: "system",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: "session-log-ws",
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

export function proxyUpgradeToHttpUpstream(request, socket, head) {
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
    agentProxyLogDiagnostic("proxy upgrade failed", {
      reason: "invalid-url",
      url: request?.url || "",
    });
    socket.destroy();
    return;
  }
  const isHttps = upstreamUrl.protocol === "https:";
  const transport = isHttps ? https : http;
  const requestHeaders = { ...(request?.headers || {}) };
  requestHeaders.host = `${upstreamUrl.hostname}${upstreamUrl.port ? `:${upstreamUrl.port}` : ""}`;
  let upgradeEstablished = false;
  const upstreamRequest = transport.request({
    protocol: upstreamUrl.protocol,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    method: request?.method || "GET",
    path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
    headers: requestHeaders,
    timeout: TIME_THRESHOLDS.agentProxy.httpUpstreamTimeoutMs,
  });
  socket.on("error", (error) => {
    if (upgradeEstablished) return;
    agentProxyLogDiagnostic("proxy upgrade downstream error", {
      pathname: upstreamUrl?.pathname || "",
      reason: error?.code || "downstream_error",
      error: error?.message || String(error),
    });
    upstreamRequest.destroy();
  });
  socket.once("close", () => {
    if (!upgradeEstablished) upstreamRequest.destroy();
  });
  upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    upgradeEstablished = true;
    if (isLogProxyPath(parseRequestPathname(request))) {
      agentProxyLogDiagnostic("proxy upgrade accepted", {
        statusCode: upstreamResponse.statusCode || 101,
      });
    }
    bridgeDuplexStreams({
      upstream: upstreamSocket,
      downstream: socket,
      beforePipe: () => {
        socket.write(
          `HTTP/1.1 ${upstreamResponse.statusCode || 101} ${upstreamResponse.statusMessage || "Switching Protocols"}\r\n` +
            Object.entries(upstreamResponse.headers || {})
              .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
              .join("\r\n") +
            "\r\n\r\n",
        );
        if (upstreamHead?.length) socket.write(upstreamHead);
      },
      onError: ({ reason, error }) => {
        agentProxyLogDiagnostic("proxy upgrade stream error", {
          pathname: upstreamUrl?.pathname || "",
          reason,
          error: error?.message || String(error),
        });
      },
    });
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
      agentProxyLogDiagnostic("proxy upgrade error", {
        pathname: upstreamUrl?.pathname || "",
        error: error?.message || String(error),
      });
    }
    socket.destroy();
  });
  upstreamRequest.end(head);
}
