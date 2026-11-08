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
  reasoning_effort: "none",
  reasoning_effort_options: ["none"],
  reasoning_effort_parameter: "reasoning_effort",
};

function completion(finishReason, tools) {
  return {
    id: "chat_test",
    object: "chat.completion",
    model: "gpt-test",
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: tools
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_test",
                  type: "function",
                  function: { name: "lookup", arguments: '{"query":"test"}' },
                },
              ],
            }
          : { role: "assistant", content: "partial" },
      },
    ],
    usage: { prompt_tokens: 35, completion_tokens: 0 },
  };
}

function executorFor(fetchImpl, logs) {
  return createModelRequestExecutor({
    credentialPort: { resolve: () => "test-key" },
    observationPort: { emit: (event, data) => logs.push({ event, data }) },
    providerRuntime: { fetchImpl },
  });
}

function invoke(executor, streaming, tools = false) {
  return executor.invoke({
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
    options: { streaming },
    policies: { retry: { transport: { maxAttempts: 1 } } },
  });
}

function assertFailedReport(logs, count) {
  const starts = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.STARTED);
  const terminals = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.FINISHED);
  assert.equal(starts.length, count);
  assert.equal(terminals.length, count);
  assert.ok(terminals.every(({ data }) => data.status === "failed"));
  const { requests, usage } = summarizeExecutionMetrics(logs).model.measurements;
  assert.equal(requests.completedCount, 0);
  assert.equal(requests.failedCount, count);
  assert.equal(requests.unfinishedCount, 0);
  assert.equal(usage.tokens.sampleCount, 0);
}

for (const tools of [false, true]) {
  for (const finishReason of [undefined, null, "", " ", 7, tools ? "tool_calls" : "stop"]) {
    test(`Chat body finish=${String(finishReason)} tools=${tools} agrees with report`, async () => {
      const logs = [];
      const executor = executorFor(
        async (_url, init) =>
          JSON.parse(init.body).stream
            ? new Response("data: [DONE]\n\n", {
                headers: { "content-type": "text/event-stream" },
              })
            : Response.json(completion(finishReason, tools)),
        logs,
      );
      const call = invoke(executor, false, tools);
      if (typeof finishReason === "string" && finishReason.trim()) {
        assert.ok(await call);
        const { requests, usage } = summarizeExecutionMetrics(logs).model.measurements;
        assert.equal(requests.completedCount, 1);
        assert.equal(requests.failedCount, 0);
        assert.equal(usage.tokens.sampleCount, 1);
        assert.equal(usage.tokens.outputTokensSum, 0);
      } else {
        await assert.rejects(call, /Chat stream requires finish_reason/);
        const firstUsage = logs.find(({ event }) => event === MODEL_REQUEST_EVENT.USAGE).data;
        assert.match(firstUsage.measurementError, /Chat response requires finish_reason/);
        assertFailedReport(logs, 2);
      }
    });
  }
}

test("switching Chat response mode cannot bypass the protocol completion requirement", async () => {
  const logs = [];
  const modes = [];
  const executor = executorFor(async (_url, init) => {
    const streaming = JSON.parse(init.body).stream === true;
    modes.push(streaming);
    return streaming
      ? new Response(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        )
      : Response.json(completion(null, false));
  }, logs);
  await assert.rejects(invoke(executor, true), /Chat response requires finish_reason/);
  assert.deepEqual(modes, [true, false]);
  assertFailedReport(logs, 2);
});

for (const invalid of ["{invalid", "null", '{"choices":[{"index":-1}]}']) {
  for (const chunking of ["single", "frames", "bytes"]) {
    test(`malformed Chat ${invalid} chunking=${chunking} cannot be overwritten by completion`, async () => {
      const logs = [];
      const frames = [
        `data: ${invalid}\n\n`,
        `data: ${JSON.stringify({ id: "chat_test", choices: [{ index: 0, delta: { content: "partial" }, finish_reason: "stop" }] })}\n\n`,
        "data: [DONE]\n\n",
      ];
      const encoder = new TextEncoder();
      const executor = executorFor(async (_url, init) => {
        if (!JSON.parse(init.body).stream) return Response.json(completion(null, false));
        const chunks =
          chunking === "frames"
            ? frames.map((frame) => encoder.encode(frame))
            : [encoder.encode(frames.join(""))];
        return new Response(
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks) {
                if (chunking === "bytes")
                  for (const byte of chunk) controller.enqueue(Uint8Array.of(byte));
                else controller.enqueue(chunk);
              }
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }, logs);
      await assert.rejects(invoke(executor, true));
      const count = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.STARTED).length;
      assertFailedReport(logs, count);
      const firstUsage = logs.find(({ event }) => event === MODEL_REQUEST_EVENT.USAGE).data;
      assert.equal(firstUsage.usage, null);
      assert.ok(firstUsage.measurementError);
    });
  }
}
