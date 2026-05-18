/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../error/constants.js";
import { MIME_TYPE } from "../../constants/index.js";

export function resolveFetchImpl(fetchImpl = null) {
  if (typeof fetchImpl === "function") return fetchImpl;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  throw recoverableToolError(tSystem("mcp.fetchUnavailable"));
}

export function buildJsonRpcRequest(id, method, params = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: params && typeof params === "object" ? params : {},
  };
}

export function buildJsonRpcNotification(method, params = {}) {
  return {
    jsonrpc: "2.0",
    method,
    params: params && typeof params === "object" ? params : {},
  };
}

export function buildRequestHeaders(extraHeaders = {}, sessionHeaders = {}) {
  return {
    "content-type": MIME_TYPE.APPLICATION_JSON,
    accept: `${MIME_TYPE.APPLICATION_JSON}, text/event-stream`,
    ...extraHeaders,
    ...sessionHeaders,
  };
}

export function throwRpcError(method, payloadError, baseUrl = "") {
  throw recoverableToolError(
    `${tSystem("mcp.rpcError")}(${method}): ${payloadError?.message || JSON.stringify(payloadError)}`,
    {
      code: ERROR_CODE.RECOVERABLE_MCP_RPC_ERROR,
      details: {
        method,
        rpcError: payloadError || {},
        ...(baseUrl ? { baseUrl } : {}),
      },
    },
  );
}

/**
 * Base MCP client with common JSON-RPC lifecycle.
 * Subclasses implement transport-specific _doRequest / _doNotify.
 */
export class BaseMcpClient {
  constructor({ baseUrl, headers = {}, signal = null, fetchImpl = null }) {
    this.baseUrl = String(baseUrl || "").trim();
    this.headers = headers && typeof headers === "object" && !Array.isArray(headers) ? headers : {};
    this.signal = signal || null;
    this.fetch = resolveFetchImpl(fetchImpl);
    this.id = 1;
  }

  /**
   * Transport-specific request implementation.
   * Must resolve with the parsed JSON-RPC result object, or throw on error.
   */
  async _doRequest({ method, params = {} }) {
    throw new Error("_doRequest must be implemented by subclass");
  }

  /**
   * Transport-specific notification implementation.
   */
  async _doNotify({ method, params = {} }) {
    throw new Error("_doNotify must be implemented by subclass");
  }

  async _request({ method, params = {} }) {
    const result = await this._doRequest({ method, params });
    if (result?.error) {
      throwRpcError(method, result.error, this.baseUrl);
    }
    return result?.result || {};
  }

  async _notify({ method, params = {} }) {
    return this._doNotify({ method, params });
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
