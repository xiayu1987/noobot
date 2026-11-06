/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMcpAgentTools, executeMcpTask } from "../../../src/integrations/mcp/task-runner.js";
import { StreamableHttpMcpClient } from "../../../src/integrations/mcp/clients/streamable-http.js";
import { createTestModelHost } from "../../helpers/test-model-host.js";
import { TEST_RUN_PREFERENCES } from "../../helpers/run-preferences.js";

const config = {
  mcpServers: {
    fake: { type: "streamableHttp", baseUrl: "https://mcp.example.test/rpc", isActive: true },
  },
};
const toolSpec = { name: "lookup", inputSchema: { type: "object", properties: {} } };

function mockClient(t, tools = [toolSpec]) {
  t.mock.method(StreamableHttpMcpClient.prototype, "initialize", async () => {});
  t.mock.method(StreamableHttpMcpClient.prototype, "listTools", async () => tools);
  return t.mock.method(StreamableHttpMcpClient.prototype, "close", async () => {});
}

for (const stage of ["initialize", "listTools", "adaptTools"]) {
  test(`MCP toolset creation releases the client when ${stage} fails`, async (t) => {
    const close = mockClient(t, stage === "adaptTools" ? [toolSpec, toolSpec] : [toolSpec]);
    const failure = new Error(`failed ${stage}`);
    if (stage !== "adaptTools") {
      t.mock.method(StreamableHttpMcpClient.prototype, stage, async () => {
        throw failure;
      });
    }
    await assert.rejects(
      () => createMcpAgentTools({ globalConfig: config, mcpName: "fake" }),
      stage === "adaptTools" ? /duplicate/ : (error) => error === failure,
    );
    assert.equal(close.mock.callCount(), 1);
  });
}

test("MCP creation reports both initialization and cleanup failures", async (t) => {
  mockClient(t);
  const failure = new Error("initialize failed");
  const cleanupFailure = new Error("close failed");
  t.mock.method(StreamableHttpMcpClient.prototype, "initialize", async () => {
    throw failure;
  });
  t.mock.method(StreamableHttpMcpClient.prototype, "close", async () => {
    throw cleanupFailure;
  });
  await assert.rejects(
    () => createMcpAgentTools({ globalConfig: config, mcpName: "fake" }),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === failure &&
      error.errors[1] === cleanupFailure,
  );
});

for (const outcome of ["empty", "success", "modelFailure", "abort", "turnLimit", "bothFail"]) {
  test(`MCP task releases the client on ${outcome}`, async (t) => {
    const close = mockClient(t, outcome === "empty" ? [] : [toolSpec]);
    const controller = new AbortController();
    const failure = new Error("model failed");
    const cleanupFailure = new Error("close failed");
    if (outcome === "bothFail") {
      close.mock.mockImplementation(async () => {
        throw cleanupFailure;
      });
    }
    let calls = 0;
    const modelPort = {
      async invoke() {
        calls += 1;
        if (outcome === "modelFailure" || outcome === "bothFail") throw failure;
        if (outcome === "abort") {
          controller.abort();
          controller.signal.throwIfAborted();
        }
        return {
          output: {
            text: "done",
            toolCalls:
              outcome === "turnLimit" ? [{ id: `call-${calls}`, name: "unknown", args: {} }] : [],
          },
        };
      },
    };
    const run = () =>
      executeMcpTask({
        globalConfig: config,
        mcpName: "fake",
        task: "do it",
        signal: controller.signal,
        runtime: {
          runConfig: { ...TEST_RUN_PREFERENCES },
          modelHost: createTestModelHost({
            modelPort,
            modelSpec: { model: "test", adapterId: "openai-compatible" },
          }),
        },
      });
    if (outcome === "bothFail") {
      await assert.rejects(
        run,
        (error) =>
          error instanceof AggregateError &&
          error.errors[0] === failure &&
          error.errors[1] === cleanupFailure,
      );
    } else if (outcome === "modelFailure") await assert.rejects(run, (error) => error === failure);
    else if (outcome === "abort") await assert.rejects(run, { name: "AbortError" });
    else assert.equal((await run()).ok, true);
    assert.equal(close.mock.callCount(), 1);
    if (outcome === "empty") assert.equal(calls, 0);
  });
}

test("MCP task surfaces cleanup failure", async (t) => {
  mockClient(t, []);
  const failure = new Error("close failed");
  t.mock.method(StreamableHttpMcpClient.prototype, "close", async () => {
    throw failure;
  });
  await assert.rejects(
    () => executeMcpTask({ globalConfig: config, mcpName: "fake", task: "do it" }),
    (error) => error === failure,
  );
});
