/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { createNamespacedToolId } from "@noobot/model-protocol/tool-identity-node";
import { createToolNameBinding } from "@noobot/model-protocol";
import { runWithToolNameBinding } from "@noobot/model-protocol/tool-binding-scope-node";

import {
  MCP_TOOL_RESULT_ERROR,
  buildLangChainMcpTools,
  normalizeMcpInputSchema,
  normalizeMcpToolResult,
} from "../../../src/integrations/mcp/tool-adapter.js";

test("MCP tool adapter exposes inputSchema to model binding", async () => {
  const inputSchema = {
    type: "object",
    properties: {
      date: { type: "string", description: "Travel date" },
      fromStation: { type: "string" },
      toStation: { type: "string" },
    },
    required: ["date", "fromStation", "toStation"],
  };
  const calls = [];
  const tools = buildLangChainMcpTools({
    serverName: "test-server",
    mcpTools: [{ name: "get-tickets", description: "query tickets", inputSchema }],
    client: {
      async callTool(payload) {
        calls.push(payload);
        return { content: [{ type: "text", text: "ok" }] };
      },
    },
  });

  assert.equal(tools.length, 1);
  const openAiTool = convertToOpenAITool(tools[0]);
  assert.deepEqual(openAiTool.function.parameters.properties, inputSchema.properties);
  assert.deepEqual(openAiTool.function.parameters.required, inputSchema.required);

  const result = await runWithToolNameBinding(createToolNameBinding({ tools }), () =>
    tools[0].invoke({
      date: "2026-06-07",
      fromStation: "BJP",
      toStation: "SHH",
    }),
  );
  assert.deepEqual(JSON.parse(result), { ok: true, content: [{ type: "text", text: "ok" }] });
  assert.deepEqual(calls[0], {
    name: "get-tickets",
    args: {
      date: "2026-06-07",
      fromStation: "BJP",
      toStation: "SHH",
    },
  });
});

test("MCP tool result maps isError to ok:false and keeps structuredContent", () => {
  const content = [{ type: "text", text: "boom" }];
  assert.deepEqual(JSON.parse(normalizeMcpToolResult({ content, isError: true })), {
    ok: false,
    code: "RECOVERABLE_MCP_TOOL_REPORTED_ERROR",
    error: "boom",
    content,
  });
  assert.deepEqual(
    JSON.parse(normalizeMcpToolResult({ content, structuredContent: { rows: 2 } })),
    { ok: true, content, structuredContent: { rows: 2 } },
  );
});

test("MCP tools refuse missing and inactive bindings before calling the remote client", async () => {
  let calls = 0;
  const [tool] = buildLangChainMcpTools({
    serverName: "test-server",
    mcpTools: [{ name: "lookup", inputSchema: { type: "object", properties: {} } }],
    client: {
      callTool() {
        calls += 1;
        throw new Error("must not reach remote client");
      },
    },
  });
  await assert.rejects(() => tool.invoke({}), /tool name binding scope is required/);
  for (const tools of [[], [{ name: "other" }]]) {
    await assert.rejects(
      () => runWithToolNameBinding(createToolNameBinding({ tools }), () => tool.invoke({})),
      /undeclared tool identity/,
    );
  }
  assert.equal(calls, 0);
});

test("MCP tool result rejects payloads outside the MCP contract", () => {
  for (const invalid of [undefined, "ok", {}, { content: "ok" }]) {
    assert.throws(() => normalizeMcpToolResult(invalid), {
      name: "TypeError",
      code: MCP_TOOL_RESULT_ERROR.CONTENT_NOT_ARRAY,
    });
  }
  assert.throws(() => normalizeMcpToolResult({ content: [], isError: "true" }), {
    name: "TypeError",
    code: MCP_TOOL_RESULT_ERROR.IS_ERROR_NOT_BOOLEAN,
  });
  assert.throws(
    () => normalizeMcpToolResult({ content: [{ type: "image", data: "x" }], isError: true }),
    { name: "TypeError", code: MCP_TOOL_RESULT_ERROR.ERROR_TEXT_MISSING },
  );
});

test("MCP tool adapter normalizes input schemas", () => {
  assert.deepEqual(normalizeMcpInputSchema({}), { type: "object", properties: {} });
  assert.deepEqual(normalizeMcpInputSchema({ properties: { citys: { type: "string" } } }), {
    type: "object",
    properties: { citys: { type: "string" } },
  });
});

test("MCP tool entry rejects invalid arguments without calling the remote client", async () => {
  const calls = [];
  const tools = buildLangChainMcpTools({
    serverName: "test-server",
    mcpTools: [{ name: "lookup", inputSchema: { type: "object", properties: {} } }],
    client: { callTool: async (payload) => calls.push(payload) },
  });
  await runWithToolNameBinding(createToolNameBinding({ tools }), async () => {
    for (const args of ["{broken", "", "{}", null, 42, []]) {
      await assert.rejects(() => tools[0].invoke(args));
    }
  });
  assert.equal(calls.length, 0);
});

test("MCP tool adapter binds dotted tool names and calls with the original name", async () => {
  const { adaptToolsForBinding } = await import("../../../src/models/tool/binding-adapter.js");
  const calls = [];
  const longName = `ns.${"x".repeat(80)}`;
  const tools = buildLangChainMcpTools({
    serverName: "test-server",
    mcpTools: [
      { name: "weather.search_local" },
      { name: "weather/search_local" },
      { name: longName },
      { name: `${longName}!` },
    ],
    client: {
      async callTool(payload) {
        calls.push(payload);
        return { content: [{ type: "text", text: "ok" }] };
      },
    },
  });

  const names = tools.map((tool) => tool.name);
  assert.deepEqual(names.slice(0, 2), [
    createNamespacedToolId("mcp", "test-server", "weather.search_local"),
    createNamespacedToolId("mcp", "test-server", "weather/search_local"),
  ]);
  assert.equal(new Set(names).size, 4);
  assert.ok(names.every((name) => /^[a-zA-Z0-9_-]{1,64}$/.test(name)));
  assert.deepEqual(adaptToolsForBinding(tools, { model: "gpt-5.5" }).droppedToolNames, []);

  await runWithToolNameBinding(createToolNameBinding({ tools }), async () => {
    await tools[0].invoke({});
    await tools[1].invoke({});
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    ["weather.search_local", "weather/search_local"],
  );
});
