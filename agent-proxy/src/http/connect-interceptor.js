/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../shared/config.js";
import { AGENT_PROXY_HTTP_ERROR_CODE } from "../shared/constants.js";
import { resolveLocaleFromRequest } from "noobot-i18n/agent-proxy";
import { collectRequestBody, writeProxyError, decorateProxyResponseHeaders } from "./http-proxy.js";
import { isLoopbackAddress, resolveHeaderValue, secureEquals } from "./security.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { text } from "@noobot/shared/value";

function isConnectTokenAuthorized(request = null) {
  const expectedToken = text(config.connectToken);
  if (!expectedToken) return true;
  const providedToken = resolveHeaderValue(request, config.connectTokenHeader);
  if (secureEquals(providedToken, expectedToken)) return true;
  if (config.connectTokenAllowLoopback && isLoopbackAddress(request?.socket?.remoteAddress)) {
    return true;
  }
  return false;
}

export async function interceptConnectRequest(request, response, channelManager) {
  const locale = resolveLocaleFromRequest(request);
  const method = (text(request?.method) || "POST").toUpperCase() || "POST";
  if (!isConnectTokenAuthorized(request)) {
    response.writeHead(
      401,
      decorateProxyResponseHeaders({
        "content-type": "application/json; charset=utf-8",
      }),
    );
    response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    return;
  }
  let requestBodyBuffer;
  try {
    requestBodyBuffer = await collectRequestBody(request);
  } catch (error) {
    const tooLarge = error.code === AGENT_PROXY_HTTP_ERROR_CODE.REQUEST_BODY_TOO_LARGE;
    writeProxyError(response, {
      statusCode: tooLarge ? 413 : 400,
      code: tooLarge
        ? AGENT_PROXY_HTTP_ERROR_CODE.REQUEST_BODY_TOO_LARGE
        : AGENT_PROXY_HTTP_ERROR_CODE.REQUEST_BODY_READ_FAILED,
      locale,
    });
    return;
  }
  const forwardedHeaders = { ...(request?.headers || {}) };
  delete forwardedHeaders.host;
  delete forwardedHeaders["content-length"];
  let upstreamConnectUrl = "";
  try {
    upstreamConnectUrl = new URL("/internal/connect", config.upstreamHttpBase).toString();
  } catch (error) {
    await writeRuntimeEvent({
      scope: "system",
      source: "agent-proxy",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.CONFIG,
      level: "error",
      event: "agentProxy.connect.upstreamBaseUrl.invalid",
      data: {
        upstreamHttpBaseLength: String(config.upstreamHttpBase || "").length,
      },
      error,
    });
    writeProxyError(response, {
      statusCode: 500,
      code: AGENT_PROXY_HTTP_ERROR_CODE.INVALID_UPSTREAM_BASE_URL,
      locale,
    });
    return;
  }
  let upstreamResponse = null;
  try {
    upstreamResponse = await fetch(upstreamConnectUrl, {
      method,
      headers: forwardedHeaders,
      body: ["GET", "HEAD"].includes(method) ? undefined : requestBodyBuffer,
      signal: AbortSignal.timeout(config.httpUpstreamTimeoutMs),
    });
  } catch (error) {
    writeProxyError(response, {
      statusCode: 502,
      code: AGENT_PROXY_HTTP_ERROR_CODE.CONNECT_INTERCEPT_FAILED,
      locale,
      detail: error.message,
    });
    return;
  }

  const contentType = String(upstreamResponse.headers.get("content-type") || "").toLowerCase();
  const statusCode = Number(upstreamResponse.status || 502);
  const rawText = await upstreamResponse.text();
  const headers = {
    "x-agent-proxy-intercept": "connect",
  };

  if (upstreamResponse.ok && contentType.includes("application/json")) {
    const connectPayload = JSON.parse(rawText);
    channelManager.saveApiKeyIdentity({
      apiKey: connectPayload.apiKey,
      userId: connectPayload.userId,
    });
    response.writeHead(statusCode, {
      ...decorateProxyResponseHeaders(headers),
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({ ...connectPayload, agentProxy: { enabled: true, wsPath: "/chat/ws" } }),
    );
    return;
  }

  response.writeHead(statusCode, {
    ...decorateProxyResponseHeaders(headers),
    "content-type": contentType || "text/plain; charset=utf-8",
  });
  response.end(rawText);
}
