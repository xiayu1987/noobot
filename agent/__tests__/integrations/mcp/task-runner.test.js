/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { executeMcpTask } from "../../../src/integrations/mcp/task-runner.js";

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

function createFakeModelPort() {
  const invocations = [];
  return {
    invocations,
    async invoke(request) {
      invocations.push(request);
      return { output: { text: "done", toolCalls: [] } };
    },
  };
}

const QWEN_MODEL = Object.freeze({
  alias: "qwen-test",
  model: "qwen-max",
  reasoning_effort_parameter: "enable_thinking",
  reasoning_effort_options: ["none", "medium"],
  operatorId: "alibaba",
  adapterId: "openai-compatible",
});

const OPENAI_MODEL = Object.freeze({
  alias: "openai-alias",
  model: "gpt-test",
  reasoning_effort_parameter: "reasoning_effort",
  reasoning_effort_options: ["none", "low", "medium", "high"],
  providerId: "openai",
  adapterId: "openai-compatible",
  reasoning_effort: "high",
  tool_reasoning_effort: "medium",
});

function createGlobalConfig() {
  return {
    mcpServers: {
      fake: {
        type: "streamableHttp",
        baseUrl: "https://mcp.example.test/rpc",
        isActive: true,
      },
    },
  };
}

test("executeMcpTask sends the resolved Qwen ModelSpec through the host ModelPort", async () => {
  const modelPort = createFakeModelPort();

  const result = await executeMcpTask({
    globalConfig: createGlobalConfig(),
    mcpName: "fake",
    task: "do it",
    fetchImpl: createMcpFetch(),
    runtime: { modelPort, modelSpec: QWEN_MODEL },
  });

  assert.equal(result.ok, true);
  assert.equal(modelPort.invocations[0].model, QWEN_MODEL);
  assert.equal(modelPort.invocations[0].tools.length, 1);
  assert.equal(modelPort.invocations[0].options.streaming, false);
});

test("executeMcpTask preserves the explicitly selected OpenAI-compatible ModelSpec", async () => {
  const modelPort = createFakeModelPort();

  const result = await executeMcpTask({
    globalConfig: createGlobalConfig(),
    mcpName: "fake",
    task: "do it",
    modelName: "openai-alias",
    fetchImpl: createMcpFetch(),
    runtime: { modelPort, modelSpec: OPENAI_MODEL },
  });

  assert.equal(result.ok, true);
  assert.equal(modelPort.invocations[0].model, OPENAI_MODEL);
  assert.equal(modelPort.invocations[0].invocation.flow, "mcp.task");
});
