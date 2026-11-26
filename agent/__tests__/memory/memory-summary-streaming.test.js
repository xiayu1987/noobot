/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryManager } from "../../src/memory/index.js";

for (const streaming of [false, true]) {
  test(`memory summary sends turn streaming=${streaming} through the real model port`, async (t) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "memory-wire-"));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const requests = [];
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      if (streaming) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          'data: {"choices":[{"index":0,"delta":{"content":"NO_CHANGES"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        );
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "NO_CHANGES" },
                finish_reason: "stop",
              },
            ],
          }),
        );
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(
      () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    );
    const service = new MemoryManager({
      workspaceRoot,
      defaultProvider: "memory-test",
      providers: {
        "memory-test": {
          alias: "memory-test",
          model: "memory-test",
          providerId: "memory-test",
          adapterId: "openai-compatible",
          api_key: "test-key",
          base_url: `http://127.0.0.1:${server.address().port}/v1`,
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
        },
      },
    });
    service.shortMemory.readItems = async () => [];
    service.experience.runWeeklySummaryIfNeeded = async ({ invokeModel }) => {
      const output = await invokeModel({
        prompt: "summarize",
        flow: "memory.summary",
        purpose: "memory_consolidation",
      });
      assert.equal(output.text, "NO_CHANGES");
    };
    service.experience.runMonthlySummaryIfNeeded = async () => {};
    service.experience.runYearlySummaryIfNeeded = async () => {};
    const errors = [];
    await service.maybeSummarize({
      userId: "wire-test",
      sessionId: "s",
      parentSessionId: "",
      userConfig: {},
      runConfig: { streaming },
      invocationIdentity: { dialogProcessId: "d", turnScopeId: "t", runId: "r" },
      eventListener: { onEvent() {} },
      abortSignal: new AbortController().signal,
      onStageError: (error) => errors.push(error),
    });
    assert.deepEqual(errors, []);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].stream, streaming);
  });
}
