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
