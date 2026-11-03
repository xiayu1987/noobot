/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createMcpTestHttpServer } from "./server.mjs";
import { StreamableHttpMcpClient } from "../../agent/src/integrations/mcp/clients/streamable-http.js";

test("production MCP client initializes, lists and calls an SDK tool", async (t) => {
  const audit = [];
  const server = createMcpTestHttpServer({ audit: (line) => audit.push(JSON.parse(line)) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new StreamableHttpMcpClient({
    baseUrl: `http://127.0.0.1:${server.address().port}/mcp`,
  });
  await client.initialize();
  const tools = await client.listTools();
  assert.deepEqual(
    tools.map(({ name }) => name),
    ["echo"],
  );
  const result = await client.callTool({ name: "echo", args: { text: "MCP-E2E-VERIFIED" } });
  assert.deepEqual(result.content, [{ type: "text", text: "MCP-E2E-VERIFIED" }]);
  const invalid = await client.callTool({ name: "echo", args: {} });
  assert.equal(invalid.isError, true);
  assert.deepEqual(
    audit.map(({ method }) => method),
    ["initialize", "notifications/initialized", "tools/list", "tools/call", "tools/call"],
  );
});
