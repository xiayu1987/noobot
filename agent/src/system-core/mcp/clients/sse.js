/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logError } from "../../tracking/console/logger.js";
import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";
import { BaseMcpClient, buildJsonRpcRequest, buildRequestHeaders } from "./base.js";
import { ERROR_CODE } from "../../error/constants.js";

function parseSseEventBlock(rawBlock = "") {
  const normalized = String(rawBlock || "").replace(/\r/g, "");
  const lines = normalized.split("\n");
  let eventName = "message";
  const dataLines = [];
  let seenData = false;
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      seenData = true;
      dataLines.push(line.slice(5).trimStart());
      continue;
    }
    if (seenData) {
      dataLines.push(line);
    }
  }
  return {
    event: eventName,
    data: dataLines.join("\n").trim(),
  };
}

/**
 * SSE MCP client.
 * Expects pre-resolved headers from caller.
 */
export class SseMcpClient extends BaseMcpClient {
  constructor({ baseUrl, headers = {}, signal = null, fetchImpl = null }) {
    super({ baseUrl, headers, signal, fetchImpl });
    this.messageUrl = "";
    this._streamAbortController = null;
    this._pending = new Map();
    this._connectPromise = null;
    this._endpointResolved = false;
    this._endpointResolver = null;
    this._endpointRejecter = null;
    this._endpointPromise = new Promise((resolve, reject) => {
      this._endpointResolver = resolve;
      this._endpointRejecter = reject;
    });
  }

  _resolveMessageUrl(endpointData = "") {
    const endpoint = String(endpointData || "").trim();
    if (!endpoint) return "";
    if (/^https?:\/\//i.test(endpoint)) return endpoint;
    return new URL(endpoint, this.baseUrl).toString();
  }

  _rejectAllPending(error) {
    for (const [, pending] of this._pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pending.clear();
  }

  _handleSseEvent(eventName = "", rawData = "") {
    const event = String(eventName || "").trim();
    const data = String(rawData || "").trim();
    if (event === "endpoint") {
      const resolved = this._resolveMessageUrl(data);
      if (resolved && !this._endpointResolved) {
        this.messageUrl = resolved;
        this._endpointResolved = true;
        this._endpointResolver(resolved);
      }
      return;
    }
    if (event !== "message") return;
    if (!data) return;
    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      logError("[mcp-sse-client] JSON.parse event data failed", {
        data: String(data || "").slice(0, 200),
        error: error?.message || String(error),
      });
      return;
    }
    const responseId = payload?.id;
    if (responseId === undefined || responseId === null) return;
    const pending = this._pending.get(responseId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pending.delete(responseId);
    pending.resolve(payload);
  }

  async _startSseStream() {
    const headers = {
      accept: "text/event-stream",
      ...this.headers,
    };
    this._streamAbortController = new AbortController();
    if (this.signal) {
      if (this.signal.aborted) this._streamAbortController.abort();
      else {
        this.signal.addEventListener(
          "abort",
          () => this._streamAbortController?.abort(),
          { once: true },
        );
      }
    }
    const response = await this.fetch(this.baseUrl, {
      method: "GET",
      headers,
      signal: this._streamAbortController.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw recoverableToolError(
        `${tSystem("mcp.sseConnectError")}: ${response.status} ${response.statusText} ${text}`.trim(),
        {
          code: ERROR_CODE.RECOVERABLE_MCP_SSE_CONNECT_ERROR,
          details: {
            status: Number(response.status || 0),
            statusText: String(response.statusText || ""),
            body: String(text || ""),
            baseUrl: this.baseUrl,
          },
        },
      );
    }
    if (!response.body) {
      throw recoverableToolError(tSystem("mcp.sseBodyMissing"), {
        code: ERROR_CODE.RECOVERABLE_MCP_SSE_BODY_MISSING,
        details: { baseUrl: this.baseUrl },
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let splitIndex = buffer.indexOf("\n\n");
        while (splitIndex >= 0) {
          const block = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);
          const parsed = parseSseEventBlock(block);
          this._handleSseEvent(parsed.event, parsed.data);
          splitIndex = buffer.indexOf("\n\n");
        }
      }
      if (!this._endpointResolved) {
        throw recoverableToolError(tSystem("mcp.sseEndpointMissing"), {
          code: ERROR_CODE.RECOVERABLE_MCP_SSE_ENDPOINT_MISSING,
          details: { baseUrl: this.baseUrl },
        });
      }
    } catch (error) {
      if (!this._endpointResolved) this._endpointRejecter(error);
      this._rejectAllPending(error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async connect() {
    if (!this._connectPromise) {
      this._connectPromise = this._startSseStream()
        .catch((error) => {
          this._rejectAllPending(error);
          if (!this._endpointResolved) this._endpointRejecter(error);
        })
        .then(() => null);
    }
    await this._endpointPromise;
  }

  async _doRequest({ method, params = {} }) {
    await this.connect();
    const requestId = this.id++;
    const payload = buildJsonRpcRequest(requestId, method, params);

    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(
          recoverableToolError(`${tSystem("mcp.sseRequestTimeout")}: ${method}`, {
            code: ERROR_CODE.RECOVERABLE_MCP_SSE_TIMEOUT,
            details: {
              method,
              requestId,
              messageUrl: this.messageUrl,
            },
          }),
        );
      }, 30000);
      this._pending.set(requestId, { resolve, reject, timer });
    });

    const postResponse = await this.fetch(this.messageUrl, {
      method: "POST",
      headers: buildRequestHeaders(this.headers),
      body: JSON.stringify(payload),
      signal: this.signal || undefined,
    });
    if (!(postResponse.ok || postResponse.status === 202)) {
      const text = await postResponse.text().catch(() => "");
      const pending = this._pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this._pending.delete(requestId);
      }
      throw recoverableToolError(
        `${tSystem("mcp.ssePostError")}(${method}): ${postResponse.status} ${postResponse.statusText} ${text}`.trim(),
        {
          code: ERROR_CODE.RECOVERABLE_MCP_SSE_POST_ERROR,
          details: {
            method,
            status: Number(postResponse.status || 0),
            statusText: String(postResponse.statusText || ""),
            body: String(text || ""),
            messageUrl: this.messageUrl,
          },
        },
      );
    }

    const payloadResponse = await responsePromise;
    if (payloadResponse?.error) {
      throw recoverableToolError(
        `${tSystem("mcp.rpcError")}(${method}): ${payloadResponse.error?.message || JSON.stringify(payloadResponse.error)}`,
        {
          code: ERROR_CODE.RECOVERABLE_MCP_RPC_ERROR,
          details: {
            method,
            rpcError: payloadResponse.error || {},
            messageUrl: this.messageUrl,
          },
        },
      );
    }
    return payloadResponse;
  }

  async _doNotify({ method, params = {} }) {
    await this.connect();
    await this.fetch(this.messageUrl, {
      method: "POST",
      headers: buildRequestHeaders(this.headers),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      }),
      signal: this.signal || undefined,
    }).catch(() => {});
  }
}
