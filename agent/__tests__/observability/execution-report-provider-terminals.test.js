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
const usage = {
  input_tokens: 10,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
const start = {
  type: "message_start",
  message: { id: "msg_test", type: "message", role: "assistant", content: [], usage },
};
const block = {
  type: "content_block_start",
  index: 0,
  content_block: { type: "text", text: "partial" },
};
const close = { type: "content_block_stop", index: 0 };
const reason = { type: "message_delta", delta: { stop_reason: "end_turn" }, usage };
const stop = { type: "message_stop" };
const anthropicBody = {
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "partial" }],
  stop_reason: "end_turn",
  usage,
};
const responsesBody = {
  id: "resp_test",
  object: "response",
  status: "completed",
  model: "gpt-test",
  usage,
  output: [
    {
      id: "msg_test",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "partial", annotations: [] }],
    },
  ],
};
const parseOperation = {
  kind: "multimodal_parse",
  input: {
    prompt: "read",
    attachments: [{ data: "data:image/png;base64,AQ==", mimeType: "image/png" }],
  },
};
const responsesPrefix = [
  {
    type: "response.output_item.added",
    output_index: 0,
    item: { ...responsesBody.output[0], content: [] },
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
    delta: "partial",
  },
];

function streamResponse(frames, chunking) {
  const encoder = new TextEncoder();
  const chunks = frames.map((event) =>
    encoder.encode(
      typeof event === "string"
        ? event
        : `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    ),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        if (chunking === "single") controller.enqueue(Buffer.concat(chunks));
        else if (chunking === "frames") for (const chunk of chunks) controller.enqueue(chunk);
        else
          for (const chunk of chunks)
            for (const byte of chunk) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

async function verify({
  anthropic,
  frames,
  body,
  valid = false,
  streaming = true,
  chunking = "single",
  operation,
  expectedError,
  outputTokens = 0,
}) {
  const logs = [];
  const executor = createModelRequestExecutor({
    credentialPort: { resolve: () => "test-key" },
    observationPort: { emit: (event, data) => logs.push({ event, data }) },
    providerRuntime: {
      fetchImpl: async (_url, init) => {
        if (JSON.parse(init.body).stream) return streamResponse(frames, chunking);
        if (body) return Response.json(body);
        return Response.json(
          { error: { message: "invalid API key", type: "authentication_error" } },
          { status: 401 },
        );
      },
    },
  });
  const promise = executor.invoke({
    invocation,
    model: {
      model: anthropic ? "claude-test" : "gpt-test",
      operatorId: anthropic ? "anthropic" : "openai",
      adapterId: anthropic ? "anthropic-messages" : "openai-compatible",
      base_url: "https://provider.test/v1",
      use_responses_api: !anthropic,
      capabilities: { multimodal_parse: true },
      modelFamily: anthropic ? "claude" : "gpt",
      reasoning_effort: "none",
      reasoning_effort_options: ["none"],
      reasoning_effort_parameter: "reasoning_effort",
    },
    messages: [{ role: "user", content: "hello" }],
    operation,
    options: { streaming, callbacks: [{ handleLLMNewToken() {} }] },
    policies: { retry: { transport: { maxAttempts: 1 } } },
  });
  if (valid) await promise;
  else await assert.rejects(promise);
  const terminals = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.FINISHED);
  const starts = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.STARTED);
  assert.ok(starts.length > 0);
  if (valid) assert.equal(starts.length, 1);
  assert.equal(terminals.length, starts.length);
  assert.equal(new Set(terminals.map(({ data }) => data.transportRequestId)).size, starts.length);
  assert.ok(terminals.every(({ data }) => data.status === (valid ? "completed" : "failed")));
  const {
    requests,
    usage: measuredUsage,
    measurementErrors,
  } = summarizeExecutionMetrics(logs).model.measurements;
  assert.equal(requests.completedCount, valid ? starts.length : 0);
  assert.equal(requests.failedCount, valid ? 0 : starts.length);
  assert.equal(requests.unfinishedCount, 0);
  assert.equal(measuredUsage.tokens.sampleCount, valid ? starts.length : 0);
  if (valid) {
    assert.equal(measuredUsage.tokens.outputTokensSum, outputTokens * starts.length);
    assert.deepEqual(measurementErrors, []);
  } else assert.ok(measurementErrors.length > 0);
  if (expectedError)
    assert.ok(measurementErrors.some(({ message }) => message.includes(expectedError)));
}

const anthropicCases = [
  { name: "open block", frames: [start, block, reason, stop] },
  { name: "missing message_start", frames: [reason, stop] },
  { name: "duplicate message_start", frames: [start, start, reason, stop] },
  { name: "stop without open block", frames: [start, close, reason, stop] },
  {
    name: "delta without open block",
    frames: [
      start,
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
      reason,
      stop,
    ],
  },
  {
    name: "wrong delta type",
    frames: [
      start,
      block,
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "x" } },
      close,
      reason,
      stop,
    ],
  },
  {
    name: "invalid tool JSON",
    frames: [
      start,
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tool", name: "test", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "{" },
      },
      close,
      reason,
      stop,
    ],
  },
  {
    name: "complete with usage-only delta",
    frames: [start, block, close, reason, { type: "message_delta", usage }, stop],
    valid: true,
    body: anthropicBody,
  },
];
for (const value of [undefined, null, "", " ", 7])
  anthropicCases.push({
    name: `stop_reason=${String(value)}`,
    frames: [start, block, close, { ...reason, delta: { stop_reason: value } }, stop],
  });

for (const chunking of ["single", "frames", "bytes"]) {
  for (const scenario of anthropicCases)
    test(`Anthropic ${scenario.name} ${chunking} has matching call/report terminal`, async () => {
      await verify({ ...scenario, anthropic: true, chunking });
    });
  for (const status of [undefined, "in_progress", "failed", "incomplete", "completed"]) {
    for (const operation of [undefined, parseOperation])
      test(`Responses completed status=${status} ${chunking} operation=${operation?.kind ?? "chat"}`, async () => {
        const body = { ...responsesBody, status };
        await verify({
          frames: [...responsesPrefix, { type: "response.completed", response: body }],
          body: status === "completed" ? body : undefined,
          chunking,
          operation,
          valid: status === "completed",
        });
      });
  }
  for (const response of [undefined, null])
    test(`Responses completed response=${response} ${chunking}`, async () => {
      await verify({
        frames: [...responsesPrefix, { type: "response.completed", response }],
        chunking,
      });
    });
}

for (const operation of [undefined, parseOperation]) {
  for (const output of [undefined, null, {}, "text", 7, responsesBody.output]) {
    const body = { ...responsesBody, output };
    const valid = Array.isArray(output);
    test(`Responses body output=${JSON.stringify(output)} operation=${operation?.kind ?? "chat"}`, async () => {
      await verify({ body, streaming: false, operation, valid });
    });
    for (const chunking of ["single", "frames", "bytes"])
      test(`Responses stream output=${JSON.stringify(output)} ${chunking} operation=${operation?.kind ?? "chat"}`, async () => {
        await verify({
          frames: [...responsesPrefix, { type: "response.completed", response: body }],
          body,
          chunking,
          operation,
          valid,
        });
      });
  }
  for (const chunking of ["single", "frames", "bytes"]) {
    for (const tail of [
      "event: response.completed\ndata: {invalid}\n\n",
      { type: "response.failed", response: { status: "failed" } },
    ])
      test(`Responses completion precedes ${typeof tail === "string" ? "invalid JSON" : tail.type} ${chunking} operation=${operation?.kind ?? "chat"}`, async () => {
        await verify({
          frames: [
            ...responsesPrefix,
            { type: "response.completed", response: responsesBody },
            tail,
          ],
          chunking,
          operation,
          valid: true,
        });
      });
  }
}

for (const error of [undefined, null, { code: "server_error", message: "conflict" }, {}]) {
  for (const operation of [undefined, parseOperation]) {
    const valid = error == null;
    const body = { ...responsesBody, error, usage: { input_tokens: 10, output_tokens: 1 } };
    const scenario = {
      body,
      operation,
      valid,
      outputTokens: 1,
      expectedError: valid ? undefined : "non-null error",
    };
    test(`Responses completed body error=${JSON.stringify(error)} operation=${operation?.kind ?? "chat"}`, async () => {
      await verify({ ...scenario, streaming: false });
    });
    for (const chunking of ["single", "frames", "bytes"])
      test(`Responses completed stream error=${JSON.stringify(error)} ${chunking} operation=${operation?.kind ?? "chat"}`, async () => {
        await verify({
          ...scenario,
          frames: [...responsesPrefix, { type: "response.completed", response: body }],
          chunking,
        });
      });
  }
}

const malformedOutputs = [
  { output: [null], path: "output[0]" },
  { output: [7], path: "output[0]" },
  { output: [{}], path: "output[0]" },
  { output: [{ type: "" }], path: "output[0]" },
  ...[undefined, null, {}, [null], ["text"]].map((content) => ({
    output: [{ type: "message", content }],
    path: "output[0].content",
  })),
  ...[
    { type: "output_text", text: null, annotations: [] },
    { type: "output_text", text: "text" },
    { type: "output_text", text: "text", annotations: null },
    { type: "output_text", text: "text", annotations: {} },
    { type: "output_text", text: "text", annotations: [null] },
    { type: "output_text", text: "text", annotations: [{}] },
    { type: "refusal", refusal: null },
  ].map((part) => ({
    output: [{ type: "message", content: [part] }],
    path: "output[0].content[0]",
  })),
  ...[undefined, null, {}, [null], [{ type: "summary_text", text: null }]].map((summary) => ({
    output: [{ type: "reasoning", summary }],
    path: "output[0].summary",
  })),
];

for (const { output, path } of malformedOutputs) {
  for (const operation of [undefined, parseOperation]) {
    const body = { ...responsesBody, output, usage: { input_tokens: 10, output_tokens: 1 } };
    test(`Responses malformed body ${JSON.stringify(output)} operation=${operation?.kind ?? "chat"}`, async () => {
      await verify({ body, streaming: false, operation, expectedError: path });
    });
    for (const chunking of ["single", "frames", "bytes"])
      test(`Responses malformed stream ${JSON.stringify(output)} ${chunking} operation=${operation?.kind ?? "chat"}`, async () => {
        await verify({
          frames: [...responsesPrefix, { type: "response.completed", response: body }],
          body,
          chunking,
          operation,
          expectedError: path,
        });
      });
  }
}

for (const operation of [undefined, parseOperation]) {
  const body = {
    ...responsesBody,
    usage: { input_tokens: 10, output_tokens: 1 },
    output: [
      {
        ...responsesBody.output[0],
        content: [
          {
            type: "output_text",
            text: "partial",
            annotations: [
              {
                type: "url_citation",
                url: "https://example.test",
                title: "source",
                start_index: 0,
                end_index: 7,
              },
            ],
          },
          { type: "refusal", refusal: "Cannot comply" },
        ],
      },
      { type: "reasoning", id: "rs_test", summary: [{ type: "summary_text", text: "Reason" }] },
      { type: "web_search_call", id: "ws_test", status: "completed" },
    ],
  };
  test(`Responses valid nested body operation=${operation?.kind ?? "chat"}`, async () => {
    await verify({ body, streaming: false, operation, valid: true, outputTokens: 1 });
  });
  for (const chunking of ["single", "frames", "bytes"])
    test(`Responses valid nested stream ${chunking} operation=${operation?.kind ?? "chat"}`, async () => {
      await verify({
        frames: [...responsesPrefix, { type: "response.completed", response: body }],
        body,
        chunking,
        operation,
        valid: true,
        outputTokens: 1,
      });
    });
}

for (const stopReason of [
  undefined,
  null,
  "",
  " ",
  7,
  "end_turn",
  "tool_use",
  "max_tokens",
  "pause_turn",
]) {
  for (const operation of [undefined, parseOperation])
    test(`Anthropic body reason=${String(stopReason)} operation=${operation?.kind ?? "chat"}`, async () => {
      await verify({
        anthropic: true,
        body: { ...anthropicBody, stop_reason: stopReason },
        streaming: false,
        valid: typeof stopReason === "string" && stopReason.trim().length > 0,
        operation,
      });
    });
}
