/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "./config.js";
import { buildClientPermissions } from "./utils.js";
import { collectRequestBody, writeProxyError } from "./http-proxy.js";

export async function interceptConnectRequest(request, response, channelManager) {
  const method = String(request?.method || "POST").trim().toUpperCase() || "POST";
  let requestBodyBuffer;
  try {
    requestBodyBuffer = await collectRequestBody(request);
  } catch (error) {
    writeProxyError(response, 413, error?.message || "agentProxy request body too large");
    return;
  }
  const forwardedHeaders = { ...(request?.headers || {}) };
  delete forwardedHeaders.host;
  delete forwardedHeaders["content-length"];
  let upstreamConnectUrl = "";
  try {
    upstreamConnectUrl = new URL("/internal/connect", config.upstreamHttpBase).toString();
  } catch {
    writeProxyError(response, 500, "agentProxy invalid upstream base url");
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
    writeProxyError(response, 502, error?.message || "agentProxy connect intercept failed");
    return;
  }

  const contentType = String(upstreamResponse.headers.get("content-type") || "").toLowerCase();
  const statusCode = Number(upstreamResponse.status || 502);
  const rawText = await upstreamResponse.text();
  const headers = {
    "x-agent-proxy": "noobot-agent-proxy",
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
        ...headers,
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(responsePayload));
      return;
    } catch {
      response.writeHead(statusCode, {
        ...headers,
        "content-type": contentType || "application/json; charset=utf-8",
      });
      response.end(rawText);
      return;
    }
  }

  response.writeHead(statusCode, {
    ...headers,
    "content-type": contentType || "text/plain; charset=utf-8",
  });
  response.end(rawText);
}
