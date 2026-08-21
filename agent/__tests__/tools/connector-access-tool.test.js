/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorAccessTool } from "../../src/tools/connectors/connector-access-tool.js";

const accesses = [];
const connectorAccess = {
  access: async ({ request }) => {
    accesses.push(request);
    return { ok: true, output: { echoed: request.input.command } };
  },
  listUserConnectors: async () => [],
};

function createScope(selectedConnectorIds = ["con_selected"]) {
  return {
    userId: "u1",
    bindings: {
      runtime: {
        userId: "u1",
        globalConfig: {},
        userConfig: {},
        sharedTools: { connectorAccess },
        systemRuntime: { sessionId: "s1", config: { selectedConnectorIds } },
      },
    },
  };
}

test("Agent exposes only the direct generic connector access tool", () => {
  assert.deepEqual(
    createConnectorAccessTool({ agentContext: createScope() }).map((tool) => tool.name),
    ["access_connector"],
  );
});

test("access_connector requires an explicitly selected connector id", async () => {
  const tool = createConnectorAccessTool({ agentContext: createScope() })[0];
  await assert.rejects(
    () => tool.invoke({ connector_id: "con_other", operation: "execute", input: {} }),
    /not selected/,
  );
});

test("access_connector delegates the generic operation through the protocol port", async () => {
  const tool = createConnectorAccessTool({ agentContext: createScope() })[0];
  const result = JSON.parse(
    await tool.invoke({
      connector_id: "con_selected",
      operation: "execute",
      input: { command: "SELECT 1" },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.output.echoed, "SELECT 1");
  assert.equal(accesses.length, 1);
});
