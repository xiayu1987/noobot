/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isZodSchemaV4 } from "@langchain/core/utils/types";

import { buildTools } from "../../src/tools/index.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { projectToolsForModel } from "../../src/models/tool/model-tool-definition.js";
import { TOOL_NAME } from "../../src/tools/constants/index.js";

const ROOT_COMPOSITION_KEYWORDS = ["oneOf", "anyOf", "allOf", "not", "if", "then", "else"];

function collectStripObjectPaths(schema, path = "$", seen = new Set(), out = []) {
  if (!schema?._zod || seen.has(schema)) return out;
  seen.add(schema);
  const def = schema._zod.def;
  if (def.type === "object" && def.catchall === undefined) out.push(path);
  for (const [key, value] of Object.entries(def)) {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item, index) => {
      const childPath = Array.isArray(value) ? `${path}.${key}[${index}]` : `${path}.${key}`;
      if (item?._zod) collectStripObjectPaths(item, childPath, seen, out);
    });
    if (key === "shape") {
      for (const [field, child] of Object.entries(value)) {
        collectStripObjectPaths(child, `${path}.${field}`, seen, out);
      }
    }
  }
  return out;
}

test("tool schemas reject unknown fields at every object level", async () => {
  const tools = await buildTools({
    agentContext: createTestAgentExecutionScope(
      createTestRuntimeContext({
        basePath: "/tmp/noobot-test-workspace",
        identity: { sessionId: "s-1" },
        systemRuntime: { persistenceScope: null, config: { allowUserInteraction: true } },
      }),
    ),
  });
  const zodTools = tools.filter((tool) => isZodSchemaV4(tool?.schema));
  assert.ok(zodTools.length > 0);
  const violations = zodTools.flatMap((tool) =>
    collectStripObjectPaths(tool.schema).map((path) => `${tool.name}:${path}`),
  );
  assert.deepEqual(violations, []);
});

test("tool schema rejects unknown top-level field", async () => {
  const tools = await buildTools({
    agentContext: createTestAgentExecutionScope(
      createTestRuntimeContext({
        basePath: "/tmp/noobot-test-workspace",
        identity: { sessionId: "s-1" },
        systemRuntime: { persistenceScope: null, config: {} },
      }),
    ),
  });
  const readFile = tools.find((tool) => tool.name === "read_file");
  const result = readFile.schema.safeParse({
    filePath: "a.txt",
    riskLevel: "low",
    includeLineNumbers: true,
  });
  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].code, "unrecognized_keys");
});

test("tool definitions sent to models are plain root objects", async () => {
  const provider = {
    enabled: true,
    model: "test-model",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none"],
  };
  const tools = await buildTools({
    agentContext: createTestAgentExecutionScope(
      createTestRuntimeContext({
        basePath: "/tmp/noobot-test-workspace",
        identity: { sessionId: "s-1" },
        globalConfig: {
          security: { executionIsolation: { mode: "host" } },
          tools: { [TOOL_NAME.EXECUTE_NATIVE_SCRIPT]: { enabled: true } },
          providers: {
            parse_model: {
              ...provider,
              multimodal_parsing: { enabled: true, input_modalities: ["image"] },
            },
            image_model: {
              ...provider,
              multimodal_generation: {
                api_type: "openai_images",
                support_generation: { enabled: true, support_scope: ["image"] },
              },
            },
          },
        },
        systemRuntime: {
          persistenceScope: null,
          isSuperUser: true,
          config: { allowUserInteraction: true },
        },
      }),
    ),
  });
  const names = tools.map((tool) => tool.name);
  for (const name of Object.values(TOOL_NAME)) assert.ok(names.includes(name), name);
  const violations = projectToolsForModel(tools).flatMap(({ function: definition }) => {
    const { parameters } = definition;
    const keywords = ROOT_COMPOSITION_KEYWORDS.filter((keyword) => keyword in parameters);
    return parameters.type === "object" && keywords.length === 0
      ? []
      : [`${definition.name}: type=${parameters.type} ${keywords.join(",")}`];
  });
  assert.deepEqual(violations, []);
});
