/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../../../shared/errors/index.js";
import { runBestEffort } from "@noobot/shared/best-effort";
import { parseServerSentEvents } from "@noobot/shared/event-stream";
import { MIME_TYPE, resolveMediaTypeFromContentType } from "@noobot/attachment-protocol/mime";
import { tSystem } from "noobot-i18n/agent/system-text";
import { BaseMcpClient, buildJsonRpcRequest, buildRequestHeaders } from "./base.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { text } from "@noobot/shared/value";

async function readJsonRpcResponse({ response, requestId, method, baseUrl }) {
  const mediaType = resolveMediaTypeFromContentType(response.headers.get("content-type"));
  if (mediaType !== MIME_TYPE.TEXT_EVENT_STREAM) return response.json();
  const events = parseServerSentEvents(await response.text());
  for (const { event, data } of events) {
    if (event !== "message") continue;
    const payload = JSON.parse(data);
    if (payload.id === requestId) return payload;
  }
  throw recoverableToolError(`${tSystem("mcp.responseMissing")}(${method}): ${requestId}`, {
    code: ERROR_CODE.RECOVERABLE_MCP_RESPONSE_MISSING,
    details: { method, requestId, baseUrl },
  });
}

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
    const responseSessionId = text(response.headers.get("mcp-session-id"));
    if (responseSessionId) this.sessionId = responseSessionId;
    if (!response.ok) {
      const inputText = await response.text().catch(() => "");
      throw recoverableToolError(
        `${tSystem("mcp.httpError")}(${method}): ${response.status} ${response.statusText} ${inputText}`.trim(),
        {
          code: ERROR_CODE.RECOVERABLE_MCP_HTTP_ERROR,
          details: {
            method,
            status: response.status,
            statusText: response.statusText,
            requestId: text(response.headers.get("x-request-id")),
            body: inputText,
            baseUrl: this.baseUrl,
          },
        },
      );
    }
    return readJsonRpcResponse({ response, requestId, method, baseUrl: this.baseUrl });
  }

  async _doNotify({ method, params = {} }) {
    const requestHeaders = buildRequestHeaders(this.headers, this._sessionHeaders());
    await runBestEffort(
      () =>
        this.fetch(this.baseUrl, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({ jsonrpc: "2.0", method, params }),
          signal: this.signal || undefined,
        }),
      { operationName: "mcp.streamableHttp.notify", context: { method } },
    );
  }
}
