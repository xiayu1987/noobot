/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { BaseMcpClient, buildJsonRpcRequest, buildRequestHeaders } from "./base.js";
import { ERROR_CODE } from "../../error/constants.js";

/**
 * Streamable HTTP MCP client.
 * Expects pre-resolved headers from caller.
 */
export class StreamableHttpMcpClient extends BaseMcpClient {
  constructor({ baseUrl, headers = {}, signal = null, fetchImpl = null }) {
    super({ baseUrl, headers, signal, fetchImpl });
    this.sessionId = "";
  }

  _sessionHeaders() {
    return this.sessionId ? { "mcp-session-id": this.sessionId } : {};
  }

  async _doRequest({ method, params = {} }) {
    const requestId = this.id++;
    const requestHeaders = buildRequestHeaders(this.headers, this._sessionHeaders());
    const response = await this.fetch(this.baseUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(buildJsonRpcRequest(requestId, method, params)),
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
          code: ERROR_CODE.RECOVERABLE_MCP_HTTP_ERROR,
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
    return response.json();
  }

  async _doNotify({ method, params = {} }) {
    const requestHeaders = buildRequestHeaders(this.headers, this._sessionHeaders());
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
}
