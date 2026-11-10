/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "../src/index.js";
import { invocation } from "./runtime-fixtures.js";

const anthropicStart = {
  type: "message_start",
  message: {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content: [],
    stop_reason: null,
    usage: { input_tokens: 1, output_tokens: 0 },
  },
};
const responseStart = {
  type: "response.created",
  response: {
    id: "resp-1",
    status: "in_progress",
    output: [],
  },
};
const cases = [
  ["responses", "metadata", [responseStart], 2],
  [
    "responses",
    "text",
    [
      responseStart,
      {
        type: "response.output_text.delta",
        item_id: "msg-1",
        output_index: 0,
        content_index: 0,
        delta: "hello",
      },
    ],
    1,
  ],
  [
    "responses",
    "reasoning",
    [
      responseStart,
      {
        type: "response.reasoning_summary_text.delta",
        item_id: "rs-1",
        output_index: 0,
        summary_index: 0,
        delta: "think",
      },
    ],
    1,
  ],
  [
    "responses",
    "tool",
    [
      responseStart,
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc-1",
          call_id: "call-1",
          name: "run",
          arguments: "",
        },
      },
    ],
    1,
  ],
  [
    "anthropic",
    "empty text",
    [
      anthropicStart,
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ],
    2,
  ],
  [
    "anthropic",
    "text",
    [
      anthropicStart,
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
    ],
    1,
  ],
  [
    "anthropic",
    "reasoning",
    [
      anthropicStart,
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "think" },
      },
    ],
    1,
  ],
  [
    "anthropic",
    "tool",
    [
      anthropicStart,
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "call-1", name: "run", input: {} },
      },
    ],
    1,
  ],
];

for (const [format, label, prefix, expected] of cases) {
  test(`${format} ${label} uses transport progress for retry safety`, async () => {
    const requests = [];
    const observed = [];
    const error =
      format === "responses"
        ? { type: "error", code: "server_error", message: "upstream failed" }
        : { type: "error", error: { type: "overloaded_error", message: "upstream failed" } };
    const executor = createModelRequestExecutor({
      credentialPort: { resolve: () => "test-key" },
      observationPort: { emit: (type) => observed.push(type) },
      clock: { now: () => 0, sleep: async () => {} },
      providerRuntime: {
        fetchImpl: async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return new Response(
            [...prefix, error]
              .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
              .join(""),
            {
              headers: { "content-type": "text/event-stream" },
            },
          );
        },
      },
    });
    await assert.rejects(
      executor.invoke({
        invocation,
        model: {
          model: format === "responses" ? "gpt-test" : "claude-test",
          operatorId: format === "responses" ? "openai" : "anthropic",
          modelFamily: format === "responses" ? "gpt" : "claude",
          use_responses_api: format === "responses",
          base_url: "https://provider.test/v1",
          reasoning_effort: "none",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none"],
        },
        messages: [{ role: "user", content: "hello" }],
        options: { streaming: true },
        policies: { retry: { maxTotalAttempts: 3, transport: { maxAttempts: 2, baseDelayMs: 0 } } },
      }),
      /upstream failed/,
    );
    assert.equal(requests.length, expected);
    assert.ok(requests.every((request) => request.stream === true));
    assert.equal(observed.filter((type) => type === "model.invocation.failed").length, 1);
    assert.equal(observed.filter((type) => type === "model.request.finished").length, expected);
  });
}
