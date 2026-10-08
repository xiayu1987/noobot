/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SseMcpClient } from "../../../src/integrations/mcp/clients/sse.js";

function sseResponse(text) {
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("sse client resolves a CRLF-framed endpoint event", async () => {
  const client = new SseMcpClient({
    baseUrl: "https://mcp.example.test/api/sse",
    fetchImpl: async () => sseResponse("event: endpoint\r\ndata: /messages?s=1\r\n\r\n"),
  });
  await client.connect();
  assert.equal(client.messageUrl, "https://mcp.example.test/messages?s=1");
});

test("sse client reports a stream that ends before the endpoint event", async () => {
  const client = new SseMcpClient({
    baseUrl: "https://mcp.example.test/api/sse",
    fetchImpl: async () => sseResponse(""),
  });
  await assert.rejects(client.connect(), { code: "RECOVERABLE_MCP_SSE_ENDPOINT_MISSING" });
});
