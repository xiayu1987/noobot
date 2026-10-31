/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";

import {
  MCP_TOOL_RESULT_ERROR,
  buildLangChainMcpTools,
  normalizeMcpInputSchema,
  normalizeMcpToolCallArgs,
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

  const result = await tools[0].invoke({
    date: "2026-06-07",
    fromStation: "BJP",
    toStation: "SHH",
  });
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

test("MCP tool adapter normalizes schemas and args defensively", () => {
  assert.deepEqual(normalizeMcpInputSchema({}), { type: "object", properties: {} });
  assert.deepEqual(normalizeMcpInputSchema({ properties: { citys: { type: "string" } } }), {
    type: "object",
    properties: { citys: { type: "string" } },
  });
  assert.deepEqual(normalizeMcpToolCallArgs('{"citys":"北京,上海"}'), {
    citys: "北京,上海",
  });
  assert.deepEqual(normalizeMcpToolCallArgs({ citys: "北京", empty: undefined }), {
    citys: "北京",
  });
});

test("MCP tool adapter binds dotted tool names and calls with the original name", async () => {
  const { adaptToolsForBinding } = await import("../../../src/models/tool/binding-adapter.js");
  const calls = [];
  const longName = `ns.${"x".repeat(80)}`;
  const tools = buildLangChainMcpTools({
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
  assert.deepEqual(names.slice(0, 2), ["weather_search_local", "weather_search_local_2"]);
  assert.equal(names[2].length, 64);
  assert.equal(names[3].length, 64);
  assert.ok(names[3].endsWith("_2"));
  assert.deepEqual(adaptToolsForBinding(tools, { model: "gpt-5.5" }).droppedToolNames, []);

  await tools[0].invoke({});
  await tools[1].invoke({});
  assert.deepEqual(
    calls.map((call) => call.name),
    ["weather.search_local", "weather/search_local"],
  );
});
