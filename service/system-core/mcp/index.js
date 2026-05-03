/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { mergeConfig, resolveConfigSecrets } from "../config/index.js";
import { createChatModel, createChatModelByName } from "../model/index.js";
import { recoverableToolError } from "../error/index.js";
import { tSystem } from "../i18n/system-text.js";

function toText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text" && typeof item?.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content === null || content === undefined) return "";
  return JSON.stringify(content);
}

function resolveHeaders(rawHeaders = {}, configParams = {}) {
  const resolved = resolveConfigSecrets(rawHeaders, { configParams });
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved
    : {};
}

function resolveFetchImpl(fetchImpl = null) {
  if (typeof fetchImpl === "function") return fetchImpl;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  throw recoverableToolError(tSystem("mcp.fetchUnavailable"));
}

function getMcpServerByName({ globalConfig = {}, userConfig = {}, mcpName = "" }) {
  const name = String(mcpName || "").trim();
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const servers = effectiveConfig?.mcpServers || {};
  const server = servers?.[name];
  if (!server) return null;
  if (server?.isActive === false) return null;
  const serverType = String(server?.type || "").trim();
  if (!["streamableHttp", "sse"].includes(serverType)) return null;
  if (!String(server?.baseUrl || "").trim()) return null;
  const resolvedHeaders = resolveHeaders(
    server?.headers || {},
    effectiveConfig?.configParams || {},
  );
  const authHeader = String(resolvedHeaders?.Authorization || "").trim();
  if (/^Bearer\s*$/i.test(authHeader)) {
    throw recoverableToolError(
      `${tSystem("mcp.authHeaderEmptyAfterResolve")}: ${name}`,
    );
  }
  return { name, ...server, type: serverType, headers: resolvedHeaders };
}

class StreamableHttpMcpClient {
  constructor({ baseUrl, headers = {}, signal = null, fetchImpl = null }) {
    this.baseUrl = String(baseUrl || "").trim();
    this.headers = resolveHeaders(headers);
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
      const requestId = String(
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
            requestId,
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

class SseMcpClient {
  constructor({ baseUrl, headers = {}, signal = null, fetchImpl = null }) {
    this.baseUrl = String(baseUrl || "").trim();
    this.headers = resolveHeaders(headers);
    this.signal = signal || null;
    this.fetch = resolveFetchImpl(fetchImpl);
    this.id = 1;
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
    } catch {
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
          code: "RECOVERABLE_MCP_SSE_CONNECT_ERROR",
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
        code: "RECOVERABLE_MCP_SSE_BODY_MISSING",
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
          code: "RECOVERABLE_MCP_SSE_ENDPOINT_MISSING",
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

  async _request({ method, params = {} }) {
    await this.connect();
    const requestId = this.id++;
    const payload = {
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    };

    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(
          recoverableToolError(`${tSystem("mcp.sseRequestTimeout")}: ${method}`, {
            code: "RECOVERABLE_MCP_SSE_TIMEOUT",
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
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...this.headers,
      },
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
          code: "RECOVERABLE_MCP_SSE_POST_ERROR",
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
          code: "RECOVERABLE_MCP_RPC_ERROR",
          details: {
            method,
            rpcError: payloadResponse.error || {},
            messageUrl: this.messageUrl,
          },
        },
      );
    }
    return payloadResponse?.result || {};
  }

  async _notify({ method, params = {} }) {
    await this.connect();
    await this.fetch(this.messageUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...this.headers,
      },
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

function createMcpClient({ server = {}, signal = null, fetchImpl = null }) {
  const commonOptions = {
    baseUrl: server?.baseUrl || "",
    headers: server?.headers || {},
    signal,
    fetchImpl,
  };
  if (String(server?.type || "").trim() === "sse") {
    return new SseMcpClient(commonOptions);
  }
  return new StreamableHttpMcpClient(commonOptions);
}

function buildMcpToolDescription(toolSpec = {}) {
  const description = String(toolSpec?.description || "").trim();
  const inputSchema = toolSpec?.inputSchema || {};
  const schemaText = JSON.stringify(inputSchema || {}, null, 2);
  if (!description) {
    return `${tSystem("mcp.toolDescriptionDefault")}\n${tSystem("mcp.inputSchemaTitle")}:\n${schemaText}`;
  }
  return `${description}\n\n${tSystem("mcp.inputSchemaTitle")}:\n${schemaText}`;
}

function normalizeMcpToolResult(result = {}) {
  const contentItems = Array.isArray(result?.content) ? result.content : [];
  const text = contentItems
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      if (item.type === "text") return String(item.text || "");
      return JSON.stringify(item);
    })
    .filter(Boolean)
    .join("\n");
  if (text) return text;
  return JSON.stringify(result || {});
}

function buildLangChainMcpTools({ mcpTools = [], client }) {
  return (mcpTools || [])
    .map((toolSpec) => {
      const toolName = String(toolSpec?.name || "").trim();
      if (!toolName) return null;
      return new DynamicStructuredTool({
        name: toolName,
        description: buildMcpToolDescription(toolSpec),
        schema: z.object({}).passthrough(),
        func: async (args = {}) => {
          const callResult = await client.callTool({ name: toolName, args });
          return normalizeMcpToolResult(callResult);
        },
      });
    })
    .filter(Boolean);
}

export async function createMcpAgentTools({
  globalConfig = {},
  userConfig = {},
  mcpName = "",
  signal = null,
  fetchImpl = null,
}) {
  const server = getMcpServerByName({ globalConfig, userConfig, mcpName });
  if (!server) {
    throw recoverableToolError(
      `${tSystem("mcp.serverNotFoundOrInactive")}: ${String(mcpName || "")}`,
    );
  }
  const client = createMcpClient({ server, signal, fetchImpl });
  await client.initialize();
  const mcpTools = await client.listTools();
  const tools = buildLangChainMcpTools({ mcpTools, client });
  return {
    mcpName: server.name,
    server,
    tools,
    toolNames: mcpTools
      .map((item) => String(item?.name || "").trim())
      .filter(Boolean),
  };
}

export async function executeMcpTask({
  globalConfig = {},
  userConfig = {},
  mcpName = "",
  task = "",
  modelName = "",
  signal = null,
  fetchImpl = null,
}) {
  const normalizedTask = String(task || "").trim();
  if (!normalizedTask) {
    throw recoverableToolError(tSystem("mcp.taskRequired"));
  }
  const server = getMcpServerByName({ globalConfig, userConfig, mcpName });
  if (!server) {
    throw recoverableToolError(
      `${tSystem("mcp.serverNotFoundOrInactive")}: ${String(mcpName || "")}`,
    );
  }

  const { tools: langchainTools, toolNames } = await createMcpAgentTools({
    globalConfig,
    userConfig,
    mcpName: server.name,
    signal,
    fetchImpl,
  });
  if (!toolNames.length) {
    return {
      ok: true,
      mcpName: server.name,
      tools: [],
      answer: tSystem("mcp.noToolsAvailable"),
      traces: [],
    };
  }

  const llm = modelName
    ? createChatModelByName(modelName, { globalConfig, userConfig, streaming: false })
    : createChatModel({ globalConfig, userConfig, streaming: false });
  const toolMap = new Map(langchainTools.map((tool) => [tool.name, tool]));

  const messages = [
    new SystemMessage(
      [
        tSystem("mcp.systemPromptLine1"),
        tSystem("mcp.systemPromptLine2"),
        tSystem("mcp.systemPromptLine3"),
      ].join("\n"),
    ),
    new HumanMessage(normalizedTask),
  ];

  const traces = [];
  const maxTurns = 12;
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const ai = await llm.bindTools(langchainTools).invoke(messages, {
      signal: signal || undefined,
    });
    messages.push(ai);
    const calls = Array.isArray(ai?.tool_calls) ? ai.tool_calls : [];
    if (!calls.length) {
      return {
        ok: true,
        mcpName: server.name,
        tools: toolNames,
        answer: toText(ai?.content || ""),
        traces,
      };
    }
    for (const call of calls) {
      const tool = toolMap.get(String(call?.name || "").trim());
      if (!tool) {
        const notFoundMsg = `${tSystem("mcp.toolNotFound")}: ${String(call?.name || "")}`;
        traces.push({ tool: call?.name || "", args: call?.args || {}, result: notFoundMsg });
        messages.push(new ToolMessage({ tool_call_id: call?.id || "", content: notFoundMsg }));
        continue;
      }
      const result = await tool.invoke(call?.args || {}, {
        signal: signal || undefined,
      });
      const resultText = typeof result === "string" ? result : JSON.stringify(result);
      traces.push({
        tool: call?.name || "",
        args: call?.args || {},
        result: String(resultText).slice(0, 1000),
      });
      messages.push(
        new ToolMessage({
          tool_call_id: call?.id || "",
          content: String(resultText),
        }),
      );
    }
  }

  return {
    ok: true,
    mcpName: server.name,
    tools: toolNames,
    answer: tSystem("mcp.toolCallTurnLimitReached"),
    traces,
  };
}
