/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import { MODEL_CONTEXT_SEQUENCE_POLICY, MODEL_REQUEST_EVENT } from "@noobot/model-protocol";
import { summarizeExecutionMetrics } from "../../src/observability/execution-log/execution-report-metrics.js";

const invocation = {
  requestId: "request",
  invocationId: "invocation",
  sessionId: "session",
  parentSessionId: "",
  dialogProcessId: "dialog",
  turnScopeId: "turn",
  runId: "run",
  flow: "test",
  purpose: "test",
  domain: "test",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
};
const anthropicStart = {
  type: "message_start",
  message: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [],
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 5,
      output_tokens: 0,
    },
  },
};

for (const type of ["response.incomplete", "response.failed", "error"]) {
  test(`${type} propagates failure from real adapter through request measurements into report`, async () => {
    const anthropic = type === "error";
    const frames = anthropic
      ? [
          anthropicStart,
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
          { type: "error", error: { type: "overloaded_error", message: "server busy" } },
        ]
      : [
          {
            type,
            response: {
              id: "resp_test",
              status: type.slice("response.".length),
              incomplete_details: { reason: "max_output_tokens" },
              error: { code: "server_error", message: "server busy" },
              usage: {
                input_tokens: 35,
                output_tokens: 7,
                input_tokens_details: { cached_tokens: 20 },
              },
            },
          },
        ];
    const logs = [];
    const executor = createModelRequestExecutor({
      credentialPort: { resolve: () => "test-key" },
      observationPort: { emit: (event, data) => logs.push({ event, data }) },
      providerRuntime: {
        fetchImpl: async (_url, init) => {
          if (!JSON.parse(init.body).stream)
            return Response.json(
              { error: { message: "invalid API key", type: "authentication_error" } },
              { status: 401 },
            );
          return new Response(
            frames
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
          model: anthropic ? "claude-test" : "gpt-test",
          operatorId: anthropic ? "anthropic" : "openai",
          adapterId: anthropic ? "anthropic-messages" : "openai-compatible",
          base_url: "https://provider.test/v1",
          capabilities: { web_search: true },
          modelFamily: anthropic ? "claude" : "gpt",
          reasoning_effort: "none",
          reasoning_effort_options: ["none"],
          reasoning_effort_parameter: "reasoning_effort",
        },
        messages: [{ role: "user", content: "hello" }],
        ...(anthropic ? {} : { operation: { kind: "web_search", input: { query: "test" } } }),
        options: { streaming: true, callbacks: [{ handleLLMNewToken() {} }] },
        policies: { retry: { transport: { maxAttempts: 1 } } },
      }),
    );
    const usages = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.USAGE);
    const terminals = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.FINISHED);
    assert.equal(usages[0].data.measurementError, null);
    assert.deepEqual(usages[0].data.usage.inputTokens, { state: "reported", value: 35 });
    assert.deepEqual(
      usages[0].data.usage.outputTokens,
      anthropic
        ? { state: "unavailable", reason: "stream_interrupted" }
        : { state: "reported", value: 7 },
    );
    assert.ok(terminals.length > 0);
    assert.ok(terminals.every(({ data }) => data.status === "failed"));
    const { requests, usage } = summarizeExecutionMetrics(logs).model.measurements;
    assert.equal(requests.completedCount, 0);
    assert.equal(requests.failedCount, requests.startedCount);
    assert.equal(requests.unfinishedCount, 0);
    assert.equal(usage.tokens.sampleCount, anthropic ? 0 : 1);
    assert.equal(usage.tokens.outputTokensSum, anthropic ? 0 : 7);
    assert.equal(usage.cacheRead.cacheReadInputTokensSum, 20);
    if (anthropic) {
      assert.equal(requests.startedCount, 1);
      assert.equal(usage.tokens.unavailableReasons.stream_interrupted, 1);
      assert.equal(usage.cacheWrite.cacheWriteInputTokensSum, 5);
    }
  });
}
