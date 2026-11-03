/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { MCP_TEST_SERVICE } from "./config.mjs";

export function createMcpTestHttpServer({ audit = console.log } = {}) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, name: MCP_TEST_SERVICE.name }));
      return;
    }
    if (request.url !== MCP_TEST_SERVICE.path) {
      response.writeHead(404).end();
      return;
    }
    const server = new McpServer({ name: MCP_TEST_SERVICE.name, version: "1.0.0" });
    server.registerTool(
      "echo",
      { description: "Return text unchanged.", inputSchema: { text: z.string() } },
      async ({ text }) => ({ content: [{ type: "text", text }] }),
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      server.close().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    });
    try {
      await server.connect(transport);
      const dispatch = transport.onmessage;
      transport.onmessage = (message, extra) => {
        audit(JSON.stringify({ method: message.method, id: message.id, params: message.params }));
        return dispatch(message, extra);
      };
      await transport.handleRequest(request, response);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
      response.end(String(error.message));
    }
  });
}

if (import.meta.main) {
  const server = createMcpTestHttpServer();
  server.listen(MCP_TEST_SERVICE.port, "0.0.0.0", () => {
    console.log(`MCP test service listening on ${MCP_TEST_SERVICE.port}`);
  });
  process.on("SIGTERM", () => server.close());
}
