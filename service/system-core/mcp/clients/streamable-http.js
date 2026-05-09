/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";

function resolveFetchImpl(fetchImpl = null) {
  if (typeof fetchImpl === "function") return fetchImpl;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  throw recoverableToolError(tSystem("mcp.fetchUnavailable"));
}

/**
 * Streamable HTTP MCP client.
 * Expects pre-resolved headers from caller.
 */
export class StreamableHttpMcpClient {
  constructor({ baseUrl, headers = {}, signal = null, fetchImpl = null }) {
    this.baseUrl = String(baseUrl || "").trim();
    this.headers = headers && typeof headers === "object" && !Array.isArray(headers) ? headers : {};
    this.signal = signal || null;
    this.fetch = resolveFetchImpl(fetchImpl);
    this.id = 1;
    this.sessionId = "";
  }

  async _request({ method, params = {} }) {
    const requestId = this.id++;
    const requestHeaders = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
    };
    const response = await this.fetch(this.baseUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method,
        params,
      }),
      signal: this.signal || undefined,
    });
    const responseSessionId = String(
      response.headers?.get?.("mcp-session-id") || "",
    ).trim();
    if (responseSessionId) this.sessionId = responseSessionId;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const reqId = String(
        response.headers?.get?.("x-request-id") ||
          response.headers?.get?.("request-id") ||
          "",
      ).trim();
      throw recoverableToolError(
        `${tSystem("mcp.httpError")}(${method}): ${response.status} ${response.statusText} ${text}`.trim(),
        {
          code: "RECOVERABLE_MCP_HTTP_ERROR",
          details: {
            method,
            status: Number(response.status || 0),
            statusText: String(response.statusText || ""),
            requestId: reqId,
            body: String(text || ""),
            baseUrl: this.baseUrl,
          },
        },
      );
    }
    const payload = await response.json();
    if (payload?.error) {
      throw recoverableToolError(
        `${tSystem("mcp.rpcError")}(${method}): ${payload.error?.message || JSON.stringify(payload.error)}`,
        {
          code: "RECOVERABLE_MCP_RPC_ERROR",
          details: {
            method,
            rpcError: payload.error || {},
            baseUrl: this.baseUrl,
          },
        },
      );
    }
    return payload?.result || {};
  }

  async _notify({ method, params = {} }) {
    const requestHeaders = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
    };
    await this.fetch(this.baseUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      }),
      signal: this.signal || undefined,
    }).catch(() => {});
  }

  async initialize() {
    await this._request({
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "noobot-mcp-client",
          version: "1.0.0",
        },
      },
    });
    await this._notify({ method: "notifications/initialized", params: {} });
  }

  async listTools() {
    const result = await this._request({ method: "tools/list", params: {} });
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool({ name, args = {} }) {
    return this._request({
      method: "tools/call",
      params: {
        name: String(name || "").trim(),
        arguments: args && typeof args === "object" ? args : {},
      },
    });
  }
}
