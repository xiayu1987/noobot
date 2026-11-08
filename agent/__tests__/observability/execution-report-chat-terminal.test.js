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
const model = {
  model: "gpt-test",
  operatorId: "openai",
  adapterId: "openai-compatible",
  base_url: "https://provider.test/v1",
  use_responses_api: false,
  modelFamily: "gpt",
  reasoning_effort: "none",
  reasoning_effort_options: ["none"],
  reasoning_effort_parameter: "reasoning_effort",
};

for (const tools of [false, true]) {
  for (const finished of [false, true]) {
    for (const done of [false, true]) {
      for (const bytewise of [false, true]) {
        test(`Chat terminal tools=${tools} finish=${finished} done=${done} bytewise=${bytewise} agrees with report`, async () => {
          const logs = [];
          const outputTokens = bytewise ? 0 : 7;
          const delta = tools
            ? {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_test",
                    type: "function",
                    function: { name: "lookup", arguments: '{"query":"test"}' },
                  },
                ],
              }
            : { role: "assistant", content: "你好" };
          const frames = [
            { choices: [{ index: 0, delta, finish_reason: null }] },
            ...(finished
              ? [
                  {
                    choices: [
                      { index: 0, delta: {}, finish_reason: tools ? "tool_calls" : "stop" },
                    ],
                  },
                ]
              : []),
            {
              choices: [],
              usage: {
                prompt_tokens: 35,
                completion_tokens: outputTokens,
                prompt_tokens_details: { cached_tokens: 20 },
              },
            },
          ];
          const wire =
            frames
              .map(
                (event) =>
                  `data: ${JSON.stringify({ id: "chat_test", object: "chat.completion.chunk", model: "gpt-test", ...event })}\n\n`,
              )
              .join("") + (done ? "data: [DONE]\n\n" : "");
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
                const bytes = new TextEncoder().encode(wire);
                return new Response(
                  new ReadableStream({
                    start(controller) {
                      if (bytewise)
                        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
                      else controller.enqueue(bytes);
                      controller.close();
                    },
                  }),
                  { headers: { "content-type": "text/event-stream" } },
                );
              },
            },
          });
          const promise = executor.invoke({
            invocation,
            model,
            messages: [{ role: "user", content: "hello" }],
            ...(tools
              ? {
                  tools: [
                    {
                      type: "function",
                      function: {
                        name: "lookup",
                        description: "lookup",
                        parameters: {
                          type: "object",
                          properties: { query: { type: "string" } },
                          required: ["query"],
                        },
                      },
                    },
                  ],
                }
              : {}),
            options: { streaming: true },
            policies: { retry: { transport: { maxAttempts: 1 } } },
          });
          const success = finished && done;
          if (success) {
            const output = await promise;
            assert.ok(output);
          } else await assert.rejects(promise);
          const starts = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.STARTED);
          const usages = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.USAGE);
          const terminals = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.FINISHED);
          const count = success ? 1 : 2;
          assert.equal(starts.length, count);
          assert.equal(usages.length, count);
          assert.equal(terminals.length, count);
          assert.ok(
            terminals.every(({ data }) => data.status === (success ? "completed" : "failed")),
          );
          assert.equal(terminals[0].data.status, success ? "completed" : "failed");
          assert.equal(usages[0].data.measurementError, null);
          assert.deepEqual(usages[0].data.usage.inputTokens, { state: "reported", value: 35 });
          assert.deepEqual(
            usages[0].data.usage.outputTokens,
            success
              ? { state: "reported", value: outputTokens }
              : { state: "unavailable", reason: "stream_interrupted" },
          );
          const { requests, usage } = summarizeExecutionMetrics(logs).model.measurements;
          assert.equal(requests.completedCount, success ? 1 : 0);
          assert.equal(requests.failedCount, success ? 0 : count);
          assert.equal(requests.unfinishedCount, 0);
          assert.equal(usage.tokens.sampleCount, success ? 1 : 0);
          assert.equal(usage.tokens.outputTokensSum, success ? outputTokens : 0);
          assert.equal(usage.cacheRead.cacheReadInputTokensSum, 20);
        });
      }
    }
  }
}
