/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "../src/index.js";
import { invocation } from "./runtime-fixtures.js";

function sse(events) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

for (const [label, delta, calls] of [
  ["empty role", { role: "assistant", content: "" }, 2],
  ["text", { content: "hello" }, 1],
  ["reasoning", { reasoning_content: "think" }, 1],
  [
    "tool",
    {
      tool_calls: [
        { index: 0, id: "call-1", type: "function", function: { name: "run", arguments: "" } },
      ],
    },
    1,
  ],
]) {
  test(`real Chat adapter ${label} followed by server_error sends ${calls} requests`, async () => {
    const requests = [];
    const events = [];
    const executor = createModelRequestExecutor({
      credentialPort: { resolve: () => "test-key" },
      clock: { now: () => 0, sleep: async () => {} },
      observationPort: { emit: (type) => events.push(type) },
      providerRuntime: {
        fetchImpl: async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return sse([
            { id: "chat-1", choices: [{ index: 0, delta, finish_reason: null }] },
            { error: { code: "server_error", message: "stream failed" } },
          ]);
        },
      },
    });
    await assert.rejects(
      executor.invoke({
        invocation,
        model: {
          model: "gpt-test",
          operatorId: "openai",
          base_url: "https://provider.test/v1",
          use_responses_api: false,
          reasoning_effort: "none",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none"],
        },
        messages: [{ role: "user", content: "hello" }],
        options: { streaming: true },
        policies: { retry: { maxTotalAttempts: 3, transport: { maxAttempts: 2, baseDelayMs: 0 } } },
      }),
      /stream failed/,
    );
    assert.equal(requests.length, calls);
    assert.ok(requests.every((request) => request.stream === true));
    assert.equal(events.filter((type) => type === "model.invocation.failed").length, 1);
    assert.equal(events.filter((type) => type === "model.request.finished").length, calls);
  });
}
