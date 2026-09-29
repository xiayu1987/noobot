/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  anthropicMessagesAdapter,
  openAiCompatibleAdapter,
  createModelRequestExecutor,
  createProviderAdapterRegistry,
  normalizeModelOutput,
} from "../src/index.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

const modelSpec = {
  model: "claude-opus-5",
  operatorId: "anthropic",
  modelFamily: "claude",
  adapterId: "anthropic-messages",
  base_url: "https://model.test/v1",
  reasoning_effort: "none",
  reasoning_effort_options: ["none", "low", "medium", "high"],
  reasoning_effort_parameter: "reasoning_effort",
};
const messages = [{ role: "user", content: "hello" }];
const tools = [
  { type: "function", function: { name: "read_file", parameters: { type: "object" } } },
];
const start = {
  type: "message_start",
  message: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: modelSpec.model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 9,
      output_tokens: 0,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 10,
    },
  },
};
const blockStart = (index, block) => ({ type: "content_block_start", index, content_block: block });
const delta = (index, value) => ({ type: "content_block_delta", index, delta: value });
const blockStop = (index) => ({ type: "content_block_stop", index });
const finish = (reason = "end_turn") => [
  {
    type: "message_delta",
    delta: { stop_reason: reason, stop_sequence: null },
    usage: { output_tokens: 7 },
  },
  { type: "message_stop" },
];
const textEvents = [
  start,
  blockStart(0, { type: "text", text: "" }),
  delta(0, { type: "text_delta", text: "你好" }),
  blockStop(0),
  ...finish(),
];
const frame = (event, newline = "\n") =>
  `event: ${event.type}${newline}data: ${JSON.stringify(event)}${newline}${newline}`;
const encoder = new TextEncoder();

function sseResponse(events, { bytewise = false, newline = "\n" } = {}) {
  const bytes = encoder.encode(events.map((event) => frame(event, newline)).join(""));
  return new Response(
    new ReadableStream({
      start(controller) {
        if (bytewise) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        else controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

for (const adapter of [openAiCompatibleAdapter, anthropicMessagesAdapter]) {
  test(`${adapter.id} emits bound-tool text before the provider finishes`, async () => {
    const tokenReceived = Promise.withResolvers();
    let controller;
    let ended = false;
    let returned = false;
    const tokens = [];
    const body = new ReadableStream({
      start(value) {
        controller = value;
      },
    });
    const openAi = adapter === openAiCompatibleAdapter;
    const spec = openAi
      ? {
          ...modelSpec,
          model: "gpt-4.1",
          modelFamily: "gpt",
          operatorId: "openai",
          adapterId: "openai-compatible",
          use_responses_api: false,
        }
      : modelSpec;
    const client = adapter.createClient({
      modelSpec: spec,
      credential: "test-key",
      streaming: true,
      fetch: async (_url, init) => {
        const payload = JSON.parse(init.body);
        assert.equal(payload.stream, true);
        assert.equal(payload.tools[0].name || payload.tools[0].function.name, "read_file");
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
    });
    const bound = adapter.bindTools({ client, tools, toolOptions: { tool_choice: "auto" } });
    const running = bound
      .invoke(messages, {
        callbacks: [
          {
            handleLLMNewToken(text) {
              if (text) {
                tokens.push(text);
                tokenReceived.resolve();
              }
            },
            handleLLMEnd() {
              ended = true;
            },
          },
        ],
      })
      .then((result) => {
        returned = true;
        return result;
      });
    if (openAi) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            choices: [
              { index: 0, delta: { role: "assistant", content: "你好" }, finish_reason: null },
            ],
          })}\n\n`,
        ),
      );
    } else {
      controller.enqueue(
        encoder.encode(
          textEvents
            .slice(0, 3)
            .map((event) => frame(event))
            .join(""),
        ),
      );
    }
    await tokenReceived.promise;
    assert.deepEqual(tokens, ["你好"]);
    assert.equal(ended, false);
    assert.equal(returned, false);
    if (openAi) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\ndata: [DONE]\n\n`,
        ),
      );
    } else {
      controller.enqueue(
        encoder.encode(
          textEvents
            .slice(3)
            .map((event) => frame(event))
            .join(""),
        ),
      );
    }
    controller.close();
    assert.equal(normalizeModelOutput(await running).text, "你好");
    assert.equal(ended, true);
  });
}

test("Anthropic non-streaming stays non-streaming after tool binding and emits no tokens", async () => {
  const tokens = [];
  let ends = 0;
  const client = anthropicMessagesAdapter.createClient({
    modelSpec,
    credential: "test-key",
    streaming: false,
    fetch: async (_url, init) => {
      assert.equal(JSON.parse(init.body).stream, false);
      return Response.json({
        ...start.message,
        content: [{ type: "text", text: "done" }],
        stop_reason: "end_turn",
      });
    },
  });
  const bound = anthropicMessagesAdapter.bindTools({ client, tools });
  const result = await bound.invoke(messages, {
    callbacks: [
      {
        handleLLMNewToken(text) {
          tokens.push(text);
        },
        handleLLMEnd() {
          ends += 1;
        },
      },
    ],
  });
  assert.equal(normalizeModelOutput(result).text, "done");
  assert.deepEqual(tokens, []);
  assert.equal(ends, 1);
});

test("Anthropic reconstructs text, signed thinking, tool JSON and usage across byte boundaries", async () => {
  const events = [
    start,
    { type: "ping" },
    blockStart(0, { type: "thinking", thinking: "", signature: "" }),
    delta(0, { type: "thinking_delta", thinking: "reason" }),
    delta(0, { type: "signature_delta", signature: "signature" }),
    blockStop(0),
    blockStart(1, { type: "text", text: "" }),
    delta(1, { type: "text_delta", text: "读取文件" }),
    blockStop(1),
    blockStart(2, { type: "tool_use", id: "call_test", name: "read_file", input: {} }),
    delta(2, { type: "input_json_delta", partial_json: '{"path":' }),
    delta(2, { type: "input_json_delta", partial_json: '"资料.txt"}' }),
    blockStop(2),
    ...finish("tool_use"),
  ];
  const tokens = [];
  const client = anthropicMessagesAdapter.createClient({
    modelSpec,
    credential: "test-key",
    streaming: true,
    fetch: async () => sseResponse(events, { bytewise: true, newline: "\r\n" }),
  });
  const result = await client.invoke(messages, {
    callbacks: [
      {
        handleLLMNewToken(text) {
          tokens.push(text);
        },
      },
    ],
  });
  assert.deepEqual(tokens, ["读取文件"]);
  assert.deepEqual(result.content[0], {
    type: "thinking",
    thinking: "reason",
    signature: "signature",
  });
  const output = normalizeModelOutput(result);
  assert.equal(output.reasoning, "reason");
  assert.equal(output.finishReason, "tool_use");
  assert.deepEqual(output.toolCalls, [
    { id: "call_test", name: "read_file", args: JSON.stringify({ path: "资料.txt" }) },
  ]);
  assert.deepEqual(output.usage, {
    input_tokens: 9,
    output_tokens: 7,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 50,
  });
});

for (const [name, events, expected] of [
  ["truncated stream", textEvents.slice(0, -1), /before message_stop/],
  [
    "provider error",
    [start, { type: "error", error: { type: "overloaded_error", message: "server busy" } }],
    /server busy/,
  ],
  [
    "invalid tool JSON",
    [
      start,
      blockStart(0, { type: "tool_use", id: "c", name: "read_file", input: {} }),
      delta(0, { type: "input_json_delta", partial_json: '{"path":' }),
      blockStop(0),
      ...finish("tool_use"),
    ],
    /JSON/,
  ],
]) {
  test(`Anthropic rejects ${name} without a successful end callback`, async () => {
    let ended = false;
    const errors = [];
    const client = anthropicMessagesAdapter.createClient({
      modelSpec,
      credential: "test-key",
      streaming: true,
      fetch: async () => sseResponse(events),
    });
    await assert.rejects(
      client.invoke(messages, {
        callbacks: [
          {
            handleLLMEnd() {
              ended = true;
            },
            handleLLMError(error) {
              errors.push(error);
            },
          },
        ],
      }),
      expected,
    );
    assert.equal(ended, false);
    assert.equal(errors.length, 1);
  });
}

const invocation = {
  requestId: "r",
  invocationId: "i",
  sessionId: "s",
  dialogProcessId: "d",
  turnScopeId: "t",
  runId: "run",
  flow: "test",
  purpose: "test",
  domain: "test",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
};

function executorWithFetch(fetch) {
  return createModelRequestExecutor({
    registry: createProviderAdapterRegistry([
      {
        ...anthropicMessagesAdapter,
        createClient: (input) => anthropicMessagesAdapter.createClient({ ...input, fetch }),
      },
    ]),
    credentialPort: { resolve: async () => "test-key" },
  });
}

test("Anthropic obeys the existing alternate-mode retry and successful-mode cache", async () => {
  const modes = [];
  const executor = executorWithFetch(async (_url, init) => {
    const payload = JSON.parse(init.body);
    modes.push(payload.stream);
    if (payload.stream)
      return Response.json({ error: { message: "stream unsupported" } }, { status: 400 });
    return Response.json({
      ...start.message,
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
    });
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await executor.invoke({
      invocation,
      model: modelSpec,
      messages,
      tools,
      options: { streaming: true },
    });
    assert.equal(result.output.text, "done");
  }
  assert.deepEqual(modes, [true, false, false]);
});

test("Anthropic streamed tokens prevent the existing executor from replaying a failed response", async () => {
  let requests = 0;
  const tokens = [];
  const executor = executorWithFetch(async () => {
    requests += 1;
    return sseResponse(textEvents.slice(0, 3));
  });
  await assert.rejects(
    executor.invoke({
      invocation,
      model: modelSpec,
      messages,
      tools,
      options: {
        streaming: true,
        callbacks: [
          {
            handleLLMNewToken(text) {
              tokens.push(text);
            },
          },
        ],
      },
    }),
    /before message_stop/,
  );
  assert.deepEqual(tokens, ["你好"]);
  assert.equal(requests, 1);
});

test("Anthropic abort stops callbacks and cancels the streaming reader", async () => {
  const abort = new AbortController();
  const tokens = [];
  let ended = false;
  let cancelled = false;
  const client = anthropicMessagesAdapter.createClient({
    modelSpec,
    credential: "test-key",
    streaming: true,
    fetch: async (_url, init) => {
      assert.equal(init.signal, abort.signal);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(textEvents.map((event) => frame(event)).join("")));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await assert.rejects(
    client.invoke(messages, {
      signal: abort.signal,
      callbacks: [
        {
          handleLLMNewToken(text) {
            tokens.push(text);
            abort.abort();
          },
          handleLLMEnd() {
            ended = true;
          },
        },
      ],
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(tokens, ["你好"]);
  assert.equal(ended, false);
  assert.equal(cancelled, true);
});

test("Anthropic streaming rejects a JSON response instead of emitting a buffered answer", async () => {
  const tokens = [];
  const client = anthropicMessagesAdapter.createClient({
    modelSpec,
    credential: "test-key",
    streaming: true,
    fetch: async () =>
      Response.json({ ...start.message, content: [{ type: "text", text: "done" }] }),
  });
  await assert.rejects(
    client.invoke(messages, {
      callbacks: [
        {
          handleLLMNewToken(text) {
            tokens.push(text);
          },
        },
      ],
    }),
    /expected an SSE response/,
  );
  assert.deepEqual(tokens, []);
});
