import test from "node:test";
import assert from "node:assert/strict";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";

import {
  buildLangChainMcpTools,
  normalizeMcpInputSchema,
  normalizeMcpToolCallArgs,
} from "../../../src/system-core/mcp/tool-adapter.js";

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
  assert.equal(result, "ok");
  assert.deepEqual(calls[0], {
    name: "get-tickets",
    args: {
      date: "2026-06-07",
      fromStation: "BJP",
      toStation: "SHH",
    },
  });
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
