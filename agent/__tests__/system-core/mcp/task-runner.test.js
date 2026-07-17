/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { executeMcpTask } from "../../../src/system-core/mcp/task-runner.js";
import { resetModelAdapter, setModelAdapter } from "../../../src/system-core/model/index.js";

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
  return async (url, options = {}) => {
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
}

function createFakeModel() {
  const invocations = [];
  return {
    invocations,
    bindTools(tools) {
      this.boundTools = tools;
      return this;
    },
    async invoke(messages, options = {}) {
      invocations.push({ messages, options });
      return { content: "done" };
    },
  };
}

function createGlobalConfig() {
  return {
    mcpServers: {
      fake: {
        type: "streamable_http",
        baseUrl: "https://mcp.example.test/rpc",
        isActive: true,
      },
    },
  };
}

afterEach(() => {
  resetModelAdapter();
});

test("executeMcpTask bound dashscope requests force thinking disabled options", async () => {
  const fakeModel = createFakeModel();
  setModelAdapter({
    createChatModel: () => fakeModel,
    resolveDefaultModelSpec: () => ({ format: "dashscope", preserve_thinking: true, thinking_budget: 4096 }),
  });

  const result = await executeMcpTask({
    globalConfig: createGlobalConfig(),
    mcpName: "fake",
    task: "do it",
    fetchImpl: createMcpFetch(),
  });

  assert.equal(result.ok, true);
  assert.equal(fakeModel.invocations[0].options.preserve_thinking, false);
  assert.equal(fakeModel.invocations[0].options.thinking_budget, 0);
});

test("executeMcpTask bound openai compatible requests use tool_reasoning_effort", async () => {
  const fakeModel = createFakeModel();
  setModelAdapter({
    createChatModelByName: () => fakeModel,
    resolveModelSpecByName: ({ modelName }) => ({
      model: modelName,
      format: "openai_compatible",
      reasoning_effort: "high",
      tool_reasoning_effort: "medium",
    }),
  });

  const result = await executeMcpTask({
    globalConfig: createGlobalConfig(),
    mcpName: "fake",
    task: "do it",
    modelName: "openai-alias",
    fetchImpl: createMcpFetch(),
  });

  assert.equal(result.ok, true);
  assert.equal(fakeModel.invocations[0].options.reasoning_effort, "medium");
});
