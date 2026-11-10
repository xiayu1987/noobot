/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_REQUEST_EVENT,
  requireModelResponseTerminal,
  resolveModelStreamTerminal,
} from "@noobot/model-protocol";
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
  use_responses_api: true,
  capabilities: { web_search: true, multimodal_parse: true },
  modelFamily: "gpt",
  reasoning_effort: "none",
  reasoning_effort_options: ["none"],
  reasoning_effort_parameter: "reasoning_effort",
};

function responseBody(status, outputTokens) {
  return {
    id: "resp_test",
    object: "response",
    status,
    model: "gpt-test",
    incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
    error: status === "failed" ? { code: "server_error", message: "server busy" } : null,
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "result", annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 35,
      output_tokens: outputTokens,
      input_tokens_details: { cached_tokens: 20 },
    },
  };
}

async function invokeResponse({ status, outputTokens, streaming, operation }) {
  const logs = [];
  const executor = createModelRequestExecutor({
    credentialPort: { resolve: () => "test-key" },
    observationPort: { emit: (event, data) => logs.push({ event, data }) },
    providerRuntime: {
      fetchImpl: async (_url, init) => {
        const requestedStreaming = JSON.parse(init.body).stream;
        const body = responseBody(status, outputTokens);
        if (!requestedStreaming) return Response.json(body);
        const events = [
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { ...body.output[0], content: [] },
          },
          {
            type: "response.content_part.added",
            output_index: 0,
            content_index: 0,
            item_id: "msg_test",
            part: { type: "output_text", text: "", annotations: [] },
          },
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            item_id: "msg_test",
            delta: "result",
          },
          { type: `response.${status}`, response: body },
        ];
        return new Response(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(""),
          {
            headers: { "content-type": "text/event-stream" },
          },
        );
      },
    },
  });
  const promise = executor.invoke({
    invocation,
    model,
    messages: [{ role: "user", content: "hello" }],
    operation,
    options: { streaming },
    policies: { retry: { transport: { maxAttempts: 1 } } },
  });
  if (status === "completed") await promise;
  else await assert.rejects(promise);
  return logs;
}

const operations = [
  { name: "chat", operation: undefined },
  { name: "web search", operation: { kind: "web_search", input: { query: "test" } } },
  {
    name: "multimodal parse",
    operation: {
      kind: "multimodal_parse",
      input: {
        prompt: "read",
        attachments: [{ data: "data:image/png;base64,AQ==", mimeType: "image/png" }],
      },
    },
  },
];
const cases = operations.flatMap(({ name, operation }) =>
  ["completed", "incomplete", "failed"].flatMap((status) =>
    [0, 7].map((outputTokens) => ({ name, operation, status, outputTokens })),
  ),
);

for (const scenario of cases) {
  test(`Responses ${scenario.name} ${scenario.status} output=${scenario.outputTokens} has matching body/stream report semantics`, async () => {
    const { status, outputTokens } = scenario;
    const response = responseBody(status, outputTokens);
    assert.equal(
      requireModelResponseTerminal("responses", response),
      resolveModelStreamTerminal("responses", { type: `response.${status}`, response }),
    );
    const reports = [];
    for (const streaming of [false, true]) {
      const logs = await invokeResponse({ ...scenario, streaming });
      const terminals = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.FINISHED);
      assert.ok(terminals.length > 0);
      assert.ok(
        terminals.every(
          ({ data }) => data.status === (status === "completed" ? "completed" : "failed"),
        ),
      );
      const measurements = summarizeExecutionMetrics(logs).model.measurements;
      const { requests, usage } = measurements;
      const count = 1;
      assert.equal(requests.startedCount, count);
      assert.equal(requests.completedCount, status === "completed" ? 1 : 0);
      assert.equal(requests.failedCount, status === "completed" ? 0 : count);
      assert.equal(requests.unfinishedCount, 0);
      assert.equal(usage.tokens.sampleCount, count);
      assert.equal(usage.tokens.outputTokensSum, outputTokens * count);
      assert.equal(usage.cacheRead.cacheReadInputTokensSum, 20 * count);
      assert.deepEqual(measurements.measurementErrors, []);
      reports.push({ requests, usage });
    }
    assert.deepEqual(reports[0], reports[1]);
  });
}

for (const status of [undefined, "queued", "in_progress", "cancelled", "unknown"]) {
  test(`Responses rejects nonterminal body status ${status} without counting success`, async () => {
    assert.throws(() => requireModelResponseTerminal("responses", { status }), /terminal status/);
    const logs = await invokeResponse({ status, outputTokens: 7, streaming: false });
    const { requests, measurementErrors } = summarizeExecutionMetrics(logs).model.measurements;
    assert.equal(requests.completedCount, 0);
    assert.equal(requests.failedCount, 1);
    assert.equal(requests.unfinishedCount, 0);
    assert.ok(measurementErrors.some(({ message }) => message.includes("terminal status")));
  });
}
