/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import https from "node:https";
import { config } from "./config.js";

export function writeProxyError(response, statusCode = 502, message = "Bad Gateway") {
  if (!response || response.headersSent) return;
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      ok: false,
      error: String(message || "Bad Gateway"),
    }),
  );
}

export function collectRequestBody(request) {
  return new Promise((resolve, reject) => {
    if (!request) {
      resolve(Buffer.from(""));
      return;
    }
    let totalSize = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      totalSize += chunk.length;
      if (totalSize > config.maxBodySize) {
        request.destroy(new Error("request body too large"));
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || "")));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

export function proxyHttpRequest(request, response) {
  const method = String(request?.method || "GET").trim().toUpperCase() || "GET";
  let targetUrl = null;
  try {
    targetUrl = new URL(request?.url || "/", config.upstreamHttpBase);
  } catch {
    writeProxyError(response, 400, "agentProxy invalid request url");
    return;
  }
  const isHttps = targetUrl.protocol === "https:";
  const requestHeaders = { ...(request?.headers || {}) };
  delete requestHeaders.host;
  const transport = isHttps ? https : http;
  const upstreamRequest = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: requestHeaders,
      timeout: config.httpUpstreamTimeoutMs,
    },
    (upstreamResponse) => {
      const statusCode = Number(upstreamResponse?.statusCode || 502);
      const responseHeaders = { ...(upstreamResponse?.headers || {}) };
      responseHeaders["x-agent-proxy"] = "noobot-agent-proxy";
      response.writeHead(statusCode, responseHeaders);
      upstreamResponse.pipe(response);
    },
  );
  upstreamRequest.on("timeout", () => {
    upstreamRequest.destroy(new Error("upstream timeout"));
  });
  upstreamRequest.on("error", (error) => {
    writeProxyError(response, 502, error?.message || "agentProxy upstream http error");
  });
  request.pipe(upstreamRequest);
}
