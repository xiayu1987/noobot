/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChatOpenAI } from "@langchain/openai";
import {
  createOpenAiCompatibleClient,
  bindOpenAiCompatibleTools,
  openAiCompatibleAdapter,
} from "../src/adapters/openai-compatible-adapter.js";
import { normalizeModelResponse } from "../src/normalization/response-normalizer.js";
import { createModelRequestExecutor } from "../src/index.js";
import { invocation } from "./runtime-fixtures.js";

const modelSpec = {
  model: "gpt-4o-mini",
  operatorId: "openai",
  adapterId: "openai-compatible",
  use_responses_api: false,
  reasoning_effort: "none",
  reasoning_effort_options: ["none"],
  reasoning_effort_parameter: "reasoning_effort",
};
const tools = [
  {
    type: "function",
    function: {
      name: "run",
      parameters: { type: "object", properties: { value: { type: "object" } } },
    },
  },
];
const input = [
  {
    role: "user",
    content: [
      { type: "text", text: "Inspect and run" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
    ],
  },
];

function eventsResponse(events, responses) {
  return new Response(
    events
      .map(
        (event) => `${responses ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
      )
      .join("") + (responses ? "" : "data: [DONE]\n\n"),
    { headers: { "content-type": "text/event-stream" } },
  );
}

for (const responses of [false, true]) {
  test(`stream invoke preserves multi-tool arguments, image request and callbacks: Responses=${responses}`, async () => {
    const observations = [];
    const argumentsText = JSON.stringify({
      value: { text: '中文\nquoted "text"', items: [1, null, { ok: true }] },
    });
    const calls = ["call-1", "call-2"].map((id, index) => ({
      type: "function_call",
      id: `fc-${index}`,
      call_id: id,
      name: "run",
      arguments: argumentsText,
    }));
    const events = responses
      ? [
          {
            type: "response.created",
            response: { id: "resp-1", status: "in_progress", output: [] },
          },
          ...calls.flatMap((call, index) => [
            {
              type: "response.output_item.added",
              output_index: index,
              item: { ...call, arguments: "" },
            },
            {
              type: "response.function_call_arguments.delta",
              item_id: call.id,
              output_index: index,
              delta: argumentsText.slice(0, 13),
            },
            {
              type: "response.function_call_arguments.delta",
              item_id: call.id,
              output_index: index,
              delta: argumentsText.slice(13),
            },
            {
              type: "response.function_call_arguments.done",
              item_id: call.id,
              output_index: index,
              arguments: argumentsText,
            },
            { type: "response.output_item.done", output_index: index, item: call },
          ]),
          {
            type: "response.completed",
            response: {
              id: "resp-1",
              status: "completed",
              output: calls,
              usage: {
                input_tokens: 23,
                output_tokens: 4,
                total_tokens: 27,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 0 },
              },
            },
          },
        ]
      : [
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: calls.map((call, index) => ({
                    index,
                    id: call.call_id,
                    type: "function",
                    function: { name: call.name, arguments: argumentsText.slice(0, 13) },
                  })),
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: calls.map((_, index) => ({
                    index,
                    function: { arguments: argumentsText.slice(13) },
                  })),
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 23, completion_tokens: 4, total_tokens: 27 } },
        ];
    for (const reference of [true, false]) {
      const requests = [];
      const client = bindOpenAiCompatibleTools(
        createOpenAiCompatibleClient({
          modelSpec: { ...modelSpec, use_responses_api: responses },
          credential: "test",
          streaming: true,
          fetch: async (_url, init) => {
            requests.push(JSON.parse(init.body));
            return eventsResponse(events, responses);
          },
        }),
        tools,
      );
      client.completions.getNumTokens = async () => 1;
      const tokens = [];
      const terminal = [];
      const invoke = reference
        ? ChatOpenAI.prototype.invoke.bind(client)
        : (messages, invokeOptions) =>
            openAiCompatibleAdapter.invokeChat({
              client,
              messages,
              invokeOptions,
              streaming: true,
            });
      const result = await invoke(input, {
        runId: "00000000-0000-4000-8000-000000000001",
        callbacks: [
          {
            handleLLMNewToken: (token) => tokens.push(token),
            handleLLMEnd: (output) => terminal.push(output),
          },
        ],
      });
      assert.equal(terminal.length, 1);
      const normalized = normalizeModelResponse(result, responses ? "responses" : "message");
      observations.push({
        requests,
        tokens,
        normalized,
        terminal: normalizeModelResponse(
          terminal[0].generations[0][0].message,
          responses ? "responses" : "message",
        ),
      });
    }
    assert.deepEqual(observations[1], observations[0]);
    assert.equal(observations[1].normalized.output.toolCalls.length, 2);
    assert.deepEqual(
      observations[1].normalized.output.toolCalls[0].args,
      JSON.parse(argumentsText),
    );
  });
}

test("stream invocation cancellation preserves the executor terminal and never replays visible output", async () => {
  const observations = [];
  for (const reference of [true, false]) {
    const controller = new AbortController();
    const callbacks = [];
    const errored = Promise.withResolvers();
    const events = [];
    let requests = 0;
    const executor = createModelRequestExecutor({
      registry: {
        resolve: () => ({
          ...openAiCompatibleAdapter,
          invokeChat(input) {
            return reference
              ? ChatOpenAI.prototype.invoke.call(input.client, input.messages, input.invokeOptions)
              : openAiCompatibleAdapter.invokeChat(input);
          },
        }),
      },
      credentialPort: { resolve: () => "test" },
      observationPort: { emit: (type, detail) => events.push({ type, detail }) },
      clock: { now: Date.now, sleep: async () => assert.fail("cancelled output must not retry") },
      providerRuntime: {
        fetchImpl: async () => {
          requests += 1;
          return eventsResponse(
            [
              {
                choices: [
                  {
                    index: 0,
                    delta: { role: "assistant", content: "visible" },
                    finish_reason: null,
                  },
                ],
              },
              { choices: [{ index: 0, delta: { content: "later" }, finish_reason: null }] },
              { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
            ],
            false,
          );
        },
      },
    });
    await assert.rejects(
      executor.invoke({
        invocation,
        model: modelSpec,
        messages: [{ role: "user", content: "context" }],
        options: {
          streaming: true,
          signal: controller.signal,
          callbacks: [
            {
              handleLLMNewToken: (token) => {
                callbacks.push(token);
                controller.abort();
              },
              handleLLMEnd: () => callbacks.push("end"),
              handleLLMError: () => {
                callbacks.push("error");
                errored.resolve();
              },
            },
          ],
        },
      }),
    );
    await errored.promise;
    assert.deepEqual(callbacks, ["visible", "error"]);
    assert.equal(requests, 1);
    const terminals = events
      .filter(({ type }) => /^model\.invocation\.(cancelled|failed|completed)$/.test(type))
      .map(({ type }) => type);
    assert.deepEqual(terminals, ["model.invocation.cancelled"]);
    observations.push({ terminals, callbacks });
  }
  assert.deepEqual(observations[1], observations[0]);
});
