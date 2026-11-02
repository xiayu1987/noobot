/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { executeToolCall } from "./tool-runner.test-helpers.js";

test("executeToolCall maps schema validation failures to RECOVERABLE_INVALID_INPUT", async () => {
  const { tool: structuredTool } = await import("@langchain/core/tools");
  const schemaTool = structuredTool(async () => "unreachable", {
    name: "demo_schema_tool",
    description: "demo",
    schema: z.object({ query: z.string().min(1) }),
  });
  const result = await executeToolCall({
    call: { id: "call-schema-invalid", name: "demo_schema_tool", args: { query: "" } },
    tool: schemaTool,
    turn: 1,
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "RECOVERABLE_INVALID_INPUT");
  assert.doesNotMatch(payload.error, /did not match expected schema/);
  assert.deepEqual(payload.details.issues, [{ code: "too_small", field: "query" }]);
  assert.equal(result.success, false);
});

test("executeToolCall localizes every schema issue before the tool is invoked", async () => {
  const { tool: structuredTool } = await import("@langchain/core/tools");
  let invoked = false;
  const schemaTool = structuredTool(
    async () => {
      invoked = true;
      return "unreachable";
    },
    {
      name: "demo_schema_tool",
      description: "demo",
      schema: z.strictObject({
        query: z.string(),
        riskLevel: z.enum(["low", "high"]),
        maxLines: z.number(),
      }),
    },
  );
  const result = await executeToolCall({
    call: {
      id: "call-schema-issues",
      name: "demo_schema_tool",
      args: { riskLevel: "none", maxLines: "x", extra: 1 },
    },
    tool: schemaTool,
    turn: 1,
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(invoked, false);
  assert.equal(payload.code, "RECOVERABLE_INVALID_INPUT");
  assert.deepEqual(payload.details.issues, [
    { code: "invalid_type", field: "query" },
    { code: "invalid_value", field: "riskLevel" },
    { code: "invalid_type", field: "maxLines" },
    { code: "unrecognized_keys", field: "input", keys: ["extra"] },
  ]);
  assert.deepEqual(payload.error.split("\n"), [
    "必须提供 query",
    'riskLevel 只能是："low", "high"',
    "maxLines 类型应为 number",
    "不支持的字段：extra",
  ]);
});

test("executeToolCall reports a missing enum field as required", async () => {
  const { tool: structuredTool } = await import("@langchain/core/tools");
  const schemaTool = structuredTool(async () => "unreachable", {
    name: "demo_schema_tool",
    description: "demo",
    schema: z.strictObject({ riskLevel: z.enum(["low", "high"]) }),
  });
  const result = await executeToolCall({
    call: { id: "call-schema-missing-enum", name: "demo_schema_tool", args: {} },
    tool: schemaTool,
    turn: 1,
  });
  assert.equal(JSON.parse(result.toolResultText).error, "必须提供 riskLevel");
});
