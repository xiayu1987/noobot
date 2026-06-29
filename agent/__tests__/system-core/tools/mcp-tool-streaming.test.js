import test from "node:test";
import assert from "node:assert/strict";

import { createMcpTool } from "../../../src/system-core/tools/execution/mcp-tool.js";

function createJsonResponse(payload = {}, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: {
      get(name = "") {
        return headers[String(name || "").toLowerCase()] || "";
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function createMcpFetch() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (body?.method === "initialize") {
      return createJsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fake" } },
      });
    }
    if (body?.method === "notifications/initialized") {
      return createJsonResponse({ ok: true });
    }
    if (body?.method === "tools/list") {
      return createJsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            {
              name: "fake_mcp_tool",
              description: "fake",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    }
    return createJsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("call_mcp_task: 透传父 runConfig 显式 streaming=false 到子 session", async () => {
  const runCalls = [];
  const runtime = {
    userId: "primary-user",
    botManager: {
      async runSession(payload = {}) {
        runCalls.push(payload);
        return { answer: "done", traces: [], messages: [], dialogProcessId: "dp_child" };
      },
    },
    systemRuntime: {
      sessionId: "parent-session",
      dialogProcessId: "dp_parent",
      config: {
        allowUserInteraction: true,
        streaming: false,
        selectedConnectors: {},
      },
    },
    globalConfig: {
      mcpServers: {
        fake: {
          type: "streamable_http",
          baseUrl: "https://mcp.example.test/rpc",
          isActive: true,
        },
      },
    },
    userConfig: {},
    sharedTools: { fetch: createMcpFetch() },
  };
  const [tool] = createMcpTool({ agentContext: { userId: "primary-user", runtime } });
  const raw = await tool.invoke({ mcpName: "fake", task: "do something" });
  const payload = JSON.parse(String(raw || "{}"));
  assert.equal(payload.ok, true);
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0]?.runConfig?.streaming, false);
});
