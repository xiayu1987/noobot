/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { StreamableHttpMcpClient } from "../../../src/integrations/mcp/clients/streamable-http.js";

const BASE_URL = "https://mcp.example.test/mcp";

function createClient(respond) {
  return new StreamableHttpMcpClient({
    baseUrl: BASE_URL,
    fetchImpl: async (_url, init) => respond(JSON.parse(init.body)),
  });
}

test("streamable http client reads a JSON response body", async () => {
  const client = createClient(
    (request) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  assert.deepEqual(await client.listTools(), []);
});

test("streamable http client reads the matching JSON-RPC response from an SSE stream", async () => {
  const client = createClient(
    (request) =>
      new Response(
        [
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}\n\n`,
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "probe" }] } })}\n\n`,
        ].join(""),
        { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } },
      ),
  );
  assert.deepEqual(await client.listTools(), [{ name: "probe" }]);
});

test("streamable http client rejects an SSE stream without the matching response", async () => {
  const client = createClient(
    (request) =>
      new Response(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: request.id + 1, result: {} })}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
  );
  await assert.rejects(client.listTools(), { code: "RECOVERABLE_MCP_RESPONSE_MISSING" });
});
