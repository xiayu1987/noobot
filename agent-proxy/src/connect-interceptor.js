/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "./config.js";
import { AGENT_PROXY_ERROR } from "./constants.js";
import { resolveLocaleFromRequest } from "./i18n.js";
import { buildClientPermissions } from "./utils.js";
import {
  collectRequestBody,
  writeProxyError,
  decorateProxyResponseHeaders,
} from "./http-proxy.js";
import { isLoopbackAddress, resolveHeaderValue, secureEquals } from "./security.js";

function isConnectTokenAuthorized(request = null) {
  const expectedToken = String(config.connectToken || "").trim();
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
  const method = String(request?.method || "POST").trim().toUpperCase() || "POST";
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
    writeProxyError(
      response,
      413,
      error?.message || AGENT_PROXY_ERROR.REQUEST_BODY_TOO_LARGE,
      locale,
    );
    return;
  }
  const forwardedHeaders = { ...(request?.headers || {}) };
  delete forwardedHeaders.host;
  delete forwardedHeaders["content-length"];
  let upstreamConnectUrl = "";
  try {
    upstreamConnectUrl = new URL("/internal/connect", config.upstreamHttpBase).toString();
  } catch {
    writeProxyError(
      response,
      500,
      AGENT_PROXY_ERROR.INVALID_UPSTREAM_BASE_URL,
      locale,
    );
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
    writeProxyError(
      response,
      502,
      error?.message || AGENT_PROXY_ERROR.CONNECT_INTERCEPT_FAILED,
      locale,
    );
    return;
  }

  const contentType = String(upstreamResponse.headers.get("content-type") || "").toLowerCase();
  const statusCode = Number(upstreamResponse.status || 502);
  const rawText = await upstreamResponse.text();
  const headers = {
    "x-agent-proxy-intercept": "connect",
  };

  if (contentType.includes("application/json")) {
    try {
      const parsedJson = JSON.parse(String(rawText || "{}"));
      const responsePayload =
        parsedJson && typeof parsedJson === "object"
          ? {
              ...parsedJson,
              permissions:
                parsedJson?.permissions &&
                typeof parsedJson.permissions === "object"
                  ? parsedJson.permissions
                  : buildClientPermissions(parsedJson?.role || "user"),
              agentProxy: {
                enabled: true,
                wsPath: "/chat/ws",
              },
            }
          : parsedJson;
      channelManager.saveApiKeyIdentity({
        apiKey: responsePayload?.apiKey || "",
        userId: responsePayload?.userId || "",
        role: responsePayload?.role || "",
      });
      response.writeHead(statusCode, {
        ...decorateProxyResponseHeaders(headers),
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(responsePayload));
      return;
    } catch {
      response.writeHead(statusCode, {
        ...decorateProxyResponseHeaders(headers),
        "content-type": contentType || "application/json; charset=utf-8",
      });
      response.end(rawText);
      return;
    }
  }

  response.writeHead(statusCode, {
    ...decorateProxyResponseHeaders(headers),
    "content-type": contentType || "text/plain; charset=utf-8",
  });
  response.end(rawText);
}
