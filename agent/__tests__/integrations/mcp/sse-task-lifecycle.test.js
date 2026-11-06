/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { executeMcpTask } from "../../../src/integrations/mcp/task-runner.js";
import { createTestModelHost } from "../../helpers/test-model-host.js";
import { TEST_RUN_PREFERENCES } from "../../helpers/run-preferences.js";

function createSseTransport(outcome) {
  let stream;
  let streamSignal;
  const encoder = new TextEncoder();
  const send = (event, payload) =>
    stream.enqueue(encoder.encode(`event: ${event}\ndata: ${payload}\n\n`));
  return {
    get signal() {
      return streamSignal;
    },
    async fetch(_url, options) {
      if (options.method === "GET") {
        streamSignal = options.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              stream = controller;
              streamSignal.addEventListener("abort", () => controller.error(streamSignal.reason), {
                once: true,
              });
              send("endpoint", "/messages");
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      const request = JSON.parse(options.body);
      if (request.id !== undefined) {
        const tool = { name: "lookup", inputSchema: { type: "object", properties: {} } };
        const result =
          request.method === "tools/list"
            ? { tools: outcome === "empty" ? [] : [tool] }
            : { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fake" } };
        send(
          "message",
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            ...(outcome === "discoveryFailure" && request.method === "tools/list"
              ? { error: { code: -32603, message: "discovery failed" } }
              : { result }),
          }),
        );
      }
      return new Response(null, { status: 202 });
    },
  };
}

for (const outcome of ["empty", "success", "abort", "discoveryFailure"]) {
  test(`SSE MCP task closes its stream and removes the caller abort listener on ${outcome}`, async () => {
    const transport = createSseTransport(outcome);
    const caller = new AbortController();
    const modelPort = {
      async invoke() {
        if (outcome === "abort") {
          caller.abort();
          caller.signal.throwIfAborted();
        }
        return { output: { text: "done", toolCalls: [] } };
      },
    };
    const run = () =>
      executeMcpTask({
        globalConfig: {
          mcpServers: {
            fake: { type: "sse", baseUrl: "https://mcp.example.test/sse", isActive: true },
          },
        },
        mcpName: "fake",
        task: "do it",
        signal: caller.signal,
        fetchImpl: transport.fetch,
        runtime: {
          runConfig: { ...TEST_RUN_PREFERENCES },
          modelHost: createTestModelHost({
            modelPort,
            modelSpec: { model: "test", adapterId: "openai-compatible" },
          }),
        },
      });
    if (outcome === "abort") await assert.rejects(run, { name: "AbortError" });
    else if (outcome === "discoveryFailure") await assert.rejects(run, /discovery failed/);
    else assert.equal((await run()).ok, true);
    assert.equal(transport.signal.aborted, true);
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  });
}
