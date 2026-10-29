/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { toJsonSchema } from "@langchain/core/utils/json_schema";

import { projectToolsForModel } from "../../src/models/tool/model-tool-definition.js";

function createSchema() {
  return z.object({
    command: z.string().describe("shell command"),
    includeLineNumbers: z.boolean().optional().default(false),
    maxLines: z.number().int().default(1000),
    nested: z.object({ x: z.number() }),
    items: z.array(z.object({ y: z.string() })).optional(),
    loose: z.looseObject({ k: z.string() }).optional(),
  });
}

function createTool(schema = createSchema()) {
  return { name: "execute_script", description: "run command", schema };
}

test("projectToolsForModel: default fields are optional for the model", () => {
  const [projected] = projectToolsForModel([createTool()]);
  assert.equal(projected.type, "function");
  assert.equal(projected.function.name, "execute_script");
  assert.equal(projected.function.description, "run command");
  assert.deepEqual(projected.function.parameters.required, ["command", "nested"]);
});

test("projectToolsForModel: differs from langchain export only in required", () => {
  const schema = createSchema();
  const [projected] = projectToolsForModel([createTool(schema)]);
  const { required: projectedRequired, ...projectedRest } = projected.function.parameters;
  const { required: langchainRequired, ...langchainRest } = toJsonSchema(schema);
  assert.deepEqual(projectedRest, langchainRest);
  assert.ok(langchainRequired.includes("includeLineNumbers"));
  assert.ok(!projectedRequired.includes("includeLineNumbers"));
  assert.ok(!projectedRequired.includes("maxLines"));
});

test("projectToolsForModel: strip objects closed, loose objects keep catchall", () => {
  const [projected] = projectToolsForModel([createTool()]);
  const { properties, additionalProperties } = projected.function.parameters;
  assert.equal(additionalProperties, false);
  assert.equal(properties.nested.additionalProperties, false);
  assert.equal(properties.items.items.additionalProperties, false);
  assert.deepEqual(properties.loose.additionalProperties, {});
});

test("projectToolsForModel: strict binding passes tools through unchanged", () => {
  const tools = [createTool()];
  assert.equal(projectToolsForModel(tools, { strict: true }), tools);
});

test("projectToolsForModel: non-zod tools pass through unchanged", () => {
  const jsonSchemaTool = {
    type: "function",
    function: { name: "raw", parameters: { type: "object", properties: {} } },
  };
  const builtinTool = { type: "web_search" };
  const [first, second] = projectToolsForModel([jsonSchemaTool, builtinTool]);
  assert.equal(first, jsonSchemaTool);
  assert.equal(second, builtinTool);
});

test("projectToolsForModel: same schema reference reuses exported parameters", () => {
  const schema = createSchema();
  const [first] = projectToolsForModel([createTool(schema)]);
  const [second] = projectToolsForModel([createTool(schema)]);
  assert.equal(first.function.parameters, second.function.parameters);
});
